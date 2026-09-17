import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { trackToolCall } from '../utils/trackTools.js';
import { toolHistory } from '../utils/toolHistory.js';
import {
  getFileMaterializationTools,
  handleFileMaterializationTool,
  MATERIALIZE_FILE_TOOL,
  sanitizeMaterializationTrackingArgs,
} from './file-materialization-tools.js';

const installed = new WeakSet<object>();

type RequestHandler = (request: unknown, extra: unknown) => Promise<any> | any;

function requestHandlers(server: any): Map<string, RequestHandler> {
  const handlers = server?._requestHandlers;
  if (!(handlers instanceof Map)) {
    throw new Error('MCP request handler registry is unavailable.');
  }
  return handlers as Map<string, RequestHandler>;
}
export function installFileMaterializationBoundary(server: any): void {
  if (installed.has(server)) return;
  const handlers = requestHandlers(server);
  const priorList = handlers.get('tools/list');
  const priorCall = handlers.get('tools/call');
  if (!priorList || !priorCall) {
    throw new Error('MCP tools/list or tools/call handler is unavailable.');
  }

  server.setRequestHandler(ListToolsRequestSchema, async (request: unknown, extra: unknown) => {
    const base = await priorList(request, extra);
    const tools = Array.isArray(base?.tools) ? base.tools : [];
    if (tools.some((tool: any) => tool?.name === MATERIALIZE_FILE_TOOL)) return base;
    return { ...base, tools: [...tools, ...getFileMaterializationTools()] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest, extra: unknown) => {
    if (request.params.name !== MATERIALIZE_FILE_TOOL) {
      return await priorCall(request, extra);
    }
    const started = Date.now();
    const safeArgs = sanitizeMaterializationTrackingArgs(request.params.arguments);
    await trackToolCall(MATERIALIZE_FILE_TOOL, safeArgs);
    const result = await handleFileMaterializationTool(request.params.arguments);
    toolHistory.addCall(MATERIALIZE_FILE_TOOL, safeArgs, result, Date.now() - started);
    return result;
  });

  installed.add(server);
}