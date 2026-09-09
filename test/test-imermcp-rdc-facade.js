#!/usr/bin/env node
import assert from 'assert';
import os from 'os';
import path from 'path';
import fsp from 'fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const expectedRemoteOnly = ['list_devices', 'who_am_i', 'ping', 'shutdown'];
const expectedLocal = [
  'get_config','set_config_value','read_file','read_multiple_files','write_file','write_pdf',
  'create_directory','list_directory','move_file','start_search','get_more_search_results',
  'stop_search','list_searches','get_file_info','edit_block','start_process',
  'read_process_output','interact_with_process','force_terminate','list_sessions',
  'list_processes','kill_process','get_usage_stats','get_recent_tool_calls',
  'give_feedback_to_desktop_commander','get_prompts'
];

const text = result => result?.content?.filter(x => x.type === 'text').map(x => x.text ?? '').join('\n') ?? '';
const parseJsonText = result => JSON.parse(text(result));

async function run() {
  const client = new Client({ name: 'imermcp-rdc-facade-test', version: '1.0.0' }, { capabilities: {} });
  const transport = new StdioClientTransport({ command: 'node', args: ['../dist/index.js'] });
  await client.connect(transport);
  const listed = await client.listTools();
  const names = listed.tools.map(t => t.name).sort();
  assert.deepStrictEqual(names, [...expectedLocal, ...expectedRemoteOnly].sort(), 'northbound tool set must be 30-tool RDC-compatible surface');
  assert.strictEqual(listed.tools.length, 30);

  for (const name of expectedLocal) {
    const tool = listed.tools.find(t => t.name === name);
    assert.ok(tool, `missing ${name}`);
    assert.ok(tool.inputSchema?.properties?.deviceId, `${name} must accept optional deviceId`);
    assert.ok(!tool.inputSchema?.required?.includes('deviceId'), `${name}.deviceId must stay optional`);
    assert.ok(!Object.prototype.hasOwnProperty.call(tool.inputSchema?.properties ?? {}, 'origin'), `${name}.origin must not leak northbound`);
  }

  const edit = listed.tools.find(t => t.name === 'edit_block');
  assert.ok(edit.inputSchema.required.includes('file_path'));
  for (const key of ['file_path','old_string','new_string','expected_replacements','range','content','options','deviceId']) {
    assert.ok(edit.inputSchema.properties[key], `edit_block missing ${key}`);
  }

  const devices = parseJsonText(await client.callTool({ name: 'list_devices', arguments: {} }));
  assert.strictEqual(devices.length, 1);
  assert.strictEqual(devices[0].status, 'online');
  assert.strictEqual(devices[0].device_name, os.hostname());
  const deviceId = devices[0].id;
  assert.ok(typeof deviceId === 'string' && deviceId.length > 0);
  const who = parseJsonText(await client.callTool({ name: 'who_am_i', arguments: {} }));
  assert.strictEqual(who.role, 'authenticated');
  assert.strictEqual(who.supabase_connected, false);
  assert.strictEqual(who.device_count, 1);
  assert.strictEqual(who.app_metadata?.provider, 'imermcp-local');

  const pong = text(await client.callTool({ name: 'ping', arguments: { deviceId } }));
  assert.match(pong, /^pong \d{4}-\d{2}-\d{2}T/);

  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'imermcp-rdc-facade-'));
  const file = path.join(tmp, 'sample.txt');
  await fsp.writeFile(file, 'facade-ok\n', 'utf8');
  try {
    const read = text(await client.callTool({ name: 'read_file', arguments: { path: file, deviceId } }));
    assert.ok(read.includes('facade-ok'));
    assert.ok(!read.includes('Unsupported parameter'), 'deviceId must be consumed by facade');
    const bad = await client.callTool({ name: 'read_file', arguments: { path: file, deviceId: 'not-this-device' } });
    assert.strictEqual(bad.isError, true, 'unknown deviceId must fail closed');
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }

  console.log('PASS: 30-tool RDC-compatible local facade, device routing and safe shim semantics');
  await client.close();
}

run().catch(error => { console.error(error); process.exit(1); });
