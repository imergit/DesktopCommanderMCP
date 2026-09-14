#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  evaluateOperationalHandshake,
  EXPECTED_INTEROP_SHA256,
  EXPECTED_MANUAL_HEAD,
  EXPECTED_MANUAL_SHA256,
  ImerTermPolicyError,
  requireAcceptedHandshake,
  requireAdvertisedValue,
} from '../dist/imermcp-local/imerterm-policy.js';

const baseCaps = {
  schema: 'imerterm.local_capabilities/1',
  protocol_epoch: 1,
  dispatch_schemas: [
    'imerterm.powershell_dispatch/1',
    'imerterm.bash_dispatch/1',
    'imerterm.bash_dispatch/2',
    'imerterm.routeros_dispatch/1',
    'imerterm.local_control/1',
  ],
  features: [
    'capabilities_handshake_v1', 'task_control_v1', 'task_show_v1',
    'task_cancel_v1', 'task_journal_v1', 'bash_dispatch_v1',
    'routeros_dispatch_v1', 'artifact_staging_v1',
    'structured_dispatch_v2', 'structured_runtime_catalog_v1',
  ],
  openssh_targets: ['gb10', 'ufv-it01'],
  routeros_targets: ['crs112-router-223'],
};

const nativeResponse = caps => ({
  schema: 'imerterm.local_dispatch_response/1',
  status: 'CONTROL_OK',
  result_code: 'CAPABILITIES',
  capabilities: caps,
});

const goodBindings = {
  manual: {
    kind: 'IMERTERM_OPERATIONS_MANUAL', path: 'manual.json',
    expected_sha256: EXPECTED_MANUAL_SHA256,
    observed_sha256: EXPECTED_MANUAL_SHA256, verified: true,
  },
  interop: {
    kind: 'IMERMCP_INTEROP_CONTRACT', path: 'contract.json',
    expected_sha256: EXPECTED_INTEROP_SHA256,
    observed_sha256: EXPECTED_INTEROP_SHA256, verified: true,
  },
};

const accepted = evaluateOperationalHandshake(nativeResponse(baseCaps), goodBindings);
assert.equal(accepted.accepted, true);
assert.equal(accepted.rejections.length, 0);
assert.equal(accepted.manual_binding.version, '1.4.0');
assert.equal(accepted.manual_binding.source_head, EXPECTED_MANUAL_HEAD);
assert.equal(accepted.interop_binding.version, '1.3.0');
assert.equal(accepted.authority.effect_authority, 'IMERTERM');
assert.equal(accepted.authority.transport_is_execution_authority, false);
assert.ok(accepted.rules.length >= 35);
console.log('PASS valid base handshake is accepted and binds exact manual/contract authority');

assert.ok(accepted.unresolved_context.includes('DISC-001'));
assert.ok(accepted.unresolved_context.includes('HEALTH-001'));
assert.equal(accepted.rules.find(r => r.id === 'DISC-001')?.status, 'REQUIRES_CONTEXT');
assert.equal(accepted.accepted, true);
const categories = new Set(accepted.rules.map(r => r.category));
for (const category of [
  'AUTHORITY', 'DISCOVERY', 'RDC_GIT', 'COMMAND_CONSTRUCTION',
  'EFFECT_SEMANTICS', 'SECRETS', 'PROHIBITED_API', 'HEALTH',
  'LIMITS', 'RECOVERY', 'PROVENANCE', 'OPERATOR', 'INTEROP',
  'STRUCTURED_V2', 'KNOWN_LIMIT',
]) assert.ok(categories.has(category), `missing policy category ${category}`);
console.log('PASS contextual rules remain visible and actionable without deadlocking unrelated operations');

const manualMismatch = evaluateOperationalHandshake(nativeResponse(baseCaps), {
  ...goodBindings,
  manual: { ...goodBindings.manual, observed_sha256: '0'.repeat(64), verified: false },
});
assert.equal(manualMismatch.accepted, false);
const manualReason = manualMismatch.rejections[0];
assert.equal(manualReason.reason_code, 'IMERTERM_MANUAL_BINDING_MISMATCH');
assert.equal(manualReason.rule_ref, 'manual.binding.sha256');
assert.equal(manualReason.retryable, true);
assert.equal(manualReason.safe_next_action.action, 'RECOVER_AUTHORITATIVE_MANUAL');
assert.match(manualReason.safe_next_action.instruction, /Do not dispatch/);
console.log('PASS manual byte mismatch blocks with structured cause and safe recovery guidance');

