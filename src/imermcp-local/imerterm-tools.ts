import { randomUUID } from 'node:crypto';
import type { ServerResult } from '../types.js';
import {
  controlImerTerm,
  dispatchImerTerm,
  getImerTermCapabilities,
  ImerTermAdapterError,
  isImerTermEnabled,
} from './imerterm-client.js';
import {
  buildOperationalHandshake, ImerTermPolicyError, requestValidationError, requireAcceptedHandshake, requireAdvertisedValue,
} from './imerterm-policy.js';

const names = new Set([
  'imerterm_capabilities',
  'imerterm_run_powershell',
  'imerterm_run_ssh',
  'imerterm_run_routeros',
  'imerterm_task_show',
  'imerterm_task_wait',
  'imerterm_task_cancel',
  'imerterm_task_journal',
]);

export { isImerTermEnabled } from './imerterm-client.js';
export function isImerTermTool(name: string): boolean { return names.has(name); }
const emptySchema = { type: 'object', properties: {}, additionalProperties: false };
const taskSchema = {
  type: 'object',
  properties: { task_id: { type: 'string', format: 'uuid' } },
  required: ['task_id'],
  additionalProperties: false,
};
const mutationClass = { type: 'string', enum: ['NONE', 'PROJECT', 'PRIVILEGED'] };

function baseTaskProperties(): Record<string, unknown> {
  return {
    task_id: { type: 'string', format: 'uuid', description: 'Optional caller-supplied durable ImerTerm task identity. Generated when omitted.' },
    created_at_utc: { type: 'string', description: 'Optional stable task creation timestamp. Supply together with task_id when an intentional exact retry must preserve the same intent.' },
    project_id: { type: 'string' },
    target_id: { type: 'string' },
    mutation_class: mutationClass,
  };
}

