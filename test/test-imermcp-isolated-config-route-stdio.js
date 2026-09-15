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
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'imermcp-isolated-config-'));
const configFile = path.join(root, 'config.json');
await fs.writeFile(configFile, JSON.stringify({ blockedCommands: [], allowedDirectories: [], defaultShell: 'powershell.exe', telemetryEnabled: false, fileReadLineLimit: 10000, fileWriteLineLimit: 10000 }));
const client = new Client({ name: 'imermcp-isolated-config-route', version: '1.0.0' }, { capabilities: {} });
const transport = new StdioClientTransport({ command: 'node', args: [entry], env: { ...process.env, IMERMCP_ENABLE_IMERTERM: '1', IMERMCP_IMERTERM_HOST_EXE: 'C:/ProgramData/ImerTerm/bin/ImerTerm.Host.exe', IMERMCP_IMERTERM_LOCAL_ROOT: 'C:/ProgramData/ImerTerm', IMERMCP_CONFIG_FILE: configFile } });
await client.connect(transport);
try {
  const cfg = await client.callTool({ name: 'get_config', arguments: {} });
  const cfgText = cfg.content.filter(x => x.type === 'text').map(x => x.text ?? '').join('\n');
  assert.match(cfgText, /"fileReadLineLimit"\s*:\s*10000/);
  assert.match(cfgText, /"fileWriteLineLimit"\s*:\s*10000/);
  assert.match(cfgText, /"blockedCommands"\s*:\s*\[\]/);
  const denied = await client.callTool({ name: 'start_process', arguments: { command: 'shutdown' } });
  assert.equal(denied.isError, true);
  const deniedText = denied.content.filter(x => x.type === 'text').map(x => x.text ?? '').join('\n');
  assert.match(deniedText, /IMERTERM_ROUTE_REQUIRED/);

  const allowed = await client.callTool({ name: 'start_process', arguments: { command: 'echo IMERMCP_ROUTE_OK', timeout_ms: 5000 } });
  assert.equal(allowed.isError, undefined);
  const allowedText = allowed.content.filter(x => x.type === 'text').map(x => x.text ?? '').join('\n');
  assert.match(allowedText, /IMERMCP_ROUTE_OK/);
  console.log('PASS isolated config + empty static blocklist + governed ImerTerm route');
} finally {
  await client.close();
  await fs.rm(root, { recursive: true, force: true });
}