const epochMismatch = evaluateOperationalHandshake(nativeResponse({ ...baseCaps, protocol_epoch: 2 }), goodBindings);
assert.equal(epochMismatch.accepted, false);
const epochReason = epochMismatch.rejections.find(r => r.reason_code === 'IMERTERM_PROTOCOL_EPOCH_MISMATCH');
assert.ok(epochReason);
assert.equal(epochReason.retryable, false);
assert.equal(epochReason.safe_next_action.action, 'STOP_INCOMPATIBLE_HOST');
console.log('PASS incompatible protocol epoch fails closed without compatibility inference');

const missingBaseFeature = evaluateOperationalHandshake(nativeResponse({
  ...baseCaps,
  features: baseCaps.features.filter(x => x !== 'capabilities_handshake_v1'),
}), goodBindings);
assert.equal(missingBaseFeature.accepted, false);
const baseFeatureReason = missingBaseFeature.rejections.find(r => r.reason_code === 'IMERTERM_REQUIRED_FEATURE_MISSING');
assert.ok(baseFeatureReason);
assert.equal(baseFeatureReason.safe_next_action.action, 'REFRESH_CAPABILITIES');
assert.match(baseFeatureReason.safe_next_action.instruction, /do not bypass/i);
console.log('PASS missing base capability produces explicit retry guidance and no bypass');

const withoutV2 = evaluateOperationalHandshake(nativeResponse({
  ...baseCaps,
  dispatch_schemas: baseCaps.dispatch_schemas.filter(x => x !== 'imerterm.bash_dispatch/2'),
  features: baseCaps.features.filter(x => !['artifact_staging_v1', 'structured_dispatch_v2', 'structured_runtime_catalog_v1'].includes(x)),
}), goodBindings);
assert.equal(withoutV2.accepted, true);
const v2Rule = withoutV2.rules.find(r => r.id === 'RUNTIME-003');
assert.equal(v2Rule?.status, 'REQUIRES_CONTEXT');
assert.match(v2Rule?.guidance ?? '', /never auto-fallback/i);
console.log('PASS V2 absence does not deadlock valid V1/control operations and still forbids fallback');

assert.throws(
  () => requireAcceptedHandshake(manualMismatch),
  error => error instanceof ImerTermPolicyError &&
    error.rejection.reason_code === 'IMERTERM_MANUAL_BINDING_MISMATCH' &&
    error.handshake === manualMismatch,
);
console.log('PASS rejected handshake carries the full diagnostic context to the caller');

assert.throws(
  () => requireAdvertisedValue(
    baseCaps, 'openssh_targets', 'not-advertised',
    'manual.discovery_order.fail_closed', 'IMERTERM_TARGET_NOT_ADVERTISED',
    'Refresh Capabilities and select an advertised target. Do not call SSH directly.',
  ),
  error => error instanceof ImerTermPolicyError &&
    error.rejection.reason_code === 'IMERTERM_TARGET_NOT_ADVERTISED' &&
    error.rejection.retryable === true &&
    error.rejection.safe_next_action.action === 'REFRESH_CAPABILITIES' &&
    /Do not call SSH directly/.test(error.rejection.safe_next_action.instruction),
);
console.log('PASS target rejection explains the rule and safe next action without suggesting bypass');

assert.equal(manualReason.rule_authority.kind, 'IMERTERM_OPERATIONS_MANUAL');
assert.equal(manualReason.rule_authority.version, '1.4.0');
assert.equal(manualReason.rule_authority.sha256, EXPECTED_MANUAL_SHA256);
assert.equal(accepted.ai_guidance.diagnostic_tool, 'imerterm_capabilities');
assert.ok(accepted.ai_guidance.on_blocked.some(x => /safe_next_action/.test(x)));
assert.ok(accepted.ai_guidance.on_requires_context.some(x => /not a global failure/.test(x)));
assert.ok(accepted.ai_guidance.prohibitions.some(x => /UNKNOWN_OUTCOME/.test(x)));
console.log('PASS every block names its exact authority and handshake carries AI recovery instructions');

assert.equal(EXPECTED_MANUAL_SHA256, '5b66e149810366e99cc5108461d711d26aec2e3da053aa1779152d85413d4a30');
assert.equal(EXPECTED_INTEROP_SHA256, '1147a227b336d04e42d5386a1032a632158f9dac771ce6d52581846e54fc99dc');
console.log('PASS accepted manual and interop identities are exact and content-addressed');
console.log('PASS IMERMCP_OPERATIONAL_HANDSHAKE_UNIT');
