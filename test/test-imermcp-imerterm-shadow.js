#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const hostExe = process.env.IMERMCP_TEST_IMERTERM_HOST_EXE;
const localRoot = process.env.IMERMCP_TEST_IMERTERM_LOCAL_ROOT;
if (!hostExe || !localRoot) {
  console.log('SKIP IMERMCP_IMERTERM_SHADOW: test host/root not configured');
  process.exit(0);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(here, '..', 'dist', 'index.js');
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'imermcp-imerterm-shadow-'));
const text = r => r?.content?.filter(x => x.type === 'text').map(x => x.text ?? '').join('\n') ?? '';
const body = r => r?.structuredContent ?? JSON.parse(text(r));
async function connect(name, extraEnv = {}) {
  const client = new Client({ name, version: '1.0.0' }, { capabilities: {} });
  const env = { ...process.env, HOME: home, USERPROFILE: home, ...extraEnv };
  const transport = new StdioClientTransport({ command: 'node', args: [entry], env });
  await client.connect(transport);
  return client;
}

let plain;
let shadow;
try {
  const plainEnv = { ...process.env };
  delete plainEnv.IMERMCP_ENABLE_IMERTERM;
  delete plainEnv.IMERMCP_IMERTERM_HOST_EXE;
  delete plainEnv.IMERMCP_IMERTERM_LOCAL_ROOT;
  plain = await connect('imermcp-default-30', plainEnv);
  assert.equal((await plain.listTools()).tools.length, 30, 'default RDC surface must remain 30 tools');
  await plain.close();
  plain = undefined;
  console.log('PASS default RDC surface remains exactly 30 tools');
  shadow = await connect('imermcp-imerterm-shadow', {
    IMERMCP_ENABLE_IMERTERM: '1',
    IMERMCP_IMERTERM_HOST_EXE: hostExe,
    IMERMCP_IMERTERM_LOCAL_ROOT: localRoot,
  });
  const listed = await shadow.listTools();
  assert.equal(listed.tools.length, 38, 'enabled surface must be 30 RDC + 8 ImerTerm tools');
  for (const name of ['imerterm_capabilities','imerterm_run_powershell','imerterm_run_ssh','imerterm_run_routeros','imerterm_task_show','imerterm_task_wait','imerterm_task_cancel','imerterm_task_journal']) {
    assert.ok(listed.tools.some(t => t.name === name), `missing ${name}`);
  }
  console.log('PASS additive 8-tool ImerTerm surface');

  const capsResult = await shadow.callTool({ name: 'imerterm_capabilities', arguments: {} });
  assert.equal(capsResult.isError, undefined);
  const caps = body(capsResult);
  assert.equal(caps.status, 'CONTROL_OK');
  assert.equal(caps.result_code, 'CAPABILITIES');
  assert.equal(caps.capabilities?.source_id, 'imermcp-shadow');
  assert.deepEqual(caps.capabilities?.openssh_targets, []);
  assert.deepEqual(caps.capabilities?.routeros_targets, []);
  console.log('PASS ImerTerm capabilities through MCP adapter');
  const workingDirectory = path.resolve(localRoot, '..', 'work');
  const noopResult = await shadow.callTool({ name: 'imerterm_run_powershell', arguments: {
    project_id: 'imermcp-shadow',
    target_id: 'p53-shadow',
    mutation_class: 'NONE',
    capability: 'NOOP',
    working_directory: workingDirectory,
    script: "Write-Output 'IMERTERM_NOOP'; exit 0",
    timeout_ms: 10000,
    graceful_stop_ms: 1000,
    max_raw_output_bytes: 65536,
  } });
  assert.equal(noopResult.isError, undefined, text(noopResult));
  const noop = body(noopResult);
  assert.equal(noop.status, 'EXECUTED_TERMINAL');
  assert.equal(noop.state, 'SUCCEEDED');
  assert.equal(noop.result_code, 'EXECUTION_SUCCEEDED');
  assert.match(noop.result?.StandardOutput?.Text ?? '', /IMERTERM_NOOP/);
  const taskId = noop.task_id;
  assert.equal(typeof taskId, 'string');
  console.log(`PASS governed NOOP through MCP -> ImerMCP -> ImerTerm task=${taskId}`);
  const shown = body(await shadow.callTool({ name: 'imerterm_task_show', arguments: { task_id: taskId } }));
  assert.equal(shown.status, 'CONTROL_OK');
  assert.equal(shown.task?.task_id, taskId);
  assert.equal(shown.task?.terminal, true);
  const journalResult = await shadow.callTool({ name: 'imerterm_task_journal', arguments: { task_id: taskId } });
  assert.equal(journalResult.isError, true, 'PowerShell task journal must fail closed');
  const journal = body(journalResult);
  assert.equal(journal.error_class, 'CLI_EXIT_NONZERO');
  assert.equal(journal.exit_code, 64);
  assert.equal(journal.native_response?.status, 'INVALID_REQUEST');
  assert.equal(journal.native_response?.result_code, 'INVALID_REQUEST');
  console.log('PASS TASK_SHOW and PowerShell TASK_JOURNAL native fail-closed mapping');

  const sshDenied = await shadow.callTool({ name: 'imerterm_run_ssh', arguments: {
    project_id: 'imermcp-shadow', target_id: 'gb10', mutation_class: 'NONE', run_as: 'USER', script: 'true'
  } });
  assert.equal(sshDenied.isError, true, 'disabled OpenSSH target must fail closed');
  assert.match(text(sshDenied), /does not expose target gb10/);
  const rosDenied = await shadow.callTool({ name: 'imerterm_run_routeros', arguments: {
    project_id: 'imermcp-shadow', target_id: 'crs112-router-223', mutation_class: 'NONE', command: '/system identity print'
  } });
  assert.equal(rosDenied.isError, true, 'disabled RouterOS target must fail closed');
  assert.match(text(rosDenied), /does not expose target crs112-router-223/);
  console.log('PASS disabled SSH/RouterOS targets fail closed before dispatch');
  await shadow.close();
  shadow = undefined;
  console.log('PASS IMERMCP_IMERTERM_SHADOW');
} finally {
  if (plain) { try { await plain.close(); } catch {} }
  if (shadow) { try { await shadow.close(); } catch {} }
  await fs.rm(home, { recursive: true, force: true });
}
