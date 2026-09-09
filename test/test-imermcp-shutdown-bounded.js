#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const helper = path.join(here, '__shutdown-bounded-helper.js');
const started = Date.now();
const child = spawn('node', [helper], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let stderr = '';
child.stderr.on('data', c => { stderr += c.toString(); });
const code = await new Promise(resolve => child.on('close', resolve));
const elapsed = Date.now() - started;
assert.equal(code, 0, stderr);
assert.ok(elapsed < 5000, `shutdown with residual handle took ${elapsed}ms`);
console.log(`PASS: shutdown remains bounded with residual handles (${elapsed}ms)`);