export function getImerTermTools(): any[] {
  return [
    { name: 'imerterm_capabilities', description: 'Mandatory read-only operational handshake before ImerTerm effect/control. Returns native Host capabilities, exact manual/interop bindings, the full hash-verified operations manual, rule status and AI recovery guidance. If accepted=false, do not dispatch: follow safe_next_action and refresh this diagnostic handshake; never bypass or auto-fallback.', inputSchema: emptySchema, annotations: { title: 'ImerTerm Capabilities', readOnlyHint: true } },
    {
      name: 'imerterm_run_powershell',
      description: 'Dispatch governed Windows PowerShell only after an accepted ImerTerm operational handshake. ImerMCP does not execute or reinterpret the script. Policy rejection reports reason, exact rule authority and safe_next_action; never bypass ImerTerm or infer unadvertised capabilities.',
      inputSchema: {
        type: 'object',
        properties: {
          ...baseTaskProperties(),
          capability: { type: 'string' },
          working_directory: { type: 'string' },
          script: { type: 'string' },
          timeout_ms: { type: 'integer', minimum: 1, maximum: 3600000, default: 300000 },
          graceful_stop_ms: { type: 'integer', minimum: 0, maximum: 30000, default: 5000 },
          max_raw_output_bytes: { type: 'integer', minimum: 1, maximum: 268435456, default: 1048576 },
        },
        required: ['project_id', 'target_id', 'mutation_class', 'capability', 'working_directory', 'script'],
        additionalProperties: false,
      },
      annotations: { title: 'ImerTerm PowerShell', readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    {
      name: 'imerterm_run_ssh',
      description: 'Dispatch governed Bash only after an accepted ImerTerm operational handshake. V1_RAW remains independently valid; V2_STRUCTURED is explicit, conjunctively capability-gated and never auto-falls back. Policy rejection reports reason/rule/safe_next_action. SSH lifecycle, attestation and execution remain owned by ImerTerm.',
      inputSchema: {
        type: 'object',
        properties: {
          ...baseTaskProperties(),
          dispatch_mode: { type: 'string', enum: ['V1_RAW', 'V2_STRUCTURED'], default: 'V1_RAW' },
          run_as: { type: 'string', enum: ['USER', 'ROOT'], default: 'USER' },
          script: { type: 'string' },
          runtime_id: { type: 'string' },
          entrypoint_artifact_id: { type: 'string' },
          arguments: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: ['LITERAL', 'ARTIFACT_PATH'] }, value: { type: 'string' }, artifact_id: { type: 'string' } }, required: ['kind'], additionalProperties: false } },
          artifacts: { type: 'array', maxItems: 32, items: { type: 'object', properties: { artifact_id: { type: 'string' }, source_kind: { type: 'string', enum: ['LOCAL_FILE'] }, source_path: { type: 'string' }, byte_length: { type: 'integer', minimum: 0, maximum: 536870912 }, sha256: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' } }, required: ['artifact_id', 'source_kind', 'source_path', 'byte_length', 'sha256'], additionalProperties: false } },
          runtime_max_seconds: { type: 'integer', minimum: 1, maximum: 86400 },
        },
        required: ['project_id', 'target_id', 'mutation_class', 'run_as'],
        additionalProperties: false,
      },
      annotations: { title: 'ImerTerm SSH/Bash', readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    {
      name: 'imerterm_run_routeros',
      description: 'Dispatch RouterOS only after an accepted ImerTerm operational handshake and advertised target. Policy rejection reports reason/rule/safe_next_action. Never bypass ImerTerm with direct RouterOS CLI.',
      inputSchema: {
        type: 'object',
        properties: {
          ...baseTaskProperties(),
          command: { type: 'string' },
        },
        required: ['project_id', 'target_id', 'mutation_class', 'command'],
        additionalProperties: false,
      },
      annotations: { title: 'ImerTerm RouterOS', readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    { name: 'imerterm_task_show', description: 'Read durable ImerTerm task state by task_id.', inputSchema: taskSchema, annotations: { title: 'ImerTerm Task Show', readOnlyHint: true } },
    {
      name: 'imerterm_task_wait',
      description: 'Poll governed TASK_SHOW client-side until terminal or a bounded local timeout. Timeout never cancels the remote task.',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string', format: 'uuid' },
          poll_seconds: { type: 'integer', minimum: 1, maximum: 30, default: 2 },
          wait_timeout_seconds: { type: 'integer', minimum: 1, maximum: 3600, default: 60 },
        },
        required: ['task_id'],
        additionalProperties: false,
      },
      annotations: { title: 'ImerTerm Task Wait', readOnlyHint: true },
    },
    { name: 'imerterm_task_cancel', description: 'Request governed cancellation for an existing ImerTerm task. Never replays the task.', inputSchema: taskSchema, annotations: { title: 'ImerTerm Task Cancel', readOnlyHint: false, destructiveHint: true, openWorldHint: false } },
    { name: 'imerterm_task_journal', description: 'Read the bounded governed ImerTerm task journal/status evidence.', inputSchema: taskSchema, annotations: { title: 'ImerTerm Task Journal', readOnlyHint: true } },
  ];
}

function asObject(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw requestValidationError('Tool arguments must be an object.');
  return args as Record<string, unknown>;
}
function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) throw requestValidationError(`${key} is required.`);
  return value;
}
function optionalInt(args: Record<string, unknown>, key: string, fallback?: number): number | undefined {
  const value = args[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value)) throw requestValidationError(`${key} must be an integer.`);
  return value;
}
function taskId(args: Record<string, unknown>): string {
  const value = args.task_id;
  if (value === undefined) return randomUUID();
  if (typeof value !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(value)) throw requestValidationError('task_id must be a UUID string.');
  return value;
}
function responseResult(value: Record<string, unknown>): ServerResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value };
}
function errorResult(error: unknown): ServerResult {
  const code = error instanceof ImerTermPolicyError ? error.rejection.reason_code : error instanceof ImerTermAdapterError ? error.code : 'ADAPTER_ERROR';
  const message = error instanceof Error ? error.message : String(error);
  const body: Record<string, unknown> = { schema: 'imermcp.imerterm_error/1', error_class: code, message };
  if (error instanceof ImerTermPolicyError) {
    Object.assign(body, error.rejection);
    if (error.handshake) body.operational_handshake = error.handshake;
  }
  if (error instanceof ImerTermAdapterError) {
    if (error.exitCode !== undefined) body.exit_code = error.exitCode;
    if (error.nativeResponse !== undefined) body.native_response = error.nativeResponse;
  }
  return { content: [{ type: 'text', text: JSON.stringify(body, null, 2) }], structuredContent: body, isError: true };
}
async function operationalHandshake(): Promise<{ response: Record<string, unknown>; caps: Record<string, unknown> }> {
  const response = await getImerTermCapabilities();
  const handshake = await buildOperationalHandshake(response);
  return { response, caps: requireAcceptedHandshake(handshake) };
}
async function diagnosticCapabilitiesResponse(): Promise<Record<string, unknown>> {
  const response = await getImerTermCapabilities();
  const handshake = await buildOperationalHandshake(response);
  return { ...response, imermcp_operational_handshake: handshake };
}
function taskEnvelope(args: Record<string, unknown>, kind: string): Record<string, unknown> {
  const createdAt = args.created_at_utc === undefined ? new Date().toISOString() : requiredString(args, 'created_at_utc');
  return { schema: 'imerterm.task/1', task_id: taskId(args), project_id: requiredString(args, 'project_id'), target_id: requiredString(args, 'target_id'), task_kind: kind, created_at_utc: createdAt };
}
async function runPowerShell(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { caps } = await operationalHandshake();
  requireAdvertisedValue(caps, 'dispatch_schemas', 'imerterm.powershell_dispatch/1', 'contract.v1.3.southbound_binding.dispatch.schemas', 'IMERTERM_OPERATION_SCHEMA_MISSING', 'Refresh Capabilities. Do not infer PowerShell V2 and do not bypass ImerTerm.');
  const task = taskEnvelope(args, 'POWERSHELL');
  return await dispatchImerTerm({
    schema: 'imerterm.powershell_dispatch/1', task,
    working_directory: requiredString(args, 'working_directory'),
    capability: requiredString(args, 'capability'),
    mutation_class: requiredString(args, 'mutation_class'),
    script: requiredString(args, 'script'),
    timeout_ms: optionalInt(args, 'timeout_ms', 300000),
    graceful_stop_ms: optionalInt(args, 'graceful_stop_ms', 5000),
    max_raw_output_bytes: optionalInt(args, 'max_raw_output_bytes', 1048576),
  }, (optionalInt(args, 'timeout_ms', 300000) ?? 300000) + 15_000);
}

