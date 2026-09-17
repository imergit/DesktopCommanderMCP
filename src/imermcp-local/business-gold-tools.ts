import type { ServerResult } from '../types.js';
import { handleImerTermTool } from './imerterm-tools.js';

export const BUSINESS_CAPABILITIES_TOOL = 'imermcp_business_capabilities';
export const BUSINESS_COMPOSE_TOOL = 'imermcp_business_compose';

export const BUSINESS_GOLD_FAMILIES = [
  'capabilities_discovery',
  'artifact_operations',
  'project_git_operations',
  'compute_offload_operations',
  'service_operations',
  'truth_imerspine_operations',
  'task_lifecycle',
  'raw_terminal_escape_hatch',
] as const;

type Family = typeof BUSINESS_GOLD_FAMILIES[number];

type Route = {
  provider: string;
  executor_tool: string | null;
  effect_authority: string;
  mode: string;
  required_constraints: string[];
};

const OPERATIONS: Record<Family, Record<string, Route>> = {
  capabilities_discovery: {
    DISCOVER: {
      provider: 'IMERMCP', executor_tool: BUSINESS_CAPABILITIES_TOOL, effect_authority: 'NONE', mode: 'READ_ONLY',
      required_constraints: ['CAPABILITIES_FIRST', 'LIVE_STATE_MAY_ONLY_REDUCE_STATIC_ELIGIBILITY'],
    },
  },
  artifact_operations: {
    MATERIALIZE_FILE: {
      provider: 'IMERMCP', executor_tool: 'imermcp_materialize_file', effect_authority: 'IMERMCP_HOST_LOCAL_MATERIALIZATION_ONLY', mode: 'BOUNDED_VERIFIED_MATERIALIZATION',
      required_constraints: ['RECOMPUTE_SIZE_AND_SHA256', 'ATOMIC_PUBLISH', 'NO_EXECUTION_AUTHORITY'],
    },
    STAGE_AND_EXECUTE_BASH: {
      provider: 'IMERMCP_TO_IMERTERM', executor_tool: 'imerterm_run_ssh', effect_authority: 'IMERTERM', mode: 'V2_STRUCTURED',
      required_constraints: ['artifact_staging_v1', 'structured_dispatch_v2', 'structured_runtime_catalog_v1', 'NO_V2_TO_V1_FALLBACK'],
    },
  },
  project_git_operations: {
    GIT_STATUS: {
      provider: 'GITHUB_OR_GOVERNED_LOCAL_WORKTREE', executor_tool: null, effect_authority: 'NATIVE_PROVIDER', mode: 'PROVIDER_NATIVE',
      required_constraints: ['PREFER_GITHUB_CONNECTOR_WHEN_OPERATION_IS_NATIVELY_SUPPORTED', 'LOCAL_WORKTREE_ONLY_WHEN_LOCAL_STATE_IS_REQUIRED'],
    },
    GIT_COMMIT_GOVERNED: {
      provider: 'GITHUB_CONNECTOR', executor_tool: null, effect_authority: 'GITHUB_CONNECTOR', mode: 'PROVIDER_NATIVE',
      required_constraints: ['NO_PARALLEL_GIT_AUTHORITY', 'EXACT_BRANCH_AND_BASE_REQUIRED'],
    },
    GIT_PUSH_GOVERNED: {
      provider: 'GITHUB_CONNECTOR', executor_tool: null, effect_authority: 'GITHUB_CONNECTOR', mode: 'PROVIDER_NATIVE',
      required_constraints: ['NO_PARALLEL_GIT_AUTHORITY', 'READ_BACK_AFTER_PUBLICATION'],
    },
    DEPLOY_PROJECT: {
      provider: 'IMERMCP_TO_IMERTERM', executor_tool: 'imerterm_run_powershell', effect_authority: 'IMERTERM', mode: 'GOVERNED_PROJECT_MUTATION',
      required_constraints: ['DOCTOR_PASS', 'RECONCILE_CHECK_ZERO_DELTA', 'EXPLICIT_DEPLOY_POLICY'],
    },
  },
  compute_offload_operations: {
    GB10_OFFLOAD: {
      provider: 'IMERMCP_TO_IMERTERM', executor_tool: 'imerterm_run_ssh', effect_authority: 'IMERTERM', mode: 'V2_STRUCTURED',
      required_constraints: ['target_id=gb10', 'artifact_staging_v1', 'structured_dispatch_v2', 'structured_runtime_catalog_v1', 'NO_V2_TO_V1_FALLBACK'],
    },
  },
  service_operations: {
    SERVICE_STATUS: {
      provider: 'IMERMCP_TO_IMERTERM', executor_tool: 'imerterm_run_powershell', effect_authority: 'IMERTERM', mode: 'GOVERNED_READ',
      required_constraints: ['CAPABILITIES_FIRST', 'SERVICE_ALLOWLIST_REQUIRED'],
    },
    RESTART_GOVERNED_SERVICE: {
      provider: 'IMERMCP_TO_IMERTERM', executor_tool: 'imerterm_run_powershell', effect_authority: 'IMERTERM', mode: 'GOVERNED_PRIVILEGED_MUTATION',
      required_constraints: ['CAPABILITIES_FIRST', 'SERVICE_ALLOWLIST_REQUIRED', 'EXPLICIT_DISRUPTIVE_GATE_WHEN_PRODUCTION'],
    },
  },
  truth_imerspine_operations: {
    GET_CURRENT_TRUTH: {
      provider: 'GITHUB_AND_IMERSPINE', executor_tool: null, effect_authority: 'PROJECT_GIT_IMERSPINE', mode: 'READ_ONLY',
      required_constraints: ['CURRENT_GIT_IS_AUTHORITY', 'DERIVED_VIEWS_ARE_NOT_EDITED_DIRECTLY'],
    },
    RUN_DOCTOR: {
      provider: 'IMERSPINE_CORE', executor_tool: null, effect_authority: 'PROJECT_GIT_IMERSPINE', mode: 'READ_ONLY_VALIDATION',
      required_constraints: ['PINNED_CORE_REQUIRED', 'MACHINE_FIRST_RESULT_REQUIRED'],
    },
    UPDATE_IMERSPINE: {
      provider: 'IMERSPINE_CORE', executor_tool: null, effect_authority: 'PROJECT_GIT_IMERSPINE', mode: 'GOVERNED_RECONCILE',
      required_constraints: ['CANONICAL_INPUTS_ONLY', 'RECONCILE_THEN_RECONCILE_CHECK', 'DOCTOR_PASS', 'GIT_PUBLICATION_READBACK'],
    },
  },
  task_lifecycle: {
    SHOW: {
      provider: 'IMERMCP_TO_IMERTERM', executor_tool: 'imerterm_task_show', effect_authority: 'IMERTERM', mode: 'READ_ONLY',
      required_constraints: ['SAME_TASK_ID'],
    },
    LIST: {
      provider: 'IMERMCP_TO_IMERTERM', executor_tool: 'imerterm_task_list', effect_authority: 'IMERTERM', mode: 'BOUNDED_READ_ONLY',
      required_constraints: ['PROJECT_SCOPED', 'BOUNDED_LIMIT'],
    },
    WAIT: {
      provider: 'IMERMCP_TO_IMERTERM', executor_tool: 'imerterm_task_wait', effect_authority: 'IMERTERM', mode: 'BOUNDED_READ_ONLY_POLL',
      required_constraints: ['WAIT_TIMEOUT_NEVER_CANCELS', 'SAME_TASK_ID'],
    },
    CANCEL: {
      provider: 'IMERMCP_TO_IMERTERM', executor_tool: 'imerterm_task_cancel', effect_authority: 'IMERTERM', mode: 'GOVERNED_CONTROL',
      required_constraints: ['SAME_TASK_ID', 'NO_REPLAY'],
    },
    JOURNAL: {
      provider: 'IMERMCP_TO_IMERTERM', executor_tool: 'imerterm_task_journal', effect_authority: 'IMERTERM', mode: 'BOUNDED_READ_ONLY',
      required_constraints: ['SAME_TASK_ID', 'NO_RAW_PAYLOAD_OR_SECRET_EXPOSURE'],
    },
  },
  raw_terminal_escape_hatch: {
    POWERSHELL_V1: {
      provider: 'IMERMCP_TO_IMERTERM', executor_tool: 'imerterm_run_powershell', effect_authority: 'IMERTERM', mode: 'EXPLICIT_RAW_ESCAPE',
      required_constraints: ['EXPLICIT_JUSTIFICATION_REQUIRED', 'NO_PARALLEL_EXECUTION_AUTHORITY'],
    },
    SSH_V1: {
      provider: 'IMERMCP_TO_IMERTERM', executor_tool: 'imerterm_run_ssh', effect_authority: 'IMERTERM', mode: 'V1_RAW_EXPLICIT_ESCAPE',
      required_constraints: ['EXPLICIT_JUSTIFICATION_REQUIRED', 'NO_AUTOMATIC_FALLBACK_FROM_V2'],
    },
    ROUTEROS_V1: {
      provider: 'IMERMCP_TO_IMERTERM', executor_tool: 'imerterm_run_routeros', effect_authority: 'IMERTERM', mode: 'EXPLICIT_RAW_ESCAPE',
      required_constraints: ['EXPLICIT_JUSTIFICATION_REQUIRED', 'UNKNOWN_OUTCOME_NO_REPLAY'],
    },
  },
};

