#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(here, '..', 'dist', 'index.js');
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'imermcp-v2-m14-'));
const staging = 'D:/019.imerterm/.imerspine/workspace/m14-v2-e2e';
await fs.mkdir(staging, { recursive: true });
const runnerPath = staging + '/runner.py';
const payloadPath = staging + '/payload.bin';
const runner = Buffer.from("import hashlib,sys\np=sys.argv[1]\ne=sys.argv[2]\nh=hashlib.sha256(open(p,'rb').read()).hexdigest()\nprint('M14_IMERMCP_V2_SHA256='+h)\nraise SystemExit(0 if h==e else 17)\n");
const payload = Buffer.alloc(131109);
for (let i=0;i<payload.length;i++) payload[i]=(i*29+11)&255;
await fs.writeFile(runnerPath, runner);
await fs.writeFile(payloadPath, payload);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const runnerSha = sha(runner);
const payloadSha = sha(payload);
const text = r => r?.content?.filter(x => x.type === 'text').map(x => x.text ?? '').join('\n') ?? '';
const body = r => r?.structuredContent ?? JSON.parse(text(r));
const client = new Client({ name: 'imermcp-m14-v2-physical', version: '1.0.0' }, { capabilities: {} });
const transport = new StdioClientTransport({
  command: 'node',
  args: [entry],
  env: {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    IMERMCP_ENABLE_IMERTERM: '1',
    IMERMCP_IMERTERM_HOST_EXE: 'C:/ProgramData/ImerTerm/bin/ImerTerm.Host.exe',
    IMERMCP_IMERTERM_LOCAL_ROOT: 'C:/ProgramData/ImerTerm'
  }
});
await client.connect(transport);
try {
  const caps = body(await client.callTool({ name: 'imerterm_capabilities', arguments: {} }));
  assert.ok(caps.capabilities?.dispatch_schemas?.includes('imerterm.bash_dispatch/2'));
  assert.ok(caps.capabilities?.features?.includes('artifact_staging_v1'));
  assert.ok(caps.capabilities?.features?.includes('structured_dispatch_v2'));
  assert.ok(caps.capabilities?.features?.includes('structured_runtime_catalog_v1'));
  assert.ok(caps.capabilities?.openssh_targets?.includes('gb10'));
  console.log('PASS production capabilities advertise qualified Bash V2 to gb10');
  const taskId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const args = {
    task_id: taskId,
    created_at_utc: createdAt,
    project_id: 'imerterm',
    target_id: 'gb10',
    mutation_class: 'PROJECT',
    dispatch_mode: 'V2_STRUCTURED',
    run_as: 'USER',
    runtime_id: 'python3',
    entrypoint_artifact_id: 'runner',
    arguments: [
      { kind: 'ARTIFACT_PATH', artifact_id: 'payload' },
      { kind: 'LITERAL', value: payloadSha }
    ],
    artifacts: [
      { artifact_id: 'runner', source_kind: 'LOCAL_FILE', source_path: runnerPath, byte_length: runner.length, sha256: runnerSha },
      { artifact_id: 'payload', source_kind: 'LOCAL_FILE', source_path: payloadPath, byte_length: payload.length, sha256: payloadSha }
    ],
    runtime_max_seconds: 120
  };
  const startedResult = await client.callTool({ name: 'imerterm_run_ssh', arguments: args });
  assert.equal(startedResult.isError, undefined, text(startedResult));
  const started = body(startedResult);
  assert.equal(started.task_id, taskId);
  assert.ok(['EXECUTED_NONTERMINAL','EXECUTED_TERMINAL','DUPLICATE_TERMINAL'].includes(started.status));
  console.log('PASS Structured V2 crossed ImerMCP -> ImerTerm release boundary task=' + taskId);
  const terminalResult = await client.callTool({ name: 'imerterm_task_wait', arguments: { task_id: taskId, poll_seconds: 1, wait_timeout_seconds: 90 } });
  assert.equal(terminalResult.isError, undefined, text(terminalResult));
  const terminal = body(terminalResult);
  assert.equal(terminal.task?.terminal, true);
  assert.equal(terminal.task?.state, 'SUCCEEDED');
  assert.equal(terminal.task?.completion_proven, true);
  const stdout = terminal.remote?.stdout_text ?? terminal.remote?.StdoutText ?? '';
  assert.match(stdout, new RegExp('M14_IMERMCP_V2_SHA256=' + payloadSha));
  console.log('PASS Structured V2 terminal success proves exact payload SHA256');

  const duplicateResult = await client.callTool({ name: 'imerterm_run_ssh', arguments: args });
  assert.equal(duplicateResult.isError, undefined, text(duplicateResult));
  const duplicate = body(duplicateResult);
  assert.equal(duplicate.status, 'DUPLICATE_TERMINAL');
  assert.equal(duplicate.state, 'SUCCEEDED');
  console.log('PASS exact retry returns DUPLICATE_TERMINAL without replay');

  const badArgs = { ...args, task_id: crypto.randomUUID(), created_at_utc: new Date().toISOString(), runtime_id: 'missing-runtime' };
  const badResult = await client.callTool({ name: 'imerterm_run_ssh', arguments: badArgs });
  const bad = body(badResult);
  assert.ok(badResult.isError === true || bad.status === 'REJECTED');
  assert.match(text(badResult) + JSON.stringify(bad), /STRUCTURED_RUNTIME_UNKNOWN|missing-runtime/);
  console.log('PASS unknown runtime fails closed with no raw V1 fallback');
  console.log('PASS IMERMCP_M14_STRUCTURED_V2_PHYSICAL');
} finally {
  try { await client.close(); } catch {}
  try { await fs.rm(home, { recursive: true, force: true }); } catch {}
}
