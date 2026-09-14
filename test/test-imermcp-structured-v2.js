#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildSshDispatchForCapabilities, getImerTermTools } from '../dist/imermcp-local/imerterm-tools.js';

const capsV2 = {
  protocol_epoch: 1,
  dispatch_schemas: ['imerterm.bash_dispatch/1', 'imerterm.bash_dispatch/2'],
  features: ['bash_dispatch_v1', 'artifact_staging_v1', 'structured_dispatch_v2', 'structured_runtime_catalog_v1'],
  openssh_targets: ['gb10'],
};

const shaA = 'A'.repeat(64);
const base = {
  task_id: '11111111-1111-4111-8111-111111111111',
  project_id: 'imermcp',
  target_id: 'gb10',
  mutation_class: 'NONE',
  run_as: 'USER',
};

const tools = getImerTermTools();
assert.equal(tools.length, 8);
const ssh = tools.find(t => t.name === 'imerterm_run_ssh');
assert.ok(ssh);
assert.equal(ssh.annotations.readOnlyHint, false);
assert.deepEqual(ssh.inputSchema.properties.dispatch_mode.enum, ['V1_RAW', 'V2_STRUCTURED']);
assert.equal(ssh.inputSchema.properties.artifacts.maxItems, 32);
console.log('PASS Structured V2 reuses the existing eight-tool northbound surface');

const v1 = buildSshDispatchForCapabilities({ ...base, script: 'true' }, capsV2);
assert.equal(v1.payload.schema, 'imerterm.bash_dispatch/1');
assert.equal(v1.payload.script, 'true');
assert.equal(v1.payload.runtime_id, undefined);
console.log('PASS V1 remains the backward-compatible default');

const v2 = buildSshDispatchForCapabilities({
  ...base,
  dispatch_mode: 'V2_STRUCTURED',
  runtime_id: 'python3',
  entrypoint_artifact_id: 'entry',
  arguments: [
    { kind: 'ARTIFACT_PATH', artifact_id: 'entry' },
    { kind: 'LITERAL', value: '--check' },
  ],
  artifacts: [
    { artifact_id: 'entry', source_kind: 'LOCAL_FILE', source_path: 'D:/staging/check.py', byte_length: 3, sha256: shaA },
  ],
  runtime_max_seconds: 5,
}, capsV2);
assert.equal(v2.payload.schema, 'imerterm.bash_dispatch/2');
assert.equal(v2.payload.runtime_id, 'python3');
assert.equal(v2.payload.entrypoint_artifact_id, 'entry');
assert.equal(v2.payload.script, undefined);
assert.equal(v2.payload.artifacts[0].sha256, shaA.toLowerCase());
assert.equal(v2.timeoutMs, 20000);
console.log('PASS V2 payload uses runtime_id, typed argv and logical artifacts with no raw script');

assert.throws(() => buildSshDispatchForCapabilities({
  ...base,
  dispatch_mode: 'V2_STRUCTURED',
  script: 'echo hidden',
  runtime_id: 'python3',
  entrypoint_artifact_id: 'entry',
  arguments: [],
  artifacts: [{ artifact_id: 'entry', source_kind: 'LOCAL_FILE', source_path: 'D:/x', byte_length: 1, sha256: shaA }],
}, capsV2), /script is forbidden/);
console.log('PASS V2 hidden raw script fails closed');

const capsMissingFeature = {
  ...capsV2,
  features: ['bash_dispatch_v1', 'artifact_staging_v1', 'structured_dispatch_v2'],
};
assert.throws(() => buildSshDispatchForCapabilities({
  ...base,
  dispatch_mode: 'V2_STRUCTURED',
  runtime_id: 'python3',
  entrypoint_artifact_id: 'entry',
  arguments: [],
  artifacts: [{ artifact_id: 'entry', source_kind: 'LOCAL_FILE', source_path: 'D:/x', byte_length: 1, sha256: shaA }],
}, capsMissingFeature), /structured_runtime_catalog_v1/);
console.log('PASS V2 capability gate is conjunctive and fail-closed');

assert.throws(() => buildSshDispatchForCapabilities({
  ...base,
  script: 'true',
  runtime_id: 'python3',
}, capsV2), /requires dispatch_mode=V2_STRUCTURED/);
console.log('PASS V1/V2 field mixing fails closed');

assert.throws(() => buildSshDispatchForCapabilities({
  ...base,
  dispatch_mode: 'V2_STRUCTURED',
  runtime_id: 'python3',
  entrypoint_artifact_id: 'missing',
  arguments: [],
  artifacts: [{ artifact_id: 'entry', source_kind: 'LOCAL_FILE', source_path: 'D:/x', byte_length: 1, sha256: shaA }],
}, capsV2), /entrypoint_artifact_id/);
console.log('PASS missing V2 entrypoint artifact fails closed');

assert.throws(() => buildSshDispatchForCapabilities({
  ...base,
  dispatch_mode: 'V2_STRUCTURED',
  runtime_id: 'python3',
  entrypoint_artifact_id: 'entry',
  arguments: [],
  artifacts: [
    { artifact_id: 'entry', source_kind: 'LOCAL_FILE', source_path: 'D:/a', byte_length: 400000000, sha256: shaA },
    { artifact_id: 'b', source_kind: 'LOCAL_FILE', source_path: 'D:/b', byte_length: 400000000, sha256: shaA },
    { artifact_id: 'c', source_kind: 'LOCAL_FILE', source_path: 'D:/c', byte_length: 400000000, sha256: shaA },
  ],
}, capsV2), /Total artifact bytes/);
console.log('PASS aggregate artifact quota fails closed');

assert.throws(() => buildSshDispatchForCapabilities({
  ...base,
  dispatch_mode: 'V2_STRUCTURED',
  runtime_id: 'python3',
  entrypoint_artifact_id: 'entry',
  arguments: [{ kind: 'ARTIFACT_PATH', artifact_id: 'not-declared' }],
  artifacts: [{ artifact_id: 'entry', source_kind: 'LOCAL_FILE', source_path: 'D:/x', byte_length: 1, sha256: shaA }],
}, capsV2), /ARTIFACT_PATH|artifact/);
console.log('PASS structured argument validation remains fail-closed');

console.log('PASS IMERMCP_STRUCTURED_V2_UNIT');
