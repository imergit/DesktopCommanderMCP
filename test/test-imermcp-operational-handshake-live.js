#!/usr/bin/env node
import assert from 'node:assert/strict';

process.env.IMERMCP_ENABLE_IMERTERM = '1';
process.env.IMERMCP_IMERTERM_HOST_EXE = 'C:\\ProgramData\\ImerTerm\\bin\\ImerTerm.Host.exe';
process.env.IMERMCP_IMERTERM_LOCAL_ROOT = 'C:\\ProgramData\\ImerTerm';

const { handleImerTermTool, getImerTermTools } = await import('../dist/imermcp-local/imerterm-tools.js');
const result = await handleImerTermTool('imerterm_capabilities', {});
assert.equal(result.isError, undefined);
assert.equal(typeof result.structuredContent, 'object');
const body = result.structuredContent;
assert.equal(body.status, 'CONTROL_OK');
assert.equal(body.result_code, 'CAPABILITIES');
const handshake = body.imermcp_operational_handshake;
assert.equal(handshake.schema, 'imermcp.imerterm_operational_handshake/1');
assert.equal(handshake.accepted, true);
assert.equal(handshake.rejections.length, 0);
assert.equal(handshake.manual_binding.verified, true);
assert.equal(handshake.interop_binding.verified, true);
assert.equal(handshake.authority.effect_authority, 'IMERTERM');
assert.ok(handshake.unresolved_context.length > 0);
assert.equal(handshake.manual_directives.schema, 'imerterm.operations_manual/1');
assert.equal(handshake.manual_directives.version, '1.4.0');
assert.ok(Array.isArray(handshake.manual_directives.discovery_order));
assert.ok(Array.isArray(handshake.manual_directives.prohibited_parallel_apis));
assert.equal(handshake.manual_directives.rdc_git_worktree_enrollment.prohibitions.includes('Never use safe.directory=*.'), true);
const diagnosticBytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
assert.ok(diagnosticBytes < 65536, `diagnostic payload too large: ${diagnosticBytes}`);
assert.equal(getImerTermTools().length, 8);
console.log(`PASS live operational handshake accepted rules=${handshake.rules.length} context=${handshake.unresolved_context.length} bytes=${diagnosticBytes}`);
console.log('PASS live capabilities remains diagnostic and eight-tool ABI is unchanged');

const invalidV2 = await handleImerTermTool('imerterm_run_ssh', {
  project_id: 'imermcp', target_id: 'gb10', mutation_class: 'NONE', run_as: 'USER',
  dispatch_mode: 'V2_STRUCTURED', script: 'hidden raw payload', runtime_id: 'python3',
  entrypoint_artifact_id: 'entry', arguments: [], artifacts: [],
});
assert.equal(invalidV2.isError, true);
const invalidV2Body = invalidV2.structuredContent;
assert.equal(invalidV2Body.reason_code, 'IMERMCP_REQUEST_VALIDATION_REJECTED');
assert.equal(invalidV2Body.rule_authority.kind, 'IMERMCP_INTEROP_CONTRACT');
assert.equal(invalidV2Body.safe_next_action.action, 'CORRECT_REQUEST');
assert.match(invalidV2Body.safe_next_action.instruction, /do not bypass ImerTerm/i);
console.log('PASS invalid request is rejected before dispatch with corrective AI guidance');

const badTarget = await handleImerTermTool('imerterm_run_ssh', {
  project_id: 'imermcp', target_id: '__not_advertised__', mutation_class: 'NONE', run_as: 'USER', script: 'true',
});
assert.equal(badTarget.isError, true);
const badTargetBody = badTarget.structuredContent;
assert.equal(badTargetBody.reason_code, 'IMERTERM_TARGET_NOT_ADVERTISED');
assert.equal(badTargetBody.safe_next_action.action, 'REFRESH_CAPABILITIES');
assert.match(badTargetBody.safe_next_action.instruction, /Do not bypass ImerTerm/i);
console.log('PASS unadvertised target is rejected before dispatch with refresh/no-bypass guidance');
console.log('PASS IMERMCP_OPERATIONAL_HANDSHAKE_LIVE_READONLY');
