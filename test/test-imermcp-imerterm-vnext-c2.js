#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getImerTermTools } from '../dist/imermcp-local/imerterm-tools.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(here, '..', 'src', 'imermcp-local', 'imerterm-tools.ts');
const source = await fs.readFile(sourcePath, 'utf8');
const tools = getImerTermTools();
const names = tools.map(t => t.name);

assert.equal(tools.length, 9, 'C2 surface must be 9 ImerTerm tools: prior 8 plus bounded task_list');
assert.ok(names.includes('imerterm_task_list'));
assert.equal(new Set(names).size, names.length, 'tool names must be unique');
const list = tools.find(t => t.name === 'imerterm_task_list');
assert.equal(list.annotations?.readOnlyHint, true);
assert.equal(list.inputSchema?.properties?.limit?.maximum, 100);
assert.equal(list.inputSchema?.properties?.cursor?.maxLength, 256);
console.log('PASS C2 additive bounded read-only TASK_LIST surface');

const ps = tools.find(t => t.name === 'imerterm_run_powershell');
assert.deepEqual(ps.inputSchema?.properties?.execution_mode?.enum, ['SYNC', 'ASYNC']);
assert.equal(ps.inputSchema?.properties?.execution_mode?.default, 'SYNC');
assert.equal(ps.inputSchema?.properties?.admission_timeout_ms?.maximum, 10000);
console.log('PASS C2 PowerShell async mode is explicit and bounded while SYNC remains default');

assert.match(source, /if \(mode === 'SYNC'\)[\s\S]*requireCapabilities\('imerterm\.powershell_dispatch\/1'\)/);
assert.match(source, /requireCapabilities\('imerterm\.powershell_async_admission\/1', 'powershell_async_admission_v1'\)/);
assert.match(source, /schema: 'imerterm\.powershell_async_admission\/1', dispatch, admission_timeout_ms: admissionTimeout/);
console.log('PASS C2 async dispatch is dedicated-schema and capability-gated; v1 path remains present');

assert.match(source, /requireCapabilities\(undefined, 'task_list_v1'\)/);
assert.match(source, /operation: 'TASK_LIST', project_id: projectId, limit/);
assert.doesNotMatch(source, /sqlite|SELECT\s|INSERT\s|UPDATE\s|DELETE\s/i, 'thin adapter must not access task storage directly');
console.log('PASS C2 LIST delegates to ImerTerm local control without storage authority');

assert.match(source, /ADMISSION_TIMEOUT_NO_REPLAY/);
assert.match(source, /Do not replay the mutation\./);
assert.match(source, /Do not submit the same intended mutation under a new task_id\./);
assert.doesNotMatch(source, /Redis|RabbitMQ|Kafka|BullMQ|scheduler|retry database/i);
console.log('PASS C2 timeout semantics are observe-only and no second queue\/scheduler is introduced');

const wait = tools.find(t => t.name === 'imerterm_task_wait');
assert.equal(wait.annotations?.readOnlyHint, true);
assert.match(source, /WAIT_TIMEOUT[\s\S]*was not cancelled/);
console.log('PASS C2 WAIT remains bounded polling and never cancels on local timeout');

console.log('CHECKS=6 FAILURES=0');
console.log('IMERMCP_VNEXT_C2_CONFORMANCE_PASS');