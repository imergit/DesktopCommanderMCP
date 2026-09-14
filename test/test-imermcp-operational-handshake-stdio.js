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
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'imermcp-handshake-stdio-'));
const client = new Client({ name: 'handshake-stdio-test', version: '1.0.0' }, { capabilities: {} });
const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  IMERMCP_ENABLE_IMERTERM: '1',
  IMERMCP_IMERTERM_HOST_EXE: 'C:/ProgramData/ImerTerm/bin/ImerTerm.Host.exe',
  IMERMCP_IMERTERM_LOCAL_ROOT: 'C:/ProgramData/ImerTerm',
};
const transport = new StdioClientTransport({ command: 'node', args: [entry], env });

try {
  await client.connect(transport);
  const listed = await client.listTools();
  assert.equal(listed.tools.length, 38);
  const capTool = listed.tools.find(tool => tool.name === 'imerterm_capabilities');
  assert.ok(capTool);
  assert.match(capTool.description ?? '', /safe_next_action/);
  assert.match(capTool.description ?? '', /never bypass or auto-fallback/i);

  const result = await client.callTool({ name: 'imerterm_capabilities', arguments: {} });
  assert.equal(result.isError, undefined);
  const body = result.structuredContent;
  assert.equal(body.status, 'CONTROL_OK');
  const handshake = body.imermcp_operational_handshake;
  assert.equal(handshake.accepted, true);
  assert.equal(handshake.manual_directives.version, '1.4.0');
  assert.equal(handshake.ai_guidance.diagnostic_tool, 'imerterm_capabilities');
  assert.ok(handshake.ai_guidance.prohibitions.some(value => value.includes('UNKNOWN_OUTCOME')));
  console.log('PASS stdio tools/list exposes mandatory handshake guidance to the MCP client');
  console.log('PASS stdio capabilities returns accepted full operational handshake');
  console.log('PASS IMERMCP_OPERATIONAL_HANDSHAKE_STDIO_READONLY');
} finally {
  try { await client.close(); } catch {}
  await fs.rm(home, { recursive: true, force: true });
}
