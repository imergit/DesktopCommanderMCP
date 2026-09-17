#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUSINESS_CAPABILITIES_TOOL,
  BUSINESS_COMPOSE_TOOL,
  BUSINESS_GOLD_FAMILIES,
  getBusinessGoldTools,
  handleBusinessGoldTool,
} from '../dist/imermcp-local/business-gold-tools.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(here, '..', 'src', 'imermcp-local', 'business-gold-tools.ts');
const registrationPath = path.resolve(here, '..', 'src', 'imermcp-local', 'business-gold-registration.ts');
const source = await fs.readFile(sourcePath, 'utf8');
const registration = await fs.readFile(registrationPath, 'utf8');

const tools = getBusinessGoldTools();
const names = tools.map(tool => tool.name);
assert.deepEqual(names, [BUSINESS_CAPABILITIES_TOOL, BUSINESS_COMPOSE_TOOL]);
assert.equal(new Set(names).size, 2);
assert.ok(tools.every(tool => tool.annotations?.readOnlyHint === true));
assert.ok(tools.every(tool => tool.annotations?.destructiveHint === false));
console.log('PASS C4 compact surface exposes exactly two read-only semantic planning/discovery tools');

assert.deepEqual(BUSINESS_GOLD_FAMILIES, [
  'capabilities_discovery',
  'artifact_operations',
  'project_git_operations',
  'compute_offload_operations',
  'service_operations',
  'truth_imerspine_operations',
  'task_lifecycle',
  'raw_terminal_escape_hatch',
]);
console.log('PASS C4 exposes the exact eight canonical Business GOLD capability families');

const compose = tools.find(tool => tool.name === BUSINESS_COMPOSE_TOOL);
assert.equal(compose.inputSchema?.additionalProperties, false);
assert.equal(compose.inputSchema?.properties?.justification?.maxLength, 512);
assert.ok(compose.inputSchema?.properties?.operation?.enum?.includes('GB10_OFFLOAD'));
assert.ok(compose.inputSchema?.properties?.operation?.enum?.includes('GIT_COMMIT_GOVERNED'));
assert.ok(compose.inputSchema?.properties?.operation?.enum?.includes('UPDATE_IMERSPINE'));
console.log('PASS C4 compose schema is closed, bounded and covers cross-provider canonical operations');

const gitPlan = await handleBusinessGoldTool(BUSINESS_COMPOSE_TOOL, {
  family: 'project_git_operations', operation: 'GIT_COMMIT_GOVERNED',
});
assert.equal(gitPlan.isError, undefined);
assert.equal(gitPlan.structuredContent?.status, 'COMPOSED_NO_EFFECT');
assert.equal(gitPlan.structuredContent?.route?.provider, 'GITHUB_CONNECTOR');
assert.equal(gitPlan.structuredContent?.route?.executor_tool, null);
assert.match(String(gitPlan.structuredContent?.next_action), /GITHUB_CONNECTOR/);
console.log('PASS C4 Git operation composes to native GitHub provider without impersonating Git authority');

const invalidCrossFamily = await handleBusinessGoldTool(BUSINESS_COMPOSE_TOOL, {
  family: 'task_lifecycle', operation: 'GB10_OFFLOAD',
});
assert.equal(invalidCrossFamily.isError, true);
assert.equal(invalidCrossFamily.structuredContent?.error_class, 'OPERATION_NOT_IN_FAMILY');
console.log('PASS C4 discriminated family/operation routing fails closed on cross-family mismatch');

const rawWithoutReason = await handleBusinessGoldTool(BUSINESS_COMPOSE_TOOL, {
  family: 'raw_terminal_escape_hatch', operation: 'SSH_V1',
});
assert.equal(rawWithoutReason.isError, true);
assert.equal(rawWithoutReason.structuredContent?.error_class, 'RAW_ESCAPE_JUSTIFICATION_REQUIRED');
console.log('PASS C4 raw terminal remains explicit escape hatch requiring justification');

assert.match(source, /NO_V2_TO_V1_FALLBACK/);
assert.match(source, /Do not auto-fallback from Structured V2 to raw V1/);
assert.match(source, /Do not replay UNKNOWN_OUTCOME/);
assert.match(source, /IMERMCP_HOST_LOCAL_MATERIALIZATION_ONLY/);
assert.match(source, /SOLE_EFFECT_TASK_COMPLETION_CANCELLATION_RECOVERY_AUTHORITY/);
assert.doesNotMatch(source, /sqlite|SELECT\s|INSERT\s|UPDATE\s+tasks|Redis|RabbitMQ|Kafka|BullMQ/i);
console.log('PASS C4 preserves fail-closed fallback/replay rules and introduces no parallel task storage/queue authority');

assert.match(registration, /raw_escape_justification_present/);
assert.doesNotMatch(registration, /justification:\s*args\.justification/);
assert.match(registration, /if \(!names\.has\(request\.params\.name\)\) return await priorCall/);
console.log('PASS C4 registration tracks bounded metadata only and delegates pre-existing ABI unchanged');

console.log('CHECKS=8 FAILURES=0');
console.log('IMERMCP_BUSINESS_GOLD_C4_CONFORMANCE_PASS');
