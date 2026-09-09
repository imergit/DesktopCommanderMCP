import crypto from 'crypto';
import os from 'os';
import { VERSION } from '../version.js';
import type { ServerResult } from '../types.js';

const startedAt = new Date().toISOString();
const sessionId = crypto.randomUUID();
const hostName = os.hostname();
const userName = os.userInfo().username;
const shortHash = (value: string) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 20);
const localDeviceId = `local-${shortHash(`device:${hostName}`)}`;
const localUserId = `local-${shortHash(`user:${hostName}:${userName}`)}`;
const facadeNames = new Set(['list_devices', 'who_am_i', 'ping', 'shutdown']);

export function getLocalDeviceId(): string {
  return localDeviceId;
}

function cloneSchema(schema: any): any {
  return JSON.parse(JSON.stringify(schema ?? { type: 'object', properties: {}, additionalProperties: false }));
}

export function exposeRdcCompatibleTool<T extends { inputSchema?: any }>(tool: T): T {
  const inputSchema = cloneSchema(tool.inputSchema);
  inputSchema.type ??= 'object';
  inputSchema.properties ??= {};
  delete inputSchema.properties.origin;
  inputSchema.properties.deviceId = { type: 'string' };
  if (Array.isArray(inputSchema.required)) inputSchema.required = inputSchema.required.filter((x: string) => x !== 'deviceId');
  inputSchema.additionalProperties = false;
  return { ...tool, inputSchema };
}

export function normalizeRdcCompatibleArgs(name: string, args: unknown): any {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args;
  const normalized = { ...(args as Record<string, unknown>) };
  if ('deviceId' in normalized) {
    const supplied = normalized.deviceId;
    if (typeof supplied !== 'string' || (supplied !== localDeviceId && supplied !== hostName)) {
      throw new Error(`Device not found: ${String(supplied)}`);
    }
    delete normalized.deviceId;
  }
  return normalized;
}

export function isRdcFacadeTool(name: string): boolean {
  return facadeNames.has(name);
}

const emptySchema = { type: 'object', properties: {}, additionalProperties: false };
const deviceSchema = { type: 'object', properties: { deviceId: { type: 'string' } }, additionalProperties: false };

export function getRdcFacadeTools(): any[] {
  return [
    { name: 'list_devices', description: 'List connected devices for the current user', inputSchema: emptySchema, annotations: { title: 'List Devices', readOnlyHint: true } },
    { name: 'who_am_i', description: 'Get details about the currently authenticated user', inputSchema: emptySchema, annotations: { title: 'Who Am I', readOnlyHint: true } },
    { name: 'ping', description: "Ping a device to verify connectivity and latency. Returns a 'pong' with timestamp.", inputSchema: deviceSchema, annotations: { title: 'Ping Device', readOnlyHint: true } },
    { name: 'shutdown', description: 'Gracefully shut down a remote device process. The device will respond with confirmation before exiting.', inputSchema: deviceSchema, annotations: { title: 'Shutdown Device', readOnlyHint: false, destructiveHint: true, openWorldHint: false } },
  ];
}

function jsonResult(value: unknown): ServerResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

export async function handleRdcFacadeTool(name: string): Promise<ServerResult> {
  const now = new Date().toISOString();
  switch (name) {
    case 'list_devices':
      return jsonResult([{
        id: localDeviceId,
        user_id: localUserId,
        device_name: hostName,
        capabilities: { app_version: VERSION, transport_broadcast_v1: false, imermcp_local: true },
        status: 'online',
        last_seen: now,
        auth_token: 'local',
        created_at: startedAt,
        updated_at: now,
        session_id: sessionId,
      }]);
    case 'who_am_i':
      return jsonResult({
        id: localUserId,
        email: null,
        role: 'authenticated',
        supabase_connected: false,
        device_count: 1,
        created_at: startedAt,
        last_sign_in_at: startedAt,
        app_metadata: { provider: 'imermcp-local', providers: ['imermcp-local'] },
        user_metadata: { name: userName, email_verified: false, phone_verified: false },
      });
    case 'ping':
      return { content: [{ type: 'text', text: `pong ${now}` }] };
    case 'shutdown':
      return { content: [{ type: 'text', text: `Shutting down ImerMCP-Local on ${hostName}` }] };
    default:
      return { content: [{ type: 'text', text: `Error: Unknown RDC facade tool: ${name}` }], isError: true };
  }
}

export function scheduleLocalShutdown(closeServer: () => Promise<void>): void {
  const timer = setTimeout(() => {
    let settled = false;
    const hardStop = setTimeout(() => {
      if (!settled) process.exit(0);
    }, 1500);
    void closeServer()
      .catch(error => {
        process.stderr.write(`ImerMCP-Local graceful shutdown failed: ${String(error)}\n`);
      })
      .finally(() => {
        settled = true;
        clearTimeout(hardStop);
        process.exitCode = 0;
      });
  }, 100);
  timer.unref();
}
