#!/usr/bin/env node
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

const { BUSINESS_COMPOSE_TOOL, handleBusinessGoldTool } = await import('../dist/imermcp-local/business-gold-tools.js');

const iterations = 5000;
const durations = [];
let failures = 0;
const heapBefore = process.memoryUsage().heapUsed;

for (let i = 0; i < 100; i += 1) {
  await handleBusinessGoldTool(BUSINESS_COMPOSE_TOOL, { family: 'project_git_operations', operation: 'GIT_STATUS' });
}

for (let i = 0; i < iterations; i += 1) {
  const started = performance.now();
  const response = await handleBusinessGoldTool(BUSINESS_COMPOSE_TOOL, {
    family: 'project_git_operations', operation: 'GIT_STATUS',
  });
  durations.push(performance.now() - started);
  if (response.isError === true || response.structuredContent?.status !== 'COMPOSED_NO_EFFECT' || response.structuredContent?.eligible !== true) failures += 1;
}

const heapAfter = process.memoryUsage().heapUsed;
const sorted = [...durations].sort((a, b) => a - b);
const percentile = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const p50Ms = percentile(0.50);
const p95Ms = percentile(0.95);
const p99Ms = percentile(0.99);
const heapGrowthBytes = Math.max(0, heapAfter - heapBefore);

assert.equal(failures, 0);
assert.ok(p95Ms < 25, `p95 ${p95Ms.toFixed(3)}ms exceeded 25ms local planner SLO`);
assert.ok(heapGrowthBytes < 64 * 1024 * 1024, `heap growth ${heapGrowthBytes} exceeded 64MiB burn-in budget`);

const canary = 'C4_SECRET_CANARY_DO_NOT_PERSIST';
const raw = await handleBusinessGoldTool(BUSINESS_COMPOSE_TOOL, {
  family: 'raw_terminal_escape_hatch', operation: 'SSH_V1', justification: canary,
});
assert.equal(raw.isError, undefined);
assert.doesNotMatch(JSON.stringify(raw.structuredContent), new RegExp(canary));

console.log(JSON.stringify({
  schema: 'imermcp.c4_burn_in_report/1', status: 'PASS', iterations, failures,
  slo: { local_planner_p95_ms_max: 25, heap_growth_bytes_max: 64 * 1024 * 1024 },
  observed: { p50_ms: p50Ms, p95_ms: p95Ms, p99_ms: p99Ms, heap_growth_bytes: heapGrowthBytes },
  secret_canary_absent_from_response: true,
}, null, 2));
console.log('IMERMCP_BUSINESS_GOLD_C4_BURN_IN_PASS');
