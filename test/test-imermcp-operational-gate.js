import assert from 'node:assert/strict';
import {
  evaluateOperationalGate,
  OperationalGateError,
  OPERATIONAL_POLICY,
} from '../dist/imermcp-local/imerterm-operational-gate.js';

const baseline = {
  protocol_epoch: 1,
  dispatch_schemas: ['imerterm.bash_dispatch/1', 'imerterm.bash_dispatch/2'],
  features: ['bash_dispatch_v1', 'artifact_staging_v1', 'structured_dispatch_v2', 'structured_runtime_catalog_v1'],
  openssh_targets: ['gb10'],
};

const accepted = evaluateOperationalGate(baseline, {
  dispatchSchema: 'imerterm.bash_dispatch/2',
  features: ['artifact_staging_v1', 'structured_dispatch_v2', 'structured_runtime_catalog_v1'],
  targetKey: 'openssh_targets',
  targetId: 'gb10',
});
assert.equal(accepted.accepted, true);
assert.equal(accepted.result_code, 'HANDSHAKE_ACCEPTED');
assert.equal(OPERATIONAL_POLICY.source_manual.version, '1.4.0');
assert.equal(OPERATIONAL_POLICY.source_manual.sha256, '5b66e149810366e99cc5108461d711d26aec2e3da053aa1779152d85413d4a30');
function expectReject(caps, requirement, code) {
  let caught;
  try { evaluateOperationalGate(caps, requirement); }
  catch (error) { caught = error; }
  assert.ok(caught instanceof OperationalGateError);
  assert.equal(caught.gate.accepted, false);
  assert.equal(caught.gate.result_code, 'HANDSHAKE_REJECTED');
  assert.equal(caught.gate.reason_code, code);
  assert.equal(typeof caught.gate.next_allowed_action, 'string');
  assert.ok(caught.gate.next_allowed_action.length > 0);
  assert.ok(Array.isArray(caught.gate.prohibited_actions));
  assert.ok(caught.gate.prohibited_actions.length > 0);
  return caught.gate;
}

expectReject({ ...baseline, protocol_epoch: 2 }, {}, 'IMERTERM_PROTOCOL_EPOCH_MISMATCH');
expectReject(baseline, { dispatchSchema: 'imerterm.powershell_dispatch/2' }, 'IMERTERM_DISPATCH_SCHEMA_MISSING');
const featureGate = expectReject(
  { ...baseline, features: ['artifact_staging_v1'] },
  { features: ['structured_dispatch_v2'] },
  'IMERTERM_FEATURE_MISSING',
);
assert.ok(featureGate.prohibited_actions.some(x => x.includes('auto-fallback')));
expectReject(
  baseline,
  { targetKey: 'openssh_targets', targetId: 'missing-target' },
  'IMERTERM_TARGET_NOT_ADVERTISED',
);
assert.equal(OPERATIONAL_POLICY.effect_semantics.unknown_outcome_automatic_replay, false);
assert.equal(OPERATIONAL_POLICY.rdc_git.wildcard_safe_directory_allowed, false);
assert.equal(OPERATIONAL_POLICY.command_construction.dynamic_nested_shell_interpolation, false);
assert.equal(OPERATIONAL_POLICY.prohibited_parallel_apis.direct_ssh_for_governed_targets, false);
assert.equal(OPERATIONAL_POLICY.enforcement_model.not_verified_is_not_pass, true);
assert.ok(OPERATIONAL_POLICY.enforcement_model.live_handshake.includes('protocol_epoch'));
assert.ok(OPERATIONAL_POLICY.enforcement_model.live_per_operation.includes('advertised_target'));
assert.ok(OPERATIONAL_POLICY.enforcement_model.static_policy_guidance.includes('project_preflight'));

console.log('IMERMCP_OPERATIONAL_GATE_TEST_PASS');
