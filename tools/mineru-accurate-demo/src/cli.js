#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import AdmZip from 'adm-zip';
import { Command } from 'commander';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const API_BASE = 'https://mineru.net/api/v4';
const SUPPORTED_SUFFIXES = new Set([
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.png', '.jpg', '.jpeg', '.jp2', '.webp', '.gif', '.bmp', '.html',
]);

const program = new Command();

program
  .name('mineru-accurate-demo')
  .description('MinerU 精准解析 API demo，使用 Token')
  .argument('[input]', '待解析文件或样本目录')
  .option('--smoke', '按目录批量解析')
  .option('--out-dir <dir>', '输出目录', './out')
  .option('--model-version <value>', '模型版本：vlm / pipeline / MinerU-HTML', 'vlm')
  .option('--language <value>', '文档语言', 'ch')
  .option('--ocr', '开启 OCR')
  .option('--no-table', '关闭表格识别')
  .option('--no-formula', '关闭公式识别')
  .option('--page-ranges <value>', '精准 API 页码范围，例如 1-10')
  .option('--timeout <seconds>', '轮询超时时间', parseInteger, 600)
  .option('--interval <seconds>', '轮询间隔', parseInteger, 5)
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
      }

      await writeSummary(outDir, 'MinerU 精准解析 API 测试结果', summary);
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
  const zipPath = path.join(outDir, `${stem}.zip`);

  try {
    const token = process.env.MINERU_API_TOKEN;
    if (!token) {
      throw new Error('缺少 MINERU_API_TOKEN，请检查 tools/mineru-accurate-demo/.env');
    }

    const batch = await createUploadBatch(token, filePath, fileName, options);
    await uploadFile(batch.fileUrl, filePath);
    const finalResult = await pollBatchResult(token, batch.batchId, fileName, options);
    await writeFile(rawPath, JSON.stringify(finalResult.raw, null, 2), 'utf8');

    const fullZipUrl = finalResult.item.full_zip_url;
    if (!fullZipUrl) {
      throw new Error('任务完成但未返回 full_zip_url');
    }

    const zipBuffer = await downloadBuffer(fullZipUrl);
    await writeFile(zipPath, zipBuffer);
    const markdown = extractMarkdownFromZip(zipBuffer);
    await writeFile(markdownPath, markdown, 'utf8');

    return { file: fileName, status: 'OK', output: path.basename(markdownPath), bytes: Buffer.byteLength(markdown), message: '' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeFile(errorPath, message, 'utf8');
    return { file: fileName, status: 'FAIL', output: path.basename(errorPath), bytes: Buffer.byteLength(message), message };
  }
}

async function createUploadBatch(token, filePath, fileName, options) {
  const payload = {
    files: [
      {
        name: fileName,
        data_id: makeDataId(fileName),
        is_ocr: Boolean(options.ocr),
      },
    ],
    model_version: options.modelVersion,
    language: options.language,
    enable_table: Boolean(options.table),
    enable_formula: Boolean(options.formula),
  };
  if (options.pageRanges) {
    payload.files[0].page_ranges = options.pageRanges;
  }

  const response = await fetch(`${API_BASE}/file-urls/batch`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok || result.code !== 0) {
    throw new Error(`申请上传链接失败: HTTP ${response.status}, ${JSON.stringify(result)}`);
  }

  const batchId = result.data?.batch_id;
  const fileUrl = result.data?.file_urls?.[0];
  if (!batchId || !fileUrl) {
    throw new Error(`申请上传链接响应缺少 batch_id/file_url: ${JSON.stringify(result)}`);
  }
  return { batchId, fileUrl, filePath };
}

async function uploadFile(fileUrl, filePath) {
  const buffer = await readFile(filePath);
  const response = await fetch(fileUrl, { method: 'PUT', body: buffer });
  if (!response.ok) {
    throw new Error(`文件上传失败: HTTP ${response.status}, ${await response.text()}`);
  }
}

async function pollBatchResult(token, batchId, fileName, options) {
  const startedAt = Date.now();
  const timeoutMs = options.timeout * 1000;
  const intervalMs = options.interval * 1000;

  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(`${API_BASE}/extract-results/batch/${batchId}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: '*/*' },
    });
    const result = await response.json();
    if (!response.ok || result.code !== 0) {
      throw new Error(`查询任务失败: HTTP ${response.status}, ${JSON.stringify(result)}`);
    }

    const items = result.data?.extract_result || [];
    const item = items.find((candidate) => candidate.file_name === fileName) || items[0];
    const state = item?.state;
    if (state === 'done') {
      return { raw: result, item };
    }
    if (state === 'failed') {
      throw new Error(`解析失败: ${item.err_msg || '未知错误'}`);
    }

    console.log(`WAIT ${fileName}: ${state || 'unknown'}`);
    await sleep(intervalMs);
  }

  throw new Error(`轮询超时，请稍后手动查询 batch_id: ${batchId}`);
}

async function downloadBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载结果失败: HTTP ${response.status}`);
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
    throw new Error('结果 zip 中未找到 Markdown 文件');
  }
  return target.getData().toString('utf8');
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

function makeDataId(fileName) {
  return fileName.replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 96) || 'document';
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
