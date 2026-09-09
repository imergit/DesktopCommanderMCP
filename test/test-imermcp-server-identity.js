#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(here, '..', 'dist', 'index.js');
const client = new Client({ name: 'imermcp-identity-test', version: '1.0.0' }, { capabilities: {} });
const transport = new StdioClientTransport({ command: 'node', args: [entry] });
await client.connect(transport);
const serverInfo = client.getServerVersion();
const tools = await client.listTools();
assert.equal(serverInfo?.name, 'ImerMCP-Local');
assert.equal(serverInfo?.version, '0.2.48');
assert.equal(tools.tools.length, 30);
await client.close();
console.log('PASS: ImerMCP-Local identity and 30-tool startup surface');