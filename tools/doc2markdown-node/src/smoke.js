#!/usr/bin/env node
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Command } from 'commander';

import { convertPathToMarkdown } from './convert.js';

const SUPPORTED_SUFFIXES = new Set(['.md', '.markdown', '.docx', '.pdf', '.doc', '.wps']);

const program = new Command();

program
  .name('doc2markdown-node-smoke')
  .description('批量转换目录中的样本文件，快速查看 Node POC 效果')
  .argument('<sampleDir>', '样本文件目录')
  .option('--include-images', '尽量保留图片并转为 data URI')
  .option('--out-dir <dir>', '保存每个样本的 Markdown 输出')
  .action(async (sampleDir, options) => {
    const root = path.resolve(sampleDir);
    const entries = await readdir(root, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(root, entry.name))
      .filter((file) => SUPPORTED_SUFFIXES.has(path.extname(file).toLowerCase()))
      .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'));

    if (options.outDir) {
      await mkdir(path.resolve(options.outDir), { recursive: true });
    }

    const failures = [];
    for (const file of files) {
      try {
        const markdown = await convertPathToMarkdown(file, {
          includeImages: Boolean(options.includeImages),
        });
        if (!markdown.trim()) {
          throw new Error('转换结果为空');
        }

        if (options.outDir) {
          const outputPath = path.join(
            path.resolve(options.outDir),
            `${path.basename(file, path.extname(file))}.md`
          );
          await writeFile(outputPath, markdown, 'utf8');
        }

        console.log(`OK  ${path.basename(file)} -> ${markdown.length} chars`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${path.basename(file)}: ${message}`);
        console.log(`FAIL ${path.basename(file)}: ${message}`);
      }
    }

    if (files.length === 0) {
      console.log('未找到可测试文件。');
    }

    if (failures.length > 0) {
      console.log('\nFailures:');
      for (const failure of failures) {
        console.log(`- ${failure}`);
      }
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
