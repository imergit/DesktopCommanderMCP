#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TextFileHandler } from '../dist/utils/files/text.js';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dc-reverse-tail-'));
const file = path.join(dir, 'large-tail.txt');
try {
  const line = `${'X'.repeat(80)}\n`;
  const prefix = line.repeat(130000); // >10 MiB, forces reverse-reader path
  await fs.writeFile(file, `${prefix}LAST_A\nLAST_B\nLAST_C\n`, 'utf8');
  const handler = new TextFileHandler();
  const result = await handler.read(file, { offset: -3, length: 1, includeStatusMessage: false });
  assert.equal(result.content, 'LAST_A\nLAST_B\nLAST_C', 'trailing newline must not consume one requested tail line');
  console.log('PASS: large-file reverse tail ignores the synthetic trailing empty segment');
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}