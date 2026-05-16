const fs = require('node:fs/promises');
const path = require('node:path');
const { dialog } = require('electron');
const AdmZip = require('adm-zip');

const parserLabels = {
  local: '本地解析',
  'mineru-accurate-api': 'MinerU 精准解析 API',
  'mineru-agent-api': 'MinerU-Agent 轻量解析 API',
};

const localSupportedExtensions = new Set(['.txt', '.md', '.markdown', '.docx', '.pdf', '.doc', '.wps']);
const mineruAgentSupportedExtensions = new Set([
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.png', '.jpg', '.jpeg', '.jp2', '.webp', '.gif', '.bmp', '.xls', '.xlsx',
]);
const mineruAccurateSupportedExtensions = new Set([
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.png', '.jpg', '.jpeg', '.jp2', '.webp', '.gif', '.bmp', '.html',
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSupportedExtensions(provider) {
  if (provider === 'mineru-agent-api') {
    return mineruAgentSupportedExtensions;
  }
  if (provider === 'mineru-accurate-api') {
    return mineruAccurateSupportedExtensions;
  }
  return localSupportedExtensions;
}

async function parseLocalDocument(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.txt') {
    return fs.readFile(filePath, 'utf-8');
  }

  const { convertPathToMarkdown } = await import('./doc2markdown/convert.mjs');
  return convertPathToMarkdown(filePath, { includeImages: false });
}

function formatImportError(error) {
  const rawMessage = error instanceof Error ? error.message : String(error || '未知错误');
  if (/Can't find end of central directory|is this a zip file/i.test(rawMessage)) {
    return '文件解析失败：该文件不是有效的 DOCX 文档，请用 Word/WPS 另存为标准 DOCX 后重试';
  }
  return `文件解析失败：${rawMessage || '未知错误'}`;
}

async function parseWithMineruAgent(filePath) {
  const fileName = path.basename(filePath);
  const createResponse = await fetch('https://mineru.net/api/v1/agent/parse/file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_name: fileName,
      language: 'ch',
      enable_table: true,
      is_ocr: true,
      enable_formula: true,
    }),
  });
  const createResult = await createResponse.json();
  if (!createResponse.ok || createResult.code !== 0) {
    throw new Error(`申请 MinerU-Agent 上传链接失败：HTTP ${createResponse.status}，${JSON.stringify(createResult)}`);
  }

  const taskId = createResult.data?.task_id;
  const fileUrl = createResult.data?.file_url;
  if (!taskId || !fileUrl) {
    throw new Error(`MinerU-Agent 响应缺少 task_id/file_url：${JSON.stringify(createResult)}`);
  }

  await uploadFile(fileUrl, filePath);
  const finalResult = await pollMineruAgent(taskId, fileName);
  const markdownUrl = finalResult.data.markdown_url;
  if (!markdownUrl) {
    throw new Error('MinerU-Agent 解析完成但未返回 markdown_url');
  }
  return downloadText(markdownUrl, '下载 MinerU-Agent Markdown 失败');
}

async function pollMineruAgent(taskId, fileName) {
  const startedAt = Date.now();
  const timeoutMs = 300000;
  const intervalMs = 3000;

  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(`https://mineru.net/api/v1/agent/parse/${taskId}`);
    const result = await response.json();
    if (!response.ok || result.code !== 0) {
      throw new Error(`查询 MinerU-Agent 任务失败：HTTP ${response.status}，${JSON.stringify(result)}`);
    }

    const data = result.data || {};
    if (data.state === 'done') {
      return { raw: result, data };
    }
    if (data.state === 'failed') {
      throw new Error(`MinerU-Agent 解析失败：${data.err_msg || '未知错误'}${data.err_code ? ` (${data.err_code})` : ''}`);
    }
    console.log(`WAIT ${fileName}: ${data.state || 'unknown'}`);
    await sleep(intervalMs);
  }

  throw new Error(`MinerU-Agent 轮询超时，请稍后重试，task_id: ${taskId}`);
}

async function parseWithMineruAccurate(filePath, token) {
  if (!token) {
    throw new Error('请先在设置中填写 MinerU Token');
  }

  const fileName = path.basename(filePath);
  const createResponse = await fetch('https://mineru.net/api/v4/file-urls/batch', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      files: [{ name: fileName, data_id: makeDataId(fileName), is_ocr: true }],
      model_version: 'vlm',
      language: 'ch',
      enable_table: true,
      enable_formula: true,
    }),
  });
  const createResult = await createResponse.json();
  if (!createResponse.ok || createResult.code !== 0) {
    throw new Error(`申请 MinerU 精准解析上传链接失败：HTTP ${createResponse.status}，${JSON.stringify(createResult)}`);
  }

  const batchId = createResult.data?.batch_id;
  const fileUrl = createResult.data?.file_urls?.[0];
  if (!batchId || !fileUrl) {
    throw new Error(`MinerU 精准解析响应缺少 batch_id/file_url：${JSON.stringify(createResult)}`);
  }

  await uploadFile(fileUrl, filePath);
  const finalResult = await pollMineruAccurate(token, batchId, fileName);
  const fullZipUrl = finalResult.item.full_zip_url;
  if (!fullZipUrl) {
    throw new Error('MinerU 精准解析完成但未返回 full_zip_url');
  }
  const zipBuffer = await downloadBuffer(fullZipUrl);
  return extractMarkdownFromZip(zipBuffer);
}

