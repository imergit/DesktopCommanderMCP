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
          run_as: { type: 'string', enum: ['USER', 'ROOT'], default: 'USER' },
          script: { type: 'string' },
          runtime_max_seconds: { type: 'integer', minimum: 1, maximum: 86400 },
        },
        required: ['project_id', 'target_id', 'mutation_class', 'run_as', 'script'],
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
