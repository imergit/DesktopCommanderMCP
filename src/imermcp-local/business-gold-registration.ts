import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { trackToolCall } from '../utils/trackTools.js';
import { toolHistory } from '../utils/toolHistory.js';
import {
  BUSINESS_CAPABILITIES_TOOL,
  BUSINESS_COMPOSE_TOOL,
  getBusinessGoldTools,
  handleBusinessGoldTool,
} from './business-gold-tools.js';

const installed = new WeakSet<object>();
const names = new Set([BUSINESS_CAPABILITIES_TOOL, BUSINESS_COMPOSE_TOOL]);
type RequestHandler = (request: unknown, extra: unknown) => Promise<any> | any;

function requestHandlers(server: any): Map<string, RequestHandler> {
  const handlers = server?._requestHandlers;
  if (!(handlers instanceof Map)) throw new Error('MCP request handler registry is unavailable.');
  return handlers as Map<string, RequestHandler>;
}

function safeTrackingArgs(rawArgs: unknown): Record<string, unknown> {
  if (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) return {};
  const args = rawArgs as Record<string, unknown>;
  return {
    family: args.family,
    operation: args.operation,
    raw_escape_justification_present: typeof args.justification === 'string' && args.justification.trim().length > 0,
  };
}

export function installBusinessGoldBoundary(server: any): void {
  if (installed.has(server)) return;
  const handlers = requestHandlers(server);
  const priorList = handlers.get('tools/list');
  const priorCall = handlers.get('tools/call');
  if (!priorList || !priorCall) throw new Error('MCP tools/list or tools/call handler is unavailable.');

  server.setRequestHandler(ListToolsRequestSchema, async (request: unknown, extra: unknown) => {
    const base = await priorList(request, extra);
    const tools = Array.isArray(base?.tools) ? base.tools : [];
    const existing = new Set(tools.map((tool: any) => tool?.name));
    const additions = getBusinessGoldTools().filter(tool => !existing.has(tool.name));
    return additions.length === 0 ? base : { ...base, tools: [...tools, ...additions] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest, extra: unknown) => {
    if (!names.has(request.params.name)) return await priorCall(request, extra);
    const started = Date.now();
    const safeArgs = safeTrackingArgs(request.params.arguments);
    await trackToolCall(request.params.name, safeArgs);
    const result = await handleBusinessGoldTool(request.params.name, request.params.arguments);
    toolHistory.addCall(request.params.name, safeArgs, result, Date.now() - started);
    return result;
  });

  installed.add(server);
}
