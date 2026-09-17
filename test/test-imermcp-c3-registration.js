import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const base = 'D:\\054.imermcp-c3-registration-e2e';
process.env.IMERMCP_MATERIALIZATION_ROOT = path.join(base, 'materialized');
process.env.IMERMCP_MATERIALIZATION_PROJECTS = 'regtest';
process.env.IMERMCP_MATERIALIZATION_MAX_AGGREGATE_BYTES = '1048576';
await fs.rm(base, { recursive: true, force: true });

const { server } = await import('../dist/server.js');
const { installFileMaterializationBoundary } = await import('../dist/imermcp-local/file-materialization-registration.js');
installFileMaterializationBoundary(server);
installFileMaterializationBoundary(server);

const handlers = server._requestHandlers;
const list = handlers.get('tools/list');
const call = handlers.get('tools/call');
assert.equal(typeof list, 'function');
assert.equal(typeof call, 'function');
const listed = await list({ method: 'tools/list', params: {} }, {});
const c3Tools = listed.tools.filter(tool => tool.name === 'imermcp_materialize_file');
assert.equal(c3Tools.length, 1);

const bytes = Buffer.from('registration-boundary');
const sha = crypto.createHash('sha256').update(bytes).digest('hex');
const materialized = await call({
  method: 'tools/call',
  params: {
    name: 'imermcp_materialize_file',
    arguments: {
      request_id: 'reg-1', project_id: 'regtest', artifact_id: 'reg-artifact',
      destination_name: 'reg.bin', bytes_base64: bytes.toString('base64'),
      expected_byte_length: bytes.length, expected_sha256: sha,
    },
  },
}, {});
assert.equal(materialized.isError, undefined);
assert.equal(materialized.structuredContent.status, 'MATERIALIZED');
assert.equal(materialized.structuredContent.local_file.sha256, sha);
const delegated = await call({ method: 'tools/call', params: { name: 'list_devices', arguments: {} } }, {});
assert.equal(delegated.isError, undefined);
assert.ok(Array.isArray(JSON.parse(delegated.content[0].text)));

const report = {
  schema: 'imermcp.c3_registration_report/1',
  status: 'PASS',
  tool_count: c3Tools.length,
  materialized_sha256: sha,
  prior_handler_delegation: 'PASS',
  duplicate_install: 'IDEMPOTENT',
};
await fs.writeFile('c3-registration-report.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8');
