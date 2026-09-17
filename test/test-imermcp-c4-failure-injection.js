#!/usr/bin/env node
import assert from 'node:assert/strict';

process.env.IMERMCP_ENABLE_IMERTERM = '1';
process.env.IMERMCP_IMERTERM_HOST_EXE = 'C:\\definitely-not-present\\ImerTerm.Host.exe';
process.env.IMERMCP_IMERTERM_LOCAL_ROOT = 'C:\\ProgramData\\ImerTerm';

const {
  BUSINESS_CAPABILITIES_TOOL,
  BUSINESS_COMPOSE_TOOL,
  handleBusinessGoldTool,
} = await import('../dist/imermcp-local/business-gold-tools.js');

const discovered = await handleBusinessGoldTool(BUSINESS_CAPABILITIES_TOOL, {});
assert.equal(discovered.isError, undefined);
assert.equal(discovered.structuredContent?.live_imerterm_error, true);
assert.equal(discovered.structuredContent?.live_imerterm_eligible, false);

const gb10 = await handleBusinessGoldTool(BUSINESS_COMPOSE_TOOL, {
  family: 'compute_offload_operations', operation: 'GB10_OFFLOAD',
});
assert.equal(gb10.isError, undefined);
assert.equal(gb10.structuredContent?.status, 'INELIGIBLE_NO_EFFECT');
assert.equal(gb10.structuredContent?.eligible, false);
assert.equal(gb10.structuredContent?.eligibility?.reason_code, 'LIVE_IMERTERM_CAPABILITIES_UNAVAILABLE');
assert.equal(gb10.structuredContent?.next_action, null);
assert.match(String(gb10.structuredContent?.next_allowed_action), /Refresh live ImerTerm capabilities/);
assert.ok(gb10.structuredContent?.prohibited_actions?.includes('Do not invoke the executor while live eligibility is false.'));

const git = await handleBusinessGoldTool(BUSINESS_COMPOSE_TOOL, {
  family: 'project_git_operations', operation: 'GIT_STATUS',
});
assert.equal(git.isError, undefined);
assert.equal(git.structuredContent?.status, 'COMPOSED_NO_EFFECT');
assert.equal(git.structuredContent?.eligible, true);
assert.equal(git.structuredContent?.eligibility?.reason_code, 'STATIC_PROVIDER_ELIGIBLE');

console.log('CHECKS=3 FAILURES=0');
console.log('IMERMCP_BUSINESS_GOLD_C4_FAIL_CLOSED_PASS');
