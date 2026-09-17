import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
process.env.IMERMCP_ENABLE_IMERTERM = '1';
process.env.IMERMCP_IMERTERM_HOST_EXE = 'C:\\ProgramData\\ImerTerm\\bin\\ImerTerm.Host.exe';
process.env.IMERMCP_IMERTERM_LOCAL_ROOT = 'C:\\ProgramData\\ImerTerm';
const { getImerTermCapabilities } = await import('../dist/imermcp-local/imerterm-client.js');
const { buildSshDispatchForCapabilities } = await import('../dist/imermcp-local/imerterm-tools.js');
const input = JSON.parse(await fs.readFile('c3-imerterm-composition-input.json', 'utf8'));
const live = await getImerTermCapabilities();
assert.equal(live.status, 'CONTROL_OK');
assert.equal(live.result_code, 'CAPABILITIES');
const caps = live.capabilities;
for (const feature of ['artifact_staging_v1', 'structured_dispatch_v2', 'structured_runtime_catalog_v1']) assert(caps.features.includes(feature));
assert(caps.dispatch_schemas.includes('imerterm.bash_dispatch/2'));
assert(caps.openssh_targets.includes('gb10'));
const lf = input.local_file;
const built = buildSshDispatchForCapabilities({
  project_id: 'imerterm', target_id: 'gb10', mutation_class: 'NONE', run_as: 'USER',
  dispatch_mode: 'V2_STRUCTURED', runtime_id: 'python3', entrypoint_artifact_id: 'entry', arguments: [],
  artifacts: [{ artifact_id: 'entry', source_kind: 'LOCAL_FILE', source_path: lf.source_path, byte_length: lf.byte_length, sha256: lf.sha256 }],
  runtime_max_seconds: 30,
}, caps);
assert.equal(built.payload.schema, 'imerterm.bash_dispatch/2');
assert.deepEqual(built.payload.artifacts[0], { artifact_id: 'entry', source_kind: 'LOCAL_FILE', source_path: lf.source_path, byte_length: lf.byte_length, sha256: lf.sha256 });
const report = { schema: 'imermcp.c3_live_boundary_report/1', status: 'PASS', live_protocol_epoch: caps.protocol_epoch, required_features: ['artifact_staging_v1','structured_dispatch_v2','structured_runtime_catalog_v1'], dispatch_schema: built.payload.schema, local_file: { byte_length: lf.byte_length, sha256: lf.sha256 } };
await fs.writeFile('c3-live-boundary-report.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8');