async function pollMineruAccurate(token, batchId, fileName) {
  const startedAt = Date.now();
  const timeoutMs = 600000;
  const intervalMs = 5000;

  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(`https://mineru.net/api/v4/extract-results/batch/${batchId}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: '*/*' },
    });
    const result = await response.json();
    if (!response.ok || result.code !== 0) {
      throw new Error(`查询 MinerU 精准解析任务失败：HTTP ${response.status}，${JSON.stringify(result)}`);
    }

    const items = result.data?.extract_result || [];
    const item = items.find((candidate) => candidate.file_name === fileName) || items[0];
    if (item?.state === 'done') {
      return { raw: result, item };
    }
    if (item?.state === 'failed') {
      throw new Error(`MinerU 精准解析失败：${item.err_msg || '未知错误'}`);
    }
    console.log(`WAIT ${fileName}: ${item?.state || 'unknown'}`);
    await sleep(intervalMs);
  }

  throw new Error(`MinerU 精准解析轮询超时，请稍后重试，batch_id: ${batchId}`);
}

async function uploadFile(fileUrl, filePath) {
  const buffer = await fs.readFile(filePath);
  const response = await fetch(fileUrl, { method: 'PUT', body: buffer });
  if (!response.ok) {
    throw new Error(`文件上传失败：HTTP ${response.status}，${await response.text()}`);
  }
}

async function downloadText(url, fallbackMessage) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${fallbackMessage}：HTTP ${response.status}`);
  }
  return response.text();
}

async function downloadBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载 MinerU 精准解析结果失败：HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function extractMarkdownFromZip(zipBuffer) {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  const fullMd = entries.find((entry) => /(^|[/\\])full\.md$/i.test(entry.entryName));
  const anyMd = entries.find((entry) => entry.entryName.toLowerCase().endsWith('.md'));
  const target = fullMd || anyMd;
  if (!target) {
    throw new Error('MinerU 精准解析结果 zip 中未找到 Markdown 文件');
  }
  return target.getData().toString('utf8');
}

function makeDataId(fileName) {
  return fileName.replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 96) || 'document';
}

async function parseDocument(filePath, config) {
  const provider = config.file_parser?.provider || 'local';
  if (provider === 'mineru-agent-api') {
    return parseWithMineruAgent(filePath);
  }
  if (provider === 'mineru-accurate-api') {
    return parseWithMineruAccurate(filePath, config.file_parser?.mineru_token || '');
  }
  return parseLocalDocument(filePath);
}

function createFileService({ configStore } = {}) {
  return {
    async importDocument() {
      const config = configStore ? configStore.load() : { file_parser: { provider: 'local' } };
      const provider = config.file_parser?.provider || 'local';
      const supportedExtensions = getSupportedExtensions(provider);
      const result = await dialog.showOpenDialog({
        title: '选择招标文件',
        properties: ['openFile'],
        filters: [
          { name: parserLabels[provider] || '招标文件', extensions: [...supportedExtensions].map((item) => item.slice(1)) },
          { name: '所有文件', extensions: ['*'] },
        ],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, message: '已取消选择' };
      }

      const filePath = result.filePaths[0];
      const ext = path.extname(filePath).toLowerCase();

      if (!supportedExtensions.has(ext)) {
        return { success: false, message: `当前${parserLabels[provider] || '解析方式'}不支持该文件格式` };
      }

      let fileContent = '';
      try {
        fileContent = (await parseDocument(filePath, config)).trim();
      } catch (error) {
        return {
          success: false,
          message: formatImportError(error),
          file_name: path.basename(filePath),
          parser_provider: provider,
          parser_label: parserLabels[provider] || '本地解析',
        };
      }

      if (!fileContent) {
        return { success: false, message: '未提取到有效 Markdown 内容，请检查文件内容' };
      }

      return {
        success: true,
        message: '文件解析完成',
        file_content: fileContent,
        file_name: path.basename(filePath),
        parser_provider: provider,
        parser_label: parserLabels[provider] || '本地解析',
      };
    },
  };
}

module.exports = {
  createFileService,
};
