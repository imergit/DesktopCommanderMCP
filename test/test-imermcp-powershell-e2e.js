#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const hostExe = process.env.IMERMCP_TEST_IMERTERM_HOST_EXE;
const localRoot = process.env.IMERMCP_TEST_IMERTERM_LOCAL_ROOT;
if (!hostExe || !localRoot) {
  console.log('SKIP POWERSHELL_E2E: shadow host/root not configured');
  process.exit(0);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(here, '..', 'dist', 'index.js');
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'imermcp-powershell-e2e-'));
const work = path.resolve(localRoot, '..', 'work');
const text = r => r?.content?.filter(x => x.type === 'text').map(x => x.text ?? '').join('\n') ?? '';
const body = r => r?.structuredContent ?? JSON.parse(text(r));
async function connect() {
  const client = new Client({ name: 'imermcp-powershell-e2e', version: '1.0.0' }, { capabilities: {} });
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    IMERMCP_ENABLE_IMERTERM: '1',
    IMERMCP_IMERTERM_HOST_EXE: hostExe,
    IMERMCP_IMERTERM_LOCAL_ROOT: localRoot,
  };
  const transport = new StdioClientTransport({ command: 'node', args: [entry], env });
  await client.connect(transport);
  return client;
}
function psArgs(script, extra = {}) {
  return {
    project_id: 'imermcp-shadow',
    target_id: 'p53-shadow',
    mutation_class: 'NONE',
    capability: 'POWERSHELL_EXEC',
    working_directory: work,
    script,
    timeout_ms: 10000,
    graceful_stop_ms: 250,
    max_raw_output_bytes: 65536,
    ...extra,
  };
}
function assertSuccess(result, marker) {
  assert.equal(result.isError, undefined, text(result));
  const value = body(result);
  assert.equal(value.status, 'EXECUTED_TERMINAL');
  assert.equal(value.state, 'SUCCEEDED');
  assert.equal(value.result_code, 'EXECUTION_SUCCEEDED');
  if (marker !== undefined) assert.match(value.result?.StandardOutput?.Text ?? '', marker);
  return value;
}
async function runPs(client, script, extra = {}) {
  return await client.callTool({ name: 'imerterm_run_powershell', arguments: psArgs(script, extra) });
}
const utf8Prefix = "$u=New-Object System.Text.UTF8Encoding($false); [Console]::OutputEncoding=$u; ";