function requireCapabilityValue(caps: Record<string, unknown>, key: string, value: string, message: string): void {
  requireAdvertisedValue(caps, key, value, 'contract.v1.3.capability_gates', 'IMERTERM_OPERATION_CAPABILITY_MISSING', `${message} Refresh Capabilities and stop if it remains absent; never use an implicit fallback or bypass.`);
}
function optionalMode(args: Record<string, unknown>): 'V1_RAW' | 'V2_STRUCTURED' {
  const value = args.dispatch_mode;
  if (value === undefined) return 'V1_RAW';
  if (value !== 'V1_RAW' && value !== 'V2_STRUCTURED') throw requestValidationError('dispatch_mode must be V1_RAW or V2_STRUCTURED.');
  return value;
}
function structuredArguments(args: Record<string, unknown>): Record<string, unknown>[] {
  const value = args.arguments;
  if (!Array.isArray(value)) throw requestValidationError('arguments must be an array for V2_STRUCTURED.');
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw requestValidationError(`arguments[${index}] must be an object.`);
    const item = entry as Record<string, unknown>;
    const kind = requiredString(item, 'kind');
    if (kind === 'LITERAL') {
      if (typeof item.value !== 'string') throw requestValidationError(`arguments[${index}].value is required for LITERAL.`);
      if (item.artifact_id !== undefined) throw requestValidationError(`arguments[${index}].artifact_id is forbidden for LITERAL.`);
      return { kind, value: item.value };
    }
    if (kind === 'ARTIFACT_PATH') {
      const artifactId = requiredString(item, 'artifact_id');
      if (item.value !== undefined) throw requestValidationError(`arguments[${index}].value is forbidden for ARTIFACT_PATH.`);
      return { kind, artifact_id: artifactId };
    }
    throw requestValidationError(`arguments[${index}].kind must be LITERAL or ARTIFACT_PATH.`);
  });
}
function structuredArtifacts(args: Record<string, unknown>): Record<string, unknown>[] {
  const value = args.artifacts;
  if (!Array.isArray(value)) throw requestValidationError('artifacts must be an array for V2_STRUCTURED.');
  if (value.length > 32) throw requestValidationError('artifacts exceeds the ImerTerm maximum of 32.');
  let totalBytes = 0;
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw requestValidationError(`artifacts[${index}] must be an object.`);
    const item = entry as Record<string, unknown>;
    const artifactId = requiredString(item, 'artifact_id');
    if (artifactId.includes('..') || artifactId.includes('/') || artifactId.includes('\\')) throw requestValidationError(`artifacts[${index}].artifact_id contains path syntax.`);
    if (seen.has(artifactId)) throw requestValidationError(`Duplicate artifact_id: ${artifactId}.`);
    seen.add(artifactId);
    const sourceKind = requiredString(item, 'source_kind');
    if (sourceKind !== 'LOCAL_FILE') throw requestValidationError(`artifacts[${index}].source_kind must be LOCAL_FILE.`);
    const sourcePath = requiredString(item, 'source_path');
    const byteLength = item.byte_length;
    if (typeof byteLength !== 'number' || !Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > 536870912) throw requestValidationError(`artifacts[${index}].byte_length must be an integer between 0 and 536870912.`);
    totalBytes += byteLength;
    if (totalBytes > 1073741824) throw requestValidationError('Total artifact bytes exceeds the ImerTerm maximum of 1073741824.');
    const sha256 = requiredString(item, 'sha256');
    if (!/^[0-9a-fA-F]{64}$/.test(sha256)) throw requestValidationError(`artifacts[${index}].sha256 must be 64 hexadecimal characters.`);
    return { artifact_id: artifactId, source_kind: sourceKind, source_path: sourcePath, byte_length: byteLength, sha256: sha256.toLowerCase() };
  });
}

