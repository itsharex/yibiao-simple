#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Command } from 'commander';

import { ConversionError, convertPathToMarkdown } from './convert.js';

const program = new Command();

program
  .name('doc2markdown-node')
  .description('将 Markdown、DOCX、PDF、DOC/WPS 转换为 Markdown 的 Node.js POC')
  .argument('<file>', '待转换文件路径')
  .option('-o, --out <file>', '输出 Markdown 文件路径；不指定则输出到控制台')
  .option('--include-images', '尽量保留图片并转为 data URI')
  .action(async (file, options) => {
    try {
      const markdown = await convertPathToMarkdown(file, {
        includeImages: Boolean(options.includeImages),
      });

      if (options.out) {
        const outputPath = path.resolve(options.out);
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(outputPath, markdown, 'utf8');
        console.log(`OK  ${outputPath}`);
      } else {
        process.stdout.write(markdown);
      }
    } catch (error) {
      printError(error);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);

function printError(error) {
  if (error instanceof ConversionError) {
    console.error(`FAIL ${error.code}: ${error.message}`);
    if (Object.keys(error.details || {}).length > 0) {
      console.error(JSON.stringify(error.details, null, 2));
    }
    return;
  }
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
}
