#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

process.env.IMERMCP_ENABLE_IMERTERM = '1';
process.env.IMERMCP_IMERTERM_HOST_EXE = 'C:\\ProgramData\\ImerTerm\\bin\\ImerTerm.Host.exe';
process.env.IMERMCP_IMERTERM_LOCAL_ROOT = 'C:\\ProgramData\\ImerTerm';

const {
  BUSINESS_CAPABILITIES_TOOL,
  BUSINESS_COMPOSE_TOOL,
  handleBusinessGoldTool,
} = await import('../dist/imermcp-local/business-gold-tools.js');

const discovered = await handleBusinessGoldTool(BUSINESS_CAPABILITIES_TOOL, {});
assert.equal(discovered.isError, undefined);
assert.equal(discovered.structuredContent?.schema, 'imermcp.business_gold_capabilities/1');
assert.equal(discovered.structuredContent?.status, 'VNEXT_C4_SHADOW');
assert.equal(discovered.structuredContent?.live_imerterm_error, false);
const live = discovered.structuredContent?.live_imerterm;
assert.equal(live?.status, 'CONTROL_OK');
assert.equal(live?.result_code, 'CAPABILITIES');
assert.equal(live?.operational_handshake?.accepted, true);
assert.equal(live?.capabilities?.protocol_epoch, 1);
for (const feature of ['artifact_staging_v1', 'structured_dispatch_v2', 'structured_runtime_catalog_v1']) {
  assert.ok(live?.capabilities?.features?.includes(feature), `missing live feature ${feature}`);
}
assert.ok(live?.capabilities?.openssh_targets?.includes('gb10'));

const gb10 = await handleBusinessGoldTool(BUSINESS_COMPOSE_TOOL, {
  family: 'compute_offload_operations', operation: 'GB10_OFFLOAD',
});
assert.equal(gb10.isError, undefined);
assert.equal(gb10.structuredContent?.status, 'COMPOSED_NO_EFFECT');
assert.equal(gb10.structuredContent?.route?.executor_tool, 'imerterm_run_ssh');
assert.equal(gb10.structuredContent?.route?.effect_authority, 'IMERTERM');
assert.equal(gb10.structuredContent?.route?.mode, 'V2_STRUCTURED');
assert.ok(gb10.structuredContent?.route?.required_constraints?.includes('NO_V2_TO_V1_FALLBACK'));
assert.equal(gb10.structuredContent?.live_imerterm_error, false);

const report = {
  schema: 'imermcp.c4_live_boundary_report/1',
  status: 'PASS',
  protocol_epoch: live.capabilities.protocol_epoch,
  operational_handshake: live.operational_handshake.accepted,
  gb10_advertised: live.capabilities.openssh_targets.includes('gb10'),
  required_features: ['artifact_staging_v1', 'structured_dispatch_v2', 'structured_runtime_catalog_v1'],
  composed_route: {
    provider: gb10.structuredContent.route.provider,
    executor_tool: gb10.structuredContent.route.executor_tool,
    effect_authority: gb10.structuredContent.route.effect_authority,
    mode: gb10.structuredContent.route.mode,
  },
  effect_performed: false,
};
const reportPath = process.env.IMERMCP_C4_LIVE_REPORT ?? 'c4-live-boundary-report.json';
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log('IMERMCP_BUSINESS_GOLD_C4_LIVE_BOUNDARY_PASS');
