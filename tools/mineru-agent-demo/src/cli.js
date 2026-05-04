#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Command } from 'commander';

const API_BASE = 'https://mineru.net/api/v1/agent';
const SUPPORTED_SUFFIXES = new Set([
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.png', '.jpg', '.jpeg', '.jp2', '.webp', '.gif', '.bmp', '.xls', '.xlsx',
]);

const program = new Command();

program
  .name('mineru-agent-demo')
  .description('MinerU Agent 轻量解析 API demo，无 Token')
  .argument('[input]', '待解析文件或样本目录')
  .option('--smoke', '按目录批量解析')
  .option('--out-dir <dir>', '输出目录', './out')
  .option('--language <value>', '文档语言', 'ch')
  .option('--ocr', '开启 OCR')
  .option('--no-table', '关闭表格识别')
  .option('--no-formula', '关闭公式识别')
  .option('--page-range <value>', 'Agent API 页码范围，例如 1-10')
  .option('--timeout <seconds>', '轮询超时时间', parseInteger, 300)
  .option('--interval <seconds>', '轮询间隔', parseInteger, 3)
  .action(async (input, options) => {
    try {
      const target = path.resolve(input || '../测试文件');
      const outDir = path.resolve(options.outDir);
      await mkdir(outDir, { recursive: true });

      const files = options.smoke ? await listSupportedFiles(target) : [target];
      const summary = [];

      for (const file of files) {
        const result = await runOne(file, outDir, options);
        summary.push(result);
        const sizeText = result.bytes ? ` -> ${result.bytes} bytes` : '';
        console.log(`${result.status.padEnd(4)} ${path.basename(file)}${sizeText}`);
        if (options.smoke && options.interval > 0) {
          await sleep(Math.min(options.interval * 1000, 5000));
        }
      }

      await writeSummary(outDir, 'MinerU Agent 轻量解析 API 测试结果', summary);
      if (summary.some((item) => item.status === 'FAIL')) {
        process.exitCode = 1;
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);

async function runOne(filePath, outDir, options) {
  const fileName = path.basename(filePath);
  const stem = path.basename(filePath, path.extname(filePath));
  const rawPath = path.join(outDir, `${stem}.raw.json`);
  const errorPath = path.join(outDir, `${stem}.error.txt`);
  const markdownPath = path.join(outDir, `${stem}.md`);

  try {
    const task = await createUploadTask(fileName, options);
    await uploadFile(task.fileUrl, filePath);
    const finalResult = await pollTaskResult(task.taskId, fileName, options);
    await writeFile(rawPath, JSON.stringify(finalResult.raw, null, 2), 'utf8');

    const markdownUrl = finalResult.data.markdown_url;
    if (!markdownUrl) {
      throw new Error('任务完成但未返回 markdown_url');
    }

    const markdown = await downloadText(markdownUrl);
    await writeFile(markdownPath, markdown, 'utf8');

    return { file: fileName, status: 'OK', output: path.basename(markdownPath), bytes: Buffer.byteLength(markdown), message: '' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeFile(errorPath, message, 'utf8');
    return { file: fileName, status: 'FAIL', output: path.basename(errorPath), bytes: Buffer.byteLength(message), message };
  }
}

async function createUploadTask(fileName, options) {
  const payload = {
    file_name: fileName,
    language: options.language,
    enable_table: Boolean(options.table),
    is_ocr: Boolean(options.ocr),
    enable_formula: Boolean(options.formula),
  };
  if (options.pageRange) {
    payload.page_range = options.pageRange;
  }

  const response = await fetch(`${API_BASE}/parse/file`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok || result.code !== 0) {
    throw new Error(`申请上传链接失败: HTTP ${response.status}, ${JSON.stringify(result)}`);
  }

  const taskId = result.data?.task_id;
  const fileUrl = result.data?.file_url;
  if (!taskId || !fileUrl) {
    throw new Error(`申请上传链接响应缺少 task_id/file_url: ${JSON.stringify(result)}`);
  }
  return { taskId, fileUrl };
}

async function uploadFile(fileUrl, filePath) {
  const buffer = await readFile(filePath);
  const response = await fetch(fileUrl, { method: 'PUT', body: buffer });
  if (!response.ok) {
    throw new Error(`文件上传失败: HTTP ${response.status}, ${await response.text()}`);
  }
}

async function pollTaskResult(taskId, fileName, options) {
  const startedAt = Date.now();
  const timeoutMs = options.timeout * 1000;
  const intervalMs = options.interval * 1000;

  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(`${API_BASE}/parse/${taskId}`);
    const result = await response.json();
    if (!response.ok || result.code !== 0) {
      throw new Error(`查询任务失败: HTTP ${response.status}, ${JSON.stringify(result)}`);
    }

    const data = result.data || {};
    const state = data.state;
    if (state === 'done') {
      return { raw: result, data };
    }
    if (state === 'failed') {
      throw new Error(`解析失败: ${data.err_msg || '未知错误'}${data.err_code ? ` (${data.err_code})` : ''}`);
    }

    console.log(`WAIT ${fileName}: ${state || 'unknown'}`);
    await sleep(intervalMs);
  }

  throw new Error(`轮询超时，请稍后手动查询 task_id: ${taskId}`);
}

async function downloadText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载 Markdown 失败: HTTP ${response.status}`);
  }
  return response.text();
}

async function listSupportedFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dir, entry.name))
    .filter((file) => SUPPORTED_SUFFIXES.has(path.extname(file).toLowerCase()))
    .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'));
}

async function writeSummary(outDir, title, rows) {
  await writeFile(path.join(outDir, 'summary.json'), JSON.stringify(rows, null, 2), 'utf8');
  const lines = [`# ${title}`, '', '| 文件 | 状态 | 输出文件 | 大小(bytes) | 说明 |', '| --- | --- | --- | ---: | --- |'];
  for (const row of rows) {
    lines.push(`| ${row.file} | ${row.status} | ${row.output} | ${row.bytes || 0} | ${escapeTable(row.message || '')} |`);
  }
  await writeFile(path.join(outDir, 'summary.md'), `${lines.join('\n')}\n`, 'utf8');
}

function escapeTable(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseInteger(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`参数必须是正整数: ${value}`);
  }
  return parsed;
}
