#!/usr/bin/env node
import assert from 'assert';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(here, '..', 'dist', 'index.js');

const text = result => result?.content?.filter(x => x.type === 'text').map(x => x.text ?? '').join('\n') ?? '';

async function run() {
  const client = new Client({ name: 'imermcp-shutdown-test', version: '1.0.0' }, { capabilities: {} });
  const transport = new StdioClientTransport({ command: 'node', args: [entry] });
  await client.connect(transport);
  const result = await client.callTool({ name: 'shutdown', arguments: {} });
  assert.match(text(result), /^Shutting down ImerMCP-Local on /);
  await new Promise(resolve => setTimeout(resolve, 500));
  let closed = false;
  try {
    await client.callTool({ name: 'ping', arguments: {} });
  } catch {
    closed = true;
  }
  assert.strictEqual(closed, true, 'shutdown must terminate the dev MCP child after acknowledging');
  try { await client.close(); } catch {}
  console.log('PASS: shutdown acknowledges then terminates only the isolated MCP child');
}

run().catch(error => { console.error(error); process.exit(1); });
