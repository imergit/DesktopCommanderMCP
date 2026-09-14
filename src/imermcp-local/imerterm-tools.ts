import { randomUUID } from 'node:crypto';
import type { ServerResult } from '../types.js';
import {
  controlImerTerm,
  dispatchImerTerm,
  getImerTermCapabilities,
  ImerTermAdapterError,
  isImerTermEnabled,
} from './imerterm-client.js';

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
    project_id: { type: 'string' },
    target_id: { type: 'string' },
    mutation_class: mutationClass,
  };
}

export function getImerTermTools(): any[] {
  return [
    { name: 'imerterm_capabilities', description: 'Read the running ImerTerm Host machine-first capabilities handshake. No execution occurs.', inputSchema: emptySchema, annotations: { title: 'ImerTerm Capabilities', readOnlyHint: true } },
    {
      name: 'imerterm_run_powershell',
      description: 'Dispatch governed Windows PowerShell through the existing ImerTerm authority. ImerMCP does not execute or reinterpret the script.',
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
      description: 'Dispatch governed Bash through an ImerTerm-qualified OpenSSH target. SSH lifecycle, attestation and execution remain owned by ImerTerm.',
      inputSchema: {
        type: 'object',
        properties: {
          ...baseTaskProperties(),
          dispatch_mode: { type: 'string', enum: ['V1_RAW', 'V2_STRUCTURED'], default: 'V1_RAW', description: 'Explicit southbound mode. V2 never auto-falls back to V1.' },
          run_as: { type: 'string', enum: ['USER', 'ROOT'], default: 'USER' },
          script: { type: 'string', description: 'V1_RAW only. Forbidden in V2_STRUCTURED.' },
          runtime_id: { type: 'string', description: 'V2_STRUCTURED logical runtime identifier resolved by ImerTerm.' },
          entrypoint_artifact_id: { type: 'string', description: 'V2_STRUCTURED artifact_id used as the structured entrypoint.' },
          arguments: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['LITERAL', 'ARTIFACT_PATH'] },
                value: { type: 'string' },
                artifact_id: { type: 'string' },
              },
              required: ['kind'],
              additionalProperties: false,
            },
          },
          artifacts: {
            type: 'array',
            maxItems: 32,
            items: {
              type: 'object',
              properties: {
                artifact_id: { type: 'string' },
                source_kind: { type: 'string', enum: ['LOCAL_FILE'] },
                source_path: { type: 'string' },
                byte_length: { type: 'integer', minimum: 0, maximum: 536870912 },
                sha256: { type: 'string', pattern: '^[0-9a-fA-F]{64}
      },
      annotations: { title: 'ImerTerm SSH/Bash', readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    {
      name: 'imerterm_run_routeros',
      description: 'Dispatch a RouterOS command through the existing governed ImerTerm RouterOS authority.',
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
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object.');
  return args as Record<string, unknown>;
}
function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${key} is required.`);
  return value;
}
function optionalInt(args: Record<string, unknown>, key: string, fallback?: number): number | undefined {
  const value = args[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`${key} must be an integer.`);
  return value;
}
function taskId(args: Record<string, unknown>): string {
  const value = args.task_id;
  if (value === undefined) return randomUUID();
  if (typeof value !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(value)) throw new Error('task_id must be a UUID string.');
  return value;
}
function responseResult(value: Record<string, unknown>): ServerResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value };
}
function errorResult(error: unknown): ServerResult {
  const code = error instanceof ImerTermAdapterError ? error.code : 'ADAPTER_ERROR';
  const message = error instanceof Error ? error.message : String(error);
  const body: Record<string, unknown> = { schema: 'imermcp.imerterm_error/1', error_class: code, message };
  if (error instanceof ImerTermAdapterError) {
    if (error.exitCode !== undefined) body.exit_code = error.exitCode;
    if (error.nativeResponse !== undefined) body.native_response = error.nativeResponse;
  }
  return { content: [{ type: 'text', text: JSON.stringify(body, null, 2) }], structuredContent: body, isError: true };
}
function capabilitiesObject(response: Record<string, unknown>): Record<string, unknown> {
  if (response.status !== 'CONTROL_OK' || response.result_code !== 'CAPABILITIES') throw new Error('ImerTerm capabilities handshake failed.');
  const capabilities = response.capabilities;
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) throw new Error('ImerTerm capabilities object is missing.');
  const caps = capabilities as Record<string, unknown>;
  if (caps.protocol_epoch !== 1) throw new Error('ImerTerm protocol epoch is incompatible.');
  return caps;
}
function arrayHas(caps: Record<string, unknown>, key: string, value: string): boolean {
  const list = caps[key];
  return Array.isArray(list) && list.includes(value);
}
async function requireCapabilities(schema?: string, feature?: string, targetKey?: string, targetId?: string): Promise<Record<string, unknown>> {
  const caps = capabilitiesObject(await getImerTermCapabilities());
  if (schema && !arrayHas(caps, 'dispatch_schemas', schema)) throw new Error(`Running ImerTerm Host does not accept ${schema}.`);
  if (feature && !arrayHas(caps, 'features', feature)) throw new Error(`Running ImerTerm Host does not advertise ${feature}.`);
  if (targetKey && targetId && !arrayHas(caps, targetKey, targetId)) throw new Error(`Running ImerTerm Host does not expose target ${targetId} in ${targetKey}.`);
  return caps;
}
function taskEnvelope(args: Record<string, unknown>, kind: string): Record<string, unknown> {
  return { schema: 'imerterm.task/1', task_id: taskId(args), project_id: requiredString(args, 'project_id'), target_id: requiredString(args, 'target_id'), task_kind: kind, created_at_utc: new Date().toISOString() };
}
async function runPowerShell(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  await requireCapabilities('imerterm.powershell_dispatch/1');
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
  if (!arrayHas(caps, key, value)) throw new Error(message);
}
function optionalMode(args: Record<string, unknown>): 'V1_RAW' | 'V2_STRUCTURED' {
  const value = args.dispatch_mode;
  if (value === undefined) return 'V1_RAW';
  if (value !== 'V1_RAW' && value !== 'V2_STRUCTURED') throw new Error('dispatch_mode must be V1_RAW or V2_STRUCTURED.');
  return value;
}
function structuredArguments(args: Record<string, unknown>): Record<string, unknown>[] {
  const value = args.arguments;
  if (!Array.isArray(value)) throw new Error('arguments must be an array for V2_STRUCTURED.');
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`arguments[${index}] must be an object.`);
    const item = entry as Record<string, unknown>;
    const kind = requiredString(item, 'kind');
    if (kind === 'LITERAL') {
      if (typeof item.value !== 'string') throw new Error(`arguments[${index}].value is required for LITERAL.`);
      if (item.artifact_id !== undefined) throw new Error(`arguments[${index}].artifact_id is forbidden for LITERAL.`);
      return { kind, value: item.value };
    }
    if (kind === 'ARTIFACT_PATH') {
      const artifactId = requiredString(item, 'artifact_id');
      if (item.value !== undefined) throw new Error(`arguments[${index}].value is forbidden for ARTIFACT_PATH.`);
      return { kind, artifact_id: artifactId };
    }
    throw new Error(`arguments[${index}].kind must be LITERAL or ARTIFACT_PATH.`);
  });
}
function structuredArtifacts(args: Record<string, unknown>): Record<string, unknown>[] {
  const value = args.artifacts;
  if (!Array.isArray(value)) throw new Error('artifacts must be an array for V2_STRUCTURED.');
  if (value.length > 32) throw new Error('artifacts exceeds the ImerTerm maximum of 32.');
  let totalBytes = 0;
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`artifacts[${index}] must be an object.`);
    const item = entry as Record<string, unknown>;
    const artifactId = requiredString(item, 'artifact_id');
    if (artifactId.includes('..') || artifactId.includes('/') || artifactId.includes('\\')) throw new Error(`artifacts[${index}].artifact_id contains path syntax.`);
    if (seen.has(artifactId)) throw new Error(`Duplicate artifact_id: ${artifactId}.`);
    seen.add(artifactId);
    const sourceKind = requiredString(item, 'source_kind');
    if (sourceKind !== 'LOCAL_FILE') throw new Error(`artifacts[${index}].source_kind must be LOCAL_FILE.`);
    const sourcePath = requiredString(item, 'source_path');
    const byteLength = item.byte_length;
    if (typeof byteLength !== 'number' || !Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > 536870912) {
      throw new Error(`artifacts[${index}].byte_length must be an integer between 0 and 536870912.`);
    }
    totalBytes += byteLength;
    if (totalBytes > 1073741824) throw new Error('Total artifact bytes exceeds the ImerTerm maximum of 1073741824.');
    const sha256 = requiredString(item, 'sha256');
    if (!/^[0-9a-fA-F]{64}$/.test(sha256)) throw new Error(`artifacts[${index}].sha256 must be 64 hexadecimal characters.`);
    return { artifact_id: artifactId, source_kind: sourceKind, source_path: sourcePath, byte_length: byteLength, sha256: sha256.toLowerCase() };
  });
}

export function buildSshDispatchForCapabilities(
  args: Record<string, unknown>,
  caps: Record<string, unknown>,
): { payload: Record<string, unknown>; timeoutMs?: number } {
  const target = requiredString(args, 'target_id');
  const mode = optionalMode(args);
  const runtime = optionalInt(args, 'runtime_max_seconds');
  requireCapabilityValue(caps, 'openssh_targets', target, `Running ImerTerm Host does not expose target ${target} in openssh_targets.`);

  if (mode === 'V1_RAW') {
    requireCapabilityValue(caps, 'dispatch_schemas', 'imerterm.bash_dispatch/1', 'Running ImerTerm Host does not accept imerterm.bash_dispatch/1.');
    requireCapabilityValue(caps, 'features', 'bash_dispatch_v1', 'Running ImerTerm Host does not advertise bash_dispatch_v1.');
    for (const key of ['runtime_id', 'entrypoint_artifact_id', 'arguments', 'artifacts']) {
      if (args[key] !== undefined) throw new Error(`${key} requires dispatch_mode=V2_STRUCTURED.`);
    }
    const payload: Record<string, unknown> = {
      schema: 'imerterm.bash_dispatch/1',
      task: taskEnvelope(args, 'BASH'),
      mutation_class: requiredString(args, 'mutation_class'),
      run_as: requiredString(args, 'run_as'),
      script: requiredString(args, 'script'),
    };
    if (runtime !== undefined) payload.runtime_max_seconds = runtime;
    return { payload, timeoutMs: runtime ? runtime * 1000 + 15_000 : undefined };
  }

  if (args.script !== undefined) throw new Error('script is forbidden for dispatch_mode=V2_STRUCTURED.');
  requireCapabilityValue(caps, 'dispatch_schemas', 'imerterm.bash_dispatch/2', 'Running ImerTerm Host does not accept imerterm.bash_dispatch/2.');
  for (const feature of ['artifact_staging_v1', 'structured_dispatch_v2', 'structured_runtime_catalog_v1']) {
    requireCapabilityValue(caps, 'features', feature, `Running ImerTerm Host does not advertise ${feature}.`);
  }
  const artifacts = structuredArtifacts(args);
  const artifactIds = new Set(artifacts.map(item => String(item.artifact_id)));
  const entrypoint = requiredString(args, 'entrypoint_artifact_id');
  if (!artifactIds.has(entrypoint)) throw new Error('entrypoint_artifact_id must reference one of artifacts[].artifact_id.');
  const argumentsList = structuredArguments(args);
  for (const item of argumentsList) {
    if (item.kind === 'ARTIFACT_PATH' && !artifactIds.has(String(item.artifact_id))) {
      throw new Error(`ARTIFACT_PATH references undeclared artifact_id: ${String(item.artifact_id)}.`);
    }
  }
  const payload: Record<string, unknown> = {
    schema: 'imerterm.bash_dispatch/2',
    task: taskEnvelope(args, 'BASH'),
    mutation_class: requiredString(args, 'mutation_class'),
    run_as: requiredString(args, 'run_as'),
    runtime_id: requiredString(args, 'runtime_id'),
    entrypoint_artifact_id: entrypoint,
    arguments: argumentsList,
    artifacts,
  };
  if (runtime !== undefined) payload.runtime_max_seconds = runtime;
  return { payload, timeoutMs: runtime ? runtime * 1000 + 15_000 : undefined };
}

async function runSsh(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const caps = capabilitiesObject(await getImerTermCapabilities());
  const built = buildSshDispatchForCapabilities(args, caps);
  return await dispatchImerTerm(built.payload, built.timeoutMs);
}

async function runRouterOs(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const target = requiredString(args, 'target_id');
  await requireCapabilities('imerterm.routeros_dispatch/1', 'routeros_dispatch_v1', 'routeros_targets', target);
  return await dispatchImerTerm({
    schema: 'imerterm.routeros_dispatch/1',
    task: taskEnvelope(args, 'ROUTEROS'),
    mutation_class: requiredString(args, 'mutation_class'),
    command: requiredString(args, 'command'),
  });
}

async function taskControl(operation: 'TASK_SHOW' | 'TASK_CANCEL' | 'TASK_JOURNAL', id: string): Promise<Record<string, unknown>> {
  const feature = operation === 'TASK_SHOW' ? 'task_show_v1' : operation === 'TASK_CANCEL' ? 'task_cancel_v1' : 'task_journal_v1';
  await requireCapabilities(undefined, 'task_control_v1');
  await requireCapabilities(undefined, feature);
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
      case 'imerterm_capabilities': return responseResult(await getImerTermCapabilities());
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
 },
              },
              required: ['artifact_id', 'source_kind', 'source_path', 'byte_length', 'sha256'],
              additionalProperties: false,
            },
          },
          runtime_max_seconds: { type: 'integer', minimum: 1, maximum: 86400 },
        },
        required: ['project_id', 'target_id', 'mutation_class', 'run_as'],
        additionalProperties: false,
      },
      annotations: { title: 'ImerTerm SSH/Bash', readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    {
      name: 'imerterm_run_routeros',
      description: 'Dispatch a RouterOS command through the existing governed ImerTerm RouterOS authority.',
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
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object.');
  return args as Record<string, unknown>;
}
function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${key} is required.`);
  return value;
}
function optionalInt(args: Record<string, unknown>, key: string, fallback?: number): number | undefined {
  const value = args[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`${key} must be an integer.`);
  return value;
}
function taskId(args: Record<string, unknown>): string {
  const value = args.task_id;
  if (value === undefined) return randomUUID();
  if (typeof value !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(value)) throw new Error('task_id must be a UUID string.');
  return value;
}
function responseResult(value: Record<string, unknown>): ServerResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value };
}
function errorResult(error: unknown): ServerResult {
  const code = error instanceof ImerTermAdapterError ? error.code : 'ADAPTER_ERROR';
  const message = error instanceof Error ? error.message : String(error);
  const body: Record<string, unknown> = { schema: 'imermcp.imerterm_error/1', error_class: code, message };
  if (error instanceof ImerTermAdapterError) {
    if (error.exitCode !== undefined) body.exit_code = error.exitCode;
    if (error.nativeResponse !== undefined) body.native_response = error.nativeResponse;
  }
  return { content: [{ type: 'text', text: JSON.stringify(body, null, 2) }], structuredContent: body, isError: true };
}
function capabilitiesObject(response: Record<string, unknown>): Record<string, unknown> {
  if (response.status !== 'CONTROL_OK' || response.result_code !== 'CAPABILITIES') throw new Error('ImerTerm capabilities handshake failed.');
  const capabilities = response.capabilities;
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) throw new Error('ImerTerm capabilities object is missing.');
  const caps = capabilities as Record<string, unknown>;
  if (caps.protocol_epoch !== 1) throw new Error('ImerTerm protocol epoch is incompatible.');
  return caps;
}
function arrayHas(caps: Record<string, unknown>, key: string, value: string): boolean {
  const list = caps[key];
  return Array.isArray(list) && list.includes(value);
}
async function requireCapabilities(schema?: string, feature?: string, targetKey?: string, targetId?: string): Promise<Record<string, unknown>> {
  const caps = capabilitiesObject(await getImerTermCapabilities());
  if (schema && !arrayHas(caps, 'dispatch_schemas', schema)) throw new Error(`Running ImerTerm Host does not accept ${schema}.`);
  if (feature && !arrayHas(caps, 'features', feature)) throw new Error(`Running ImerTerm Host does not advertise ${feature}.`);
  if (targetKey && targetId && !arrayHas(caps, targetKey, targetId)) throw new Error(`Running ImerTerm Host does not expose target ${targetId} in ${targetKey}.`);
  return caps;
}
function taskEnvelope(args: Record<string, unknown>, kind: string): Record<string, unknown> {
  return { schema: 'imerterm.task/1', task_id: taskId(args), project_id: requiredString(args, 'project_id'), target_id: requiredString(args, 'target_id'), task_kind: kind, created_at_utc: new Date().toISOString() };
}
async function runPowerShell(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  await requireCapabilities('imerterm.powershell_dispatch/1');
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

async function runSsh(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const target = requiredString(args, 'target_id');
  await requireCapabilities('imerterm.bash_dispatch/1', 'bash_dispatch_v1', 'openssh_targets', target);
  const payload: Record<string, unknown> = {
    schema: 'imerterm.bash_dispatch/1', task: taskEnvelope(args, 'BASH'),
    mutation_class: requiredString(args, 'mutation_class'), run_as: requiredString(args, 'run_as'), script: requiredString(args, 'script'),
  };
  const runtime = optionalInt(args, 'runtime_max_seconds');
  if (runtime !== undefined) payload.runtime_max_seconds = runtime;
  return await dispatchImerTerm(payload, runtime ? runtime * 1000 + 15_000 : undefined);
}

async function runRouterOs(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const target = requiredString(args, 'target_id');
  await requireCapabilities('imerterm.routeros_dispatch/1', 'routeros_dispatch_v1', 'routeros_targets', target);
  return await dispatchImerTerm({
    schema: 'imerterm.routeros_dispatch/1',
    task: taskEnvelope(args, 'ROUTEROS'),
    mutation_class: requiredString(args, 'mutation_class'),
    command: requiredString(args, 'command'),
  });
}

async function taskControl(operation: 'TASK_SHOW' | 'TASK_CANCEL' | 'TASK_JOURNAL', id: string): Promise<Record<string, unknown>> {
  const feature = operation === 'TASK_SHOW' ? 'task_show_v1' : operation === 'TASK_CANCEL' ? 'task_cancel_v1' : 'task_journal_v1';
  await requireCapabilities(undefined, 'task_control_v1');
  await requireCapabilities(undefined, feature);
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
      case 'imerterm_capabilities': return responseResult(await getImerTermCapabilities());
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