const emptySchema = { type: 'object', properties: {}, additionalProperties: false };
const familyEnum = [...BUSINESS_GOLD_FAMILIES];
const operationEnum = [...new Set(Object.values(OPERATIONS).flatMap(family => Object.keys(family)))];

export function getBusinessGoldTools(): any[] {
  return [
    {
      name: BUSINESS_CAPABILITIES_TOOL,
      description: 'Discover the compact Business GOLD semantic capability families, provider routing and live ImerTerm eligibility. No effect occurs.',
      inputSchema: emptySchema,
      annotations: { title: 'ImerMCP Business Capabilities', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    {
      name: BUSINESS_COMPOSE_TOOL,
      description: 'Compose one typed Business GOLD intent into the canonical provider/tool route. This tool plans only; it never becomes execution, Git, task, completion or recovery authority.',
      inputSchema: {
        type: 'object',
        properties: {
          family: { type: 'string', enum: familyEnum },
          operation: { type: 'string', enum: operationEnum },
          justification: { type: 'string', minLength: 1, maxLength: 512, description: 'Required only for raw_terminal_escape_hatch.' },
        },
        required: ['family', 'operation'],
        additionalProperties: false,
      },
      annotations: { title: 'ImerMCP Business Compose', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
  ];
}

function result(body: Record<string, unknown>, isError = false): ServerResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
    structuredContent: body,
    ...(isError ? { isError: true } : {}),
  };
}

function staticSurface(): Record<string, unknown> {
  return {
    schema: 'imermcp.business_gold_capabilities/1',
    version: '1.0.0',
    status: 'VNEXT_C4_SHADOW',
    authority: {
      imermcp: 'NORTHBOUND_INTENT_DISCOVERY_COMPOSITION_AND_HOST_LOCAL_MATERIALIZATION',
      imerterm: 'SOLE_EFFECT_TASK_COMPLETION_CANCELLATION_RECOVERY_AUTHORITY',
      github: 'NATIVE_GIT_GITHUB_PROVIDER_WHEN_SUPPORTED',
      imerspine: 'PROJECT_TRUTH_GOVERNANCE_COMPILER',
    },
    policy: {
      default_rule: 'CAPABILITIES_FIRST_SEMANTIC_FIRST',
      no_automatic_v2_to_v1_fallback: true,
      unknown_outcome_automatic_replay: false,
      second_execution_authority_allowed: false,
      complexity_must_pay_rent: true,
    },
    southbound_effect_contract: { id: 'IMERMCP-IMERTERM-INTEROP', version: '1.3.0', protocol_epoch: 1 },
    vnext_composition: { c1: 'IMERTERM_VNEXT_CYCLE1', c2: 'IMERMCP_VNEXT_ASYNC_LIFECYCLE', c3: 'IMERMCP_VNEXT_FILE_MATERIALIZATION', c4: 'IMERMCP_BUSINESS_GOLD_VNEXT' },
    families: Object.fromEntries(BUSINESS_GOLD_FAMILIES.map(family => [family, Object.keys(OPERATIONS[family])])),
  };
}

export async function handleBusinessGoldTool(name: string, rawArgs: unknown): Promise<ServerResult> {
  if (name === BUSINESS_CAPABILITIES_TOOL) {
    const live = await handleImerTermTool('imerterm_capabilities', {});
    return result({ ...staticSurface(), live_imerterm: live.structuredContent ?? null, live_imerterm_error: live.isError === true });
  }
  if (name !== BUSINESS_COMPOSE_TOOL) {
    return result({ schema: 'imermcp.business_gold_error/1', error_class: 'UNKNOWN_TOOL', message: `Unknown Business GOLD tool: ${name}` }, true);
  }
  if (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) {
    return result({ schema: 'imermcp.business_gold_error/1', error_class: 'INVALID_REQUEST', message: 'Tool arguments must be an object.' }, true);
  }
  const args = rawArgs as Record<string, unknown>;
  const family = args.family;
  const operation = args.operation;
  if (typeof family !== 'string' || !BUSINESS_GOLD_FAMILIES.includes(family as Family)) {
    return result({ schema: 'imermcp.business_gold_error/1', error_class: 'UNKNOWN_FAMILY', message: 'Unknown Business GOLD capability family.' }, true);
  }
  if (typeof operation !== 'string' || !OPERATIONS[family as Family][operation]) {
    return result({ schema: 'imermcp.business_gold_error/1', error_class: 'OPERATION_NOT_IN_FAMILY', message: `Operation ${String(operation)} is not valid for ${family}.`, allowed_operations: Object.keys(OPERATIONS[family as Family]) }, true);
  }
  if (family === 'raw_terminal_escape_hatch' && (typeof args.justification !== 'string' || args.justification.trim().length === 0)) {
    return result({ schema: 'imermcp.business_gold_error/1', error_class: 'RAW_ESCAPE_JUSTIFICATION_REQUIRED', message: 'Raw terminal is an explicit escape hatch and requires a non-empty justification.' }, true);
  }
  const route = OPERATIONS[family as Family][operation];
  const live = route.provider.includes('IMERTERM') ? await handleImerTermTool('imerterm_capabilities', {}) : null;
  return result({
    schema: 'imermcp.business_gold_plan/1',
    status: 'COMPOSED_NO_EFFECT',
    family,
    operation,
    route,
    justification_recorded: family === 'raw_terminal_escape_hatch',
    live_imerterm: live?.structuredContent ?? null,
    live_imerterm_error: live?.isError === true,
    next_action: route.executor_tool
      ? `Invoke ${route.executor_tool} only with the already-validated intent and required constraints.`
      : `Use provider ${route.provider} directly; this planner does not impersonate that provider.`,
    prohibited_actions: ['Do not treat this plan as effect completion.', 'Do not bypass the named authority.', 'Do not replay UNKNOWN_OUTCOME.', 'Do not auto-fallback from Structured V2 to raw V1.'],
  });
}