export function buildSshDispatchForCapabilities(args: Record<string, unknown>, caps: Record<string, unknown>): { payload: Record<string, unknown>; timeoutMs?: number } {
  const target = requiredString(args, 'target_id');
  const mode = optionalMode(args);
  const runtime = optionalInt(args, 'runtime_max_seconds');
  requireAdvertisedValue(caps, 'openssh_targets', target, 'manual.discovery_order.fail_closed', 'IMERTERM_TARGET_NOT_ADVERTISED', `Refresh Capabilities and choose an advertised OpenSSH target. Do not bypass ImerTerm to reach ${target}.`);

  if (mode === 'V1_RAW') {
    requireCapabilityValue(caps, 'dispatch_schemas', 'imerterm.bash_dispatch/1', 'Running ImerTerm Host does not accept imerterm.bash_dispatch/1.');
    requireCapabilityValue(caps, 'features', 'bash_dispatch_v1', 'Running ImerTerm Host does not advertise bash_dispatch_v1.');
    for (const key of ['runtime_id', 'entrypoint_artifact_id', 'arguments', 'artifacts']) if (args[key] !== undefined) throw requestValidationError(`${key} requires dispatch_mode=V2_STRUCTURED.`);
    const payload: Record<string, unknown> = {
      schema: 'imerterm.bash_dispatch/1', task: taskEnvelope(args, 'BASH'),
      mutation_class: requiredString(args, 'mutation_class'), run_as: requiredString(args, 'run_as'), script: requiredString(args, 'script'),
    };
    if (runtime !== undefined) payload.runtime_max_seconds = runtime;
    return { payload, timeoutMs: runtime ? runtime * 1000 + 15_000 : undefined };
  }

  if (args.script !== undefined) throw requestValidationError('script is forbidden for dispatch_mode=V2_STRUCTURED.');
  for (const key of ['remote_path', 'executable']) if (args[key] !== undefined) throw requestValidationError(`${key} is forbidden for dispatch_mode=V2_STRUCTURED.`);
  requireCapabilityValue(caps, 'dispatch_schemas', 'imerterm.bash_dispatch/2', 'Running ImerTerm Host does not accept imerterm.bash_dispatch/2.');
  for (const feature of ['artifact_staging_v1', 'structured_dispatch_v2', 'structured_runtime_catalog_v1']) requireCapabilityValue(caps, 'features', feature, `Running ImerTerm Host does not advertise ${feature}.`);
  const artifacts = structuredArtifacts(args);
  const artifactIds = new Set(artifacts.map(item => String(item.artifact_id)));
  const entrypoint = requiredString(args, 'entrypoint_artifact_id');
  if (!artifactIds.has(entrypoint)) throw requestValidationError('entrypoint_artifact_id must reference one of artifacts[].artifact_id.');
  const argumentsList = structuredArguments(args);
  for (const item of argumentsList) if (item.kind === 'ARTIFACT_PATH' && !artifactIds.has(String(item.artifact_id))) throw requestValidationError(`ARTIFACT_PATH references undeclared artifact_id: ${String(item.artifact_id)}.`);
  const payload: Record<string, unknown> = {
    schema: 'imerterm.bash_dispatch/2', task: taskEnvelope(args, 'BASH'),
    mutation_class: requiredString(args, 'mutation_class'), run_as: requiredString(args, 'run_as'),
    runtime_id: requiredString(args, 'runtime_id'), entrypoint_artifact_id: entrypoint,
    arguments: argumentsList, artifacts,
  };
  if (runtime !== undefined) payload.runtime_max_seconds = runtime;
  return { payload, timeoutMs: runtime ? runtime * 1000 + 15_000 : undefined };
}

async function runSsh(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { caps } = await operationalHandshake();
  const built = buildSshDispatchForCapabilities(args, caps);
  return await dispatchImerTerm(built.payload, built.timeoutMs);
}

