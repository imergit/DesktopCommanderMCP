#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(here, '..', 'dist', 'index.js');
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'imermcp-conformance-'));
const text = r => r?.content?.filter(x => x.type === 'text').map(x => x.text ?? '').join('\n') ?? '';
const pidOf = r => Number(text(r).match(/Process started with PID (\d+)/)?.[1] ?? 0);
const client = new Client({ name: 'imermcp-local-conformance', version: '1.0.0' }, { capabilities: {} });
const transport = new StdioClientTransport({ command: 'node', args: [entry], env: { ...process.env, HOME: home, USERPROFILE: home } });
let replPid = 0;
let cancelPid = 0;
try {
  await client.connect(transport);
  assert.equal(client.getServerVersion()?.name, 'ImerMCP-Local');
  const caps = client.getServerCapabilities();
  for (const key of ['tools','resources','prompts','logging']) assert.ok(caps?.[key] !== undefined, `missing capability ${key}`);
  const listed = await client.listTools();
  assert.equal(listed.tools.length, 30);
  for (const tool of listed.tools) {
    const props = tool.inputSchema?.properties ?? {};
    for (const forbidden of ['transport','serverUrl','server_url','tunnel']) assert.ok(!(forbidden in props), `${tool.name} leaks transport field ${forbidden}`);
  }
  const resources = await client.listResources();
  assert.equal(resources.resources.length, 2);
  for (const resource of resources.resources) {
    const got = await client.readResource({ uri: resource.uri });
    assert.ok((got.contents ?? []).length > 0, `empty resource ${resource.uri}`);
  }
  assert.equal((await client.listPrompts()).prompts.length, 0);
  console.log('PASS capabilities/resources/prompts and transport-independent tool schemas');
  const parallelStarted = Date.now();
  const pongs = await Promise.all(Array.from({ length: 16 }, () => client.callTool({ name: 'ping', arguments: {} })));
  assert.ok(pongs.every(r => /^pong \d{4}-\d{2}-\d{2}T/.test(text(r))), 'parallel ping response mismatch');
  assert.ok(Date.now() - parallelStarted < 5000, 'parallel calls exceeded bounded local threshold');
  console.log('PASS 16 parallel MCP calls');

  const repl = await client.callTool({ name: 'start_process', arguments: { command: 'node -i', timeout_ms: 5000 } });
  replPid = pidOf(repl);
  assert.ok(replPid > 0, 'no REPL PID');
  const replOut = await client.callTool({ name: 'interact_with_process', arguments: { pid: replPid, input: 'console.log("IMERMCP_LONG_SESSION_OK")', wait_for_prompt: true, timeout_ms: 5000 } });
  assert.ok(text(replOut).includes('IMERMCP_LONG_SESSION_OK'));
  const sessions = text(await client.callTool({ name: 'list_sessions', arguments: {} }));
  assert.ok(sessions.includes(String(replPid)), 'long-lived session missing from list_sessions');
  console.log('PASS long-lived process session');
  const noisy = await client.callTool({ name: 'start_process', arguments: { command: 'node -e "let i=0;const t=setInterval(()=>{console.log(`BOUND_${i}`);if(++i===300)clearInterval(t)},2)"', timeout_ms: 200 } });
  const noisyPid = pidOf(noisy);
  assert.ok(noisyPid > 0, 'no noisy-process PID');
  await new Promise(resolve => setTimeout(resolve, 1000));
  const bounded = text(await client.callTool({ name: 'read_process_output', arguments: { pid: noisyPid, offset: 1, length: 25, timeout_ms: 1000 } }));
  const boundedLines = bounded.split(/\r?\n/).filter(line => line.includes('BOUND_'));
  assert.ok(boundedLines.length <= 25 && boundedLines.length > 0, `bounded output returned ${boundedLines.length} payload lines`);
  try { await client.callTool({ name: 'force_terminate', arguments: { pid: noisyPid } }); } catch {}
  console.log('PASS bounded process output pagination');

  const silent = await client.callTool({ name: 'start_process', arguments: { command: 'node -e "setInterval(()=>{},1000)"', timeout_ms: 200 } });
  cancelPid = pidOf(silent);
  assert.ok(cancelPid > 0, 'no cancellation PID');
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 250).unref?.();
  const cancelStarted = Date.now();
  let cancelled = false;
  try {
    await client.callTool({ name: 'read_process_output', arguments: { pid: cancelPid, timeout_ms: 10000 } }, undefined, { signal: controller.signal });
  } catch (error) {
    cancelled = controller.signal.aborted;
  }
  assert.ok(cancelled, 'MCP request was not cancelled by AbortSignal');
  assert.ok(Date.now() - cancelStarted < 2000, 'MCP cancellation exceeded bounded latency');
  const afterCancel = await client.callTool({ name: 'ping', arguments: {} });
  assert.match(text(afterCancel), /^pong /, 'server unhealthy after cancellation');
  console.log('PASS MCP request cancellation and post-cancel health');

  await client.callTool({ name: 'force_terminate', arguments: { pid: cancelPid } });
  cancelPid = 0;
  await client.callTool({ name: 'force_terminate', arguments: { pid: replPid } });
  replPid = 0;
  await client.close();
  console.log('PASS stdio lifecycle clean close');
  console.log('PASS IMERMCP_LOCAL_MCP_CONFORMANCE');
} finally {
  if (cancelPid) { try { await client.callTool({ name: 'force_terminate', arguments: { pid: cancelPid } }); } catch {} }
  if (replPid) { try { await client.callTool({ name: 'force_terminate', arguments: { pid: replPid } }); } catch {} }
  try { await client.close(); } catch {}
  await fs.rm(home, { recursive: true, force: true });
}