let client;
try {
  client = await connect();
  const caps = body(await client.callTool({ name: 'imerterm_capabilities', arguments: {} }));
  assert.equal(caps.status, 'CONTROL_OK');
  assert.equal(caps.capabilities?.source_id, 'imermcp-shadow');
  console.log('PASS PowerShell shadow capabilities handshake');

  const ascii = assertSuccess(await runPs(client, `${utf8Prefix}[Console]::Write('ASCII_OK')`), /ASCII_OK/);
  assert.equal(ascii.result?.NativeExitCode, 0);
  console.log('PASS PowerShell ASCII baseline');
  const specialScript = [
    utf8Prefix,
    "$x = @'",
    "ASCII symbols: \"double\" 'apostrophe' `backtick` $dollar | pipe > redirect {brace}",
    'ação çã Ω 漢字 😀',
    "'@",
    '[Console]::Write($x)',
  ].join('\r\n');
  const special = assertSuccess(await runPs(client, specialScript));
  const specialOut = special.result?.StandardOutput?.Text ?? '';
  assert.ok(specialOut.includes('ASCII symbols: "double" \'apostrophe\' `backtick` $dollar | pipe > redirect {brace}'));
  assert.ok(specialOut.includes('ação çã Ω 漢字 😀'), `Unicode corruption: ${JSON.stringify(specialOut)}`);
  console.log('PASS quotes/backticks/dollar/pipes/braces and Unicode round-trip');

  const mixed = assertSuccess(await runPs(client, utf8Prefix + '[Console]::Write("A`r`nB`nC")'));
  assert.equal(mixed.result?.StandardOutput?.Text, 'A\r\nB\nC');
  console.log('PASS CRLF/LF exact round-trip');

  const longPayload = 'A'.repeat(48000);
  const longResult = assertSuccess(await runPs(client, `${utf8Prefix}$s='${longPayload}'; [Console]::Write($s.Length)`));
  assert.equal(longResult.result?.StandardOutput?.Text, '48000');
  console.log('PASS 48 KiB single-line script payload');
  const streams = assertSuccess(await runPs(client, `${utf8Prefix}[Console]::Write('OUT_OK'); [Console]::Error.Write('ERR_OK'); exit 0`));
  assert.equal(streams.result?.StandardOutput?.Text, 'OUT_OK');
  assert.equal(streams.result?.StandardError?.Text, 'ERR_OK');
  console.log('PASS stdout/stderr separation');

  const failedResult = await runPs(client, `${utf8Prefix}[Console]::Write('OUT_FAIL'); [Console]::Error.Write('ERR_FAIL'); exit 7`);
  assert.equal(failedResult.isError, undefined, text(failedResult));
  const failed = body(failedResult);
  assert.equal(failed.state, 'FAILED');
  assert.equal(failed.result_code, 'EXECUTION_FAILED');
  assert.equal(failed.result?.NativeExitCode, 7);
  assert.equal(failed.result?.StandardOutput?.Text, 'OUT_FAIL');
  assert.equal(failed.result?.StandardError?.Text, 'ERR_FAIL');
  console.log('PASS non-zero exit and structured failure mapping');

  const marker = path.join(work, `policy-denied-${randomUUID()}.txt`);
  const deniedResult = await runPs(client, `Set-Content -LiteralPath '${marker.replaceAll("'", "''")}' -Value 'SHOULD_NOT_EXIST'`, { mutation_class: 'PROJECT' });
  const denied = body(deniedResult);
  assert.equal(deniedResult.isError, undefined, text(deniedResult));
  assert.equal(denied.status, 'REJECTED');
  assert.equal(denied.result_code, 'MUTATION_CLASS_DENIED');
  await assert.rejects(fs.stat(marker));
  console.log('PASS PROJECT mutation denied before effect');
  const pathDeniedResult = await runPs(client, "[Console]::Write('SHOULD_NOT_RUN')", { working_directory: 'C:\\Windows' });
  assert.equal(pathDeniedResult.isError, undefined, text(pathDeniedResult));
  const pathDenied = body(pathDeniedResult);
  assert.equal(pathDenied.status, 'REJECTED');
  assert.equal(pathDenied.result_code, 'PATH_DENIED');
  console.log('PASS working-directory containment fail-closed');

  const timeoutStarted = Date.now();
  const timedResult = await runPs(client, "Start-Sleep -Seconds 30; [Console]::Write('SHOULD_NOT_REACH')", {
    timeout_ms: 500,
    graceful_stop_ms: 100,
  });
  const timed = body(timedResult);
  assert.equal(timedResult.isError, undefined, text(timedResult));
  assert.equal(timed.state, 'TIMED_OUT');
  assert.equal(timed.result_code, 'EXECUTION_TIMED_OUT');
  assert.ok(Date.now() - timeoutStarted < 5000, 'PowerShell timeout was not bounded');
  assert.doesNotMatch(timed.result?.StandardOutput?.Text ?? '', /SHOULD_NOT_REACH/);
  console.log('PASS bounded timeout and owned-process termination');

  const limitedResult = await runPs(client, "[Console]::Write(('X' * 200000))", { max_raw_output_bytes: 4096 });
  assert.equal(limitedResult.isError, undefined, text(limitedResult));
  const limited = body(limitedResult);
  assert.equal(limited.state, 'FAILED');
  assert.equal(limited.result_code, 'OUTPUT_LIMIT_EXCEEDED');
  assert.equal(limited.result?.OutputLimitExceeded, true);
  console.log('PASS bounded output-limit termination');
  const liveTaskId = randomUUID();
  const liveDispatch = client.callTool({ name: 'imerterm_run_powershell', arguments: psArgs(
    `${utf8Prefix}Start-Sleep -Seconds 2; [Console]::Write('LIVE_DONE')`,
    { task_id: liveTaskId, timeout_ms: 10000 }
  ) });
  await new Promise(resolve => setTimeout(resolve, 350));
  const liveShow = body(await client.callTool({ name: 'imerterm_task_show', arguments: { task_id: liveTaskId } }));
  assert.equal(liveShow.status, 'CONTROL_OK');
  assert.equal(liveShow.task?.task_id, liveTaskId);
  assert.equal(liveShow.task?.terminal, false, `expected nonterminal, got ${JSON.stringify(liveShow.task)}`);
  const waitedPromise = client.callTool({ name: 'imerterm_task_wait', arguments: {
    task_id: liveTaskId, poll_seconds: 1, wait_timeout_seconds: 10,
  } });
  const live = assertSuccess(await liveDispatch, /LIVE_DONE/);
  const waited = body(await waitedPromise);
  assert.equal(waited.task?.task_id, liveTaskId);
  assert.equal(waited.task?.terminal, true);
  assert.equal(live.task_id, liveTaskId);
  console.log('PASS concurrent TASK_SHOW/TASK_WAIT during PowerShell execution');

  const cancelUnsupported = await client.callTool({ name: 'imerterm_task_cancel', arguments: { task_id: liveTaskId } });
  assert.equal(cancelUnsupported.isError, true, 'PowerShell TASK_CANCEL must fail closed in M14');
  const cancelBody = body(cancelUnsupported);
  assert.equal(cancelBody.native_response?.status, 'INVALID_REQUEST');
  assert.equal(cancelBody.native_response?.result_code, 'INVALID_REQUEST');
  console.log('PASS PowerShell TASK_CANCEL gap is explicit and fail-closed');
  const nulResult = await runPs(client, "[Console]::Write('A\u0000B')");
  assert.equal(nulResult.isError, true, 'NUL-bearing PowerShell payload must fail closed');
  assert.match(text(nulResult), /NUL|invalid|CLI_EXIT_NONZERO/i);
  console.log('PASS NUL-bearing script fails closed');

  const oversized = 'B'.repeat(140000);
  const oversizedResult = await runPs(client, `${utf8Prefix}$s='${oversized}'; [Console]::Write($s.Length)`);
  assert.equal(oversizedResult.isError, true, 'request over local CLI bound must fail closed');
  console.log('PASS over-bound request fails closed');

  await client.close();
  client = undefined;
  console.log('PASS POWERSHELL_E2E');
} finally {
  if (client) { try { await client.close(); } catch {} }
  await fs.rm(home, { recursive: true, force: true });
}