async function runRouterOs(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const target = requiredString(args, 'target_id');
  const { caps } = await operationalHandshake();
  requireAdvertisedValue(caps, 'dispatch_schemas', 'imerterm.routeros_dispatch/1', 'contract.v1.3.southbound_binding.dispatch.schemas', 'IMERTERM_OPERATION_SCHEMA_MISSING', 'Refresh Capabilities. Do not call RouterOS directly or bypass ImerTerm.');
  requireAdvertisedValue(caps, 'features', 'routeros_dispatch_v1', 'manual.stable_cli.compatibility_rule', 'IMERTERM_OPERATION_FEATURE_MISSING', 'Refresh Capabilities. If routeros_dispatch_v1 remains absent, stop; do not use direct RouterOS CLI.');
  requireAdvertisedValue(caps, 'routeros_targets', target, 'manual.discovery_order.fail_closed', 'IMERTERM_TARGET_NOT_ADVERTISED', `Refresh Capabilities and choose an advertised RouterOS target. Do not bypass ImerTerm to reach ${target}.`);
  return await dispatchImerTerm({
    schema: 'imerterm.routeros_dispatch/1',
    task: taskEnvelope(args, 'ROUTEROS'),
    mutation_class: requiredString(args, 'mutation_class'),
    command: requiredString(args, 'command'),
  });
}

async function taskControl(operation: 'TASK_SHOW' | 'TASK_CANCEL' | 'TASK_JOURNAL', id: string): Promise<Record<string, unknown>> {
  const feature = operation === 'TASK_SHOW' ? 'task_show_v1' : operation === 'TASK_CANCEL' ? 'task_cancel_v1' : 'task_journal_v1';
  const { caps } = await operationalHandshake();
  requireAdvertisedValue(caps, 'dispatch_schemas', 'imerterm.local_control/1', 'contract.v1.3.southbound_binding.control.schema', 'IMERTERM_CONTROL_SCHEMA_MISSING', 'Refresh Capabilities. Do not inspect or mutate SQLite directly as a substitute for ImerTerm control.');
  requireAdvertisedValue(caps, 'features', 'task_control_v1', 'manual.stable_cli.compatibility_rule', 'IMERTERM_CONTROL_FEATURE_MISSING', 'Refresh Capabilities. Do not create a parallel task-control path.');
  requireAdvertisedValue(caps, 'features', feature, 'manual.stable_cli.compatibility_rule', 'IMERTERM_CONTROL_FEATURE_MISSING', `Refresh Capabilities. ${operation} is unavailable until ${feature} is advertised.`);
  return await controlImerTerm({ schema: 'imerterm.local_control/1', operation, task_id: id });
}
async function waitForTask(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = requiredString(args, 'task_id');
  const pollSeconds = optionalInt(args, 'poll_seconds', 2) ?? 2;
  const timeoutSeconds = optionalInt(args, 'wait_timeout_seconds', 60) ?? 60;
  const started = Date.now();
  while (true) {
    const response = await taskControl('TASK_SHOW', id);
    const task = response.task;
    if (task && typeof task === 'object' && !Array.isArray(task) && (task as Record<string, unknown>).terminal === true) return response;
    if (Date.now() - started >= timeoutSeconds * 1000) {
      throw new ImerTermAdapterError('WAIT_TIMEOUT', 'Local wait timed out; the ImerTerm task was not cancelled.');
    }
    await new Promise(resolve => setTimeout(resolve, pollSeconds * 1000));
  }
}

export async function handleImerTermTool(name: string, rawArgs: unknown): Promise<ServerResult> {
  if (!isImerTermEnabled()) return errorResult(new ImerTermAdapterError('DISABLED', 'ImerTerm adapter is not enabled.'));
  try {
    const args = name === 'imerterm_capabilities' ? {} : asObject(rawArgs);
    switch (name) {
      case 'imerterm_capabilities': return responseResult(await diagnosticCapabilitiesResponse());
      case 'imerterm_run_powershell': return responseResult(await runPowerShell(args));
      case 'imerterm_run_ssh': return responseResult(await runSsh(args));
      case 'imerterm_run_routeros': return responseResult(await runRouterOs(args));
      case 'imerterm_task_show': return responseResult(await taskControl('TASK_SHOW', requiredString(args, 'task_id')));
      case 'imerterm_task_wait': return responseResult(await waitForTask(args));
      case 'imerterm_task_cancel': return responseResult(await taskControl('TASK_CANCEL', requiredString(args, 'task_id')));
      case 'imerterm_task_journal': return responseResult(await taskControl('TASK_JOURNAL', requiredString(args, 'task_id')));
      default: return errorResult(new ImerTermAdapterError('UNKNOWN_TOOL', `Unknown ImerTerm tool: ${name}`));
    }
  } catch (error) {
    return errorResult(error);
  }
}
