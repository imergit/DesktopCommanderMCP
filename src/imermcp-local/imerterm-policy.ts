import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export type PolicyRuleStatus = 'SATISFIED' | 'BLOCKED' | 'REQUIRES_CONTEXT';
export type PolicyEnforcement = 'BOUND_BYTES' | 'RUNTIME_CAPABILITY' | 'ADAPTER_CODE' | 'IMERTERM_AUTHORITY' | 'CALLER_PREFLIGHT';

export interface SafeNextAction {
  action: string;
  instruction: string;
}

export interface PolicyAuthorityRef {
  kind: 'IMERTERM_OPERATIONS_MANUAL' | 'IMERMCP_INTEROP_CONTRACT';
  version: '1.4.0' | '1.3.0';
  sha256: string;
}

export interface PolicyRejection {
  reason_code: string;
  rule_ref: string;
  rule_authority: PolicyAuthorityRef;
  message: string;
  observed?: unknown;
  required?: unknown;
  retryable: boolean;
  safe_next_action: SafeNextAction;
}

export interface OperationalPolicyRule {
  id: string;
  category: string;
  rule_ref: string;
  summary: string;
  applies_to: string[];
  enforcement: PolicyEnforcement;
  status: PolicyRuleStatus;
  blocking: boolean;
  guidance: string;
}

export interface BindingObservation {
  kind: 'IMERTERM_OPERATIONS_MANUAL' | 'IMERMCP_INTEROP_CONTRACT';
  path: string;
  expected_sha256: string;
  observed_sha256?: string;
  verified: boolean;
  error?: string;
}

export interface ImerTermOperationalHandshake {
  schema: 'imermcp.imerterm_operational_handshake/1';
  accepted: boolean;
  acceptance_scope: 'IMERTERM_ADAPTER_EFFECT_GATE';
  manual_binding: BindingObservation & { version: '1.4.0'; source_head: string };
  interop_binding: BindingObservation & { version: '1.3.0'; bilateral_status: 'BILATERALLY_ACTIVE' };
  authority: { effect_authority: 'IMERTERM'; transport_is_execution_authority: false; shared_truth: false; shared_authority: false };
  ai_guidance: {
    diagnostic_tool: 'imerterm_capabilities';
    on_blocked: string[];
    on_requires_context: string[];
    prohibitions: string[];
  };
  native_capabilities?: Record<string, unknown>;
  manual_directives?: Record<string, unknown>;
  rules: OperationalPolicyRule[];
  rejections: PolicyRejection[];
  unresolved_context: string[];
}

export const EXPECTED_MANUAL_SHA256 = '5b66e149810366e99cc5108461d711d26aec2e3da053aa1779152d85413d4a30';
export const EXPECTED_MANUAL_HEAD = '9ed98debd7de164ec76c6d002157ea4426b01cc0';
export const EXPECTED_INTEROP_SHA256 = '1147a227b336d04e42d5386a1032a632158f9dac771ce6d52581846e54fc99dc';
const DEFAULT_MANUAL_PATH = 'D:\\019.imerterm\\ImerSpine\\resources\\IMERTERM-OPERATIONS-MACHINE-FIRST-v1.4.0-20260913.json';
const DEFAULT_INTEROP_PATH = 'D:\\023.imermcp\\ImerSpine\\resources\\contracts\\IMERMCP-IMERTERM-INTEROP-CONTRACT-v1.3.0.json';

export class ImerTermPolicyError extends Error {
  constructor(
    public readonly rejection: PolicyRejection,
    public readonly handshake?: ImerTermOperationalHandshake,
  ) {
    super(rejection.message);
    this.name = 'ImerTermPolicyError';
  }
}

function next(action: string, instruction: string): SafeNextAction {
  return { action, instruction };
}

function rejection(
  reason_code: string,
  rule_ref: string,
  message: string,
  observed: unknown,
  required: unknown,
  retryable: boolean,
  action: SafeNextAction,
): PolicyRejection {
  const rule_authority: PolicyAuthorityRef = rule_ref.startsWith('contract.')
    ? { kind: 'IMERMCP_INTEROP_CONTRACT', version: '1.3.0', sha256: EXPECTED_INTEROP_SHA256 }
    : { kind: 'IMERTERM_OPERATIONS_MANUAL', version: '1.4.0', sha256: EXPECTED_MANUAL_SHA256 };
  return { reason_code, rule_ref, rule_authority, message, observed, required, retryable, safe_next_action: action };
}

function rule(
  id: string, category: string, rule_ref: string, summary: string,
  applies_to: string[], enforcement: PolicyEnforcement,
  status: PolicyRuleStatus, blocking: boolean, guidance: string,
): OperationalPolicyRule {
  return { id, category, rule_ref, summary, applies_to, enforcement, status, blocking, guidance };
}

function staticRules(): OperationalPolicyRule[] {
  return [
    rule('AUTH-001', 'AUTHORITY', 'manual.authority.rule', 'GitHub/ImerSpine canonical state and the running Host override chat, helpers and stale files.', ['ALWAYS'], 'BOUND_BYTES', 'SATISFIED', true, 'Refresh authoritative state instead of relying on conversation memory.'),
    rule('AUTH-002', 'AUTHORITY', 'manual.core_invariants.transport', 'Transport is never execution authority.', ['ALL_IMITERM_TOOLS'], 'ADAPTER_CODE', 'SATISFIED', true, 'Route governed effects only through ImerTerm.'),
    rule('AUTH-003', 'AUTHORITY', 'manual.core_invariants.execution_core', 'Execution Core is deterministic and non-agentic.', ['EFFECT'], 'IMERTERM_AUTHORITY', 'REQUIRES_CONTEXT', false, 'Treat ImerTerm result/state as authoritative; do not invent a parallel agentic executor.'),
    rule('DISC-001', 'DISCOVERY', 'manual.discovery_order.project_mutation', 'Doctor and reconcile --check precede project mutation.', ['PROJECT_MUTATION'], 'CALLER_PREFLIGHT', 'REQUIRES_CONTEXT', true, 'Run the project ImerSpine Doctor and reconcile --check before mutating governed project state.'),
    rule('DISC-002', 'DISCOVERY', 'manual.discovery_order.views', 'HANDOFF, BUSSOLA, CURRENT-TRUTH and CLEAR-ROOM must be read before governed project mutation.', ['PROJECT_MUTATION'], 'CALLER_PREFLIGHT', 'REQUIRES_CONTEXT', true, 'Recover the four canonical derived views before changing project truth.'),
    rule('DISC-003', 'DISCOVERY', 'manual.stable_cli.handshake_required_before_dispatch', 'Running Host Capabilities must be queried before dispatch or control.', ['DISPATCH', 'CONTROL'], 'ADAPTER_CODE', 'SATISFIED', true, 'Refresh Capabilities for every governed operation.'),
    rule('DISC-004', 'DISCOVERY', 'manual.discovery_order.fail_closed', 'Missing protocol epoch, schema, feature or target fails closed.', ['DISPATCH', 'CONTROL'], 'ADAPTER_CODE', 'SATISFIED', true, 'Do not infer or emulate absent capabilities.'),
    rule('RDCGIT-001', 'RDC_GIT', 'manual.rdc_git_worktree_enrollment.success_gate', 'New governed P53 worktrees used by unattended RDC require WORKTREE_ENROLLMENT_PASS before Git operations.', ['RDC_GIT'], 'CALLER_PREFLIGHT', 'REQUIRES_CONTEXT', true, 'Run the governed ImerTerm RDC worktree enrollment for the exact governed worktree.'),
    rule('RDCGIT-002', 'RDC_GIT', 'manual.rdc_git_worktree_enrollment.prohibitions.safe_directory', 'safe.directory=* is prohibited.', ['RDC_GIT'], 'CALLER_PREFLIGHT', 'REQUIRES_CONTEXT', true, 'Trust only the exact governed worktree; never wildcard Git trust.'),
    rule('RDCGIT-003', 'RDC_GIT', 'manual.rdc_git_worktree_enrollment.prohibitions.acl', 'Repository ownership or ACL must not be changed merely to satisfy Git.', ['RDC_GIT'], 'CALLER_PREFLIGHT', 'REQUIRES_CONTEXT', true, 'Use governed exact-path enrollment instead of ownership/ACL mutation.'),
    rule('RDCGIT-004', 'RDC_GIT', 'manual.rdc_git_worktree_enrollment.prohibitions.auth', 'LocalSystem GitHub authentication is separate from interactive-user authentication.', ['RDC_GIT'], 'CALLER_PREFLIGHT', 'REQUIRES_CONTEXT', true, 'Do not copy an interactive user token into the service identity.'),
  ];
}

function effectRules(): OperationalPolicyRule[] {
  return [
    rule('CMD-001', 'COMMAND_CONSTRUCTION', 'manual.known_limits.structured_payloads', 'Normative machine-first paths use typed argv, JSON file/stdin or -File instead of nested PowerShell -Command quoting.', ['DISPATCH'], 'ADAPTER_CODE', 'SATISFIED', true, 'Use typed argv or request files; do not compose dynamic multi-shell command strings.'),
    rule('EFFECT-001', 'EFFECT_SEMANTICS', 'manual.core_invariants.intent_before_effect', 'Durable task identity and intent precede effect release.', ['EFFECT'], 'IMERTERM_AUTHORITY', 'REQUIRES_CONTEXT', false, 'ImerTerm owns durable admission; never create a second admission/queue authority.'),
    rule('EFFECT-002', 'EFFECT_SEMANTICS', 'manual.core_invariants.target_attestation', 'Target attestation precedes remote effect.', ['REMOTE_EFFECT'], 'IMERTERM_AUTHORITY', 'REQUIRES_CONTEXT', false, 'Use the governed target and accept ImerTerm attestation as authoritative.'),
    rule('EFFECT-003', 'EFFECT_SEMANTICS', 'manual.core_invariants.unknown_outcome', 'UNKNOWN_OUTCOME is never automatically replayed.', ['EFFECT', 'RECOVERY'], 'ADAPTER_CODE', 'SATISFIED', true, 'Observe the existing task with TASK_SHOW/TASK_JOURNAL; never resubmit to escape uncertainty.'),
    rule('EFFECT-004', 'EFFECT_SEMANTICS', 'manual.core_invariants.duplicate_task_id', 'Duplicate task_id never causes blind re-execution.', ['EFFECT', 'RETRY'], 'IMERTERM_AUTHORITY', 'REQUIRES_CONTEXT', false, 'Preserve the same identity for an intentional exact retry and let ImerTerm classify it.'),
    rule('SECRET-001', 'SECRETS', 'manual.core_invariants.secrets', 'Secrets remain local and resolved secret values never enter Git/ImerSpine task envelopes.', ['ALWAYS'], 'ADAPTER_CODE', 'SATISFIED', true, 'Pass identifiers/capabilities, never resolved credentials.'),
    rule('API-001', 'PROHIBITED_API', 'manual.prohibited_parallel_apis.sqlite', 'Direct SQLite access is not an operational control API.', ['EFFECT', 'CONTROL'], 'ADAPTER_CODE', 'SATISFIED', true, 'Use ImerTerm task/control interfaces; read-only SQLite forensics is diagnostic only.'),
    rule('API-002', 'PROHIBITED_API', 'manual.prohibited_parallel_apis.remote', 'Direct ssh.exe/systemctl/ubus/RouterOS CLI must not bypass governed ImerTerm operations.', ['REMOTE_EFFECT'], 'ADAPTER_CODE', 'SATISFIED', true, 'Use ImerTerm RunSsh/RunRouterOs semantics; never bypass the effect authority.'),
    rule('API-003', 'PROHIBITED_API', 'manual.prohibited_parallel_apis.second_authority', 'RDC, helpers, GitHub transport and chat logic must not create a second execution authority.', ['ALWAYS'], 'ADAPTER_CODE', 'SATISFIED', true, 'Keep all ImerTerm-governed effects behind the same Host authority.'),
    rule('API-004', 'PROHIBITED_API', 'manual.prohibited_parallel_apis.no_uncertainty_bypass', 'Do not replay UNKNOWN_OUTCOME or allocate a new task_id to bypass uncertainty.', ['RECOVERY', 'RETRY'], 'ADAPTER_CODE', 'SATISFIED', true, 'Observe/journal the original task identity instead of resubmitting.'),
  ];
}

function healthAndRecoveryRules(): OperationalPolicyRule[] {
  return [
    rule('HEALTH-001', 'HEALTH', 'manual.operational_health.required_before_mutation.services', 'ImerTerm must be Running/Automatic; ImerTerm-RDC must be Running/Automatic when RDC transport is required.', ['MUTATION_PREFLIGHT', 'RDC'], 'CALLER_PREFLIGHT', 'REQUIRES_CONTEXT', true, 'Verify service health through the governed operational preflight before mutation.'),
    rule('HEALTH-002', 'HEALTH', 'manual.operational_health.required_before_mutation.sqlite', 'SQLite quick_check must be ok before mutation.', ['MUTATION_PREFLIGHT'], 'IMERTERM_AUTHORITY', 'REQUIRES_CONTEXT', false, 'Use ImerTerm-owned health evidence; do not turn direct SQLite access into a control API.'),
    rule('HEALTH-003', 'HEALTH', 'manual.operational_health.required_before_mutation.nonterminal', 'New mutation requires zero nonterminal tasks unless intentionally managing an existing task.', ['MUTATION_PREFLIGHT'], 'IMERTERM_AUTHORITY', 'REQUIRES_CONTEXT', false, 'Observe current governed task state and avoid creating competing mutation intent.'),
    rule('HEALTH-004', 'HEALTH', 'manual.operational_health.required_before_mutation.capabilities', 'Capabilities must pass and the requested target must be advertised.', ['DISPATCH'], 'RUNTIME_CAPABILITY', 'SATISFIED', true, 'Refresh Capabilities and select only an advertised target.'),
    rule('LIMIT-001', 'LIMITS', 'manual.stable_cli.local_pipe.max_request_bytes', 'The local authenticated pipe request ceiling is 131072 bytes.', ['LOCAL_IPC'], 'IMERTERM_AUTHORITY', 'REQUIRES_CONTEXT', false, 'Keep local control payloads bounded; stage large content instead of embedding it.'),
    rule('LIMIT-002', 'LIMITS', 'manual.stable_cli.local_pipe.max_response_bytes', 'The local authenticated pipe response ceiling is 65536 bytes.', ['LOCAL_IPC'], 'IMERTERM_AUTHORITY', 'REQUIRES_CONTEXT', false, 'Treat omitted optional diagnostics as bounded-response behavior, not changed task state.'),
    rule('RECOV-001', 'RECOVERY', 'manual.recovery.runtime_recovery.sqlite_monotonic', 'Binary rollback preserves newer SQLite/task evidence; old durable state is never restored merely to roll back binaries.', ['RECOVERY'], 'CALLER_PREFLIGHT', 'REQUIRES_CONTEXT', true, 'Rollback only causal runtime files and preserve monotonic durable task state.'),
    rule('RECOV-002', 'RECOVERY', 'manual.recovery.runtime_recovery.routeros', 'RouterOS STARTING/RUNNING ambiguity after Host replacement is fail-closed UNKNOWN_OUTCOME and never replayed.', ['ROUTEROS', 'RECOVERY'], 'IMERTERM_AUTHORITY', 'REQUIRES_CONTEXT', false, 'Preserve UNKNOWN_OUTCOME and inspect existing evidence; do not reissue the command.'),
    rule('PROV-001', 'PROVENANCE', 'manual.authority.production_governance_rule', 'Functional runtime source and later governance/release commits are separate provenance authorities.', ['DEPLOYMENT', 'RECOVERY'], 'CALLER_PREFLIGHT', 'REQUIRES_CONTEXT', true, 'Do not redeploy merely to make a governance HEAD stamp equal a deployed binary ProductVersion.'),
    rule('PERM-001', 'OPERATOR', 'manual.permissions_and_operator_use.operator_expectation', 'Stable CLI invocation must not require Administrator solely for access.', ['LOCAL_CLI'], 'CALLER_PREFLIGHT', 'REQUIRES_CONTEXT', false, 'Use the ordinary operator token unless the governed operation itself requires elevation.'),
    rule('PERM-002', 'OPERATOR', 'manual.permissions_and_operator_use.secret_rule', 'Operator CLI access does not imply remote private-key access; service identities own remote secrets.', ['REMOTE_EFFECT'], 'IMERTERM_AUTHORITY', 'REQUIRES_CONTEXT', false, 'Reference governed targets; never copy service-owned private keys into ImerMCP.'),
    rule('PERM-003', 'OPERATOR', 'manual.permissions_and_operator_use.test_ui_rule', 'Routine qualification is non-interactive/Session 0; visible PowerShell UI is reserved for explicit GUI tests.', ['QUALIFICATION'], 'CALLER_PREFLIGHT', 'REQUIRES_CONTEXT', false, 'Prefer non-interactive qualification and avoid visible Scheduled Task windows.'),
  ];
}

function interopRules(): OperationalPolicyRule[] {
  return [
    rule('INTEROP-001', 'INTEROP', 'manual.imer_mcp_interop.role', 'ImerTerm remains the single governed effect authority; ImerMCP is only the northbound adapter/consumer.', ['ALL_IMITERM_TOOLS'], 'ADAPTER_CODE', 'SATISFIED', true, 'Keep task admission, execution, cancellation, recovery and evidence ownership in ImerTerm.'),
    rule('INTEROP-002', 'INTEROP', 'manual.imer_mcp_interop.peer_authority', 'ImerMCP and ImerTerm keep independent ImerSpine truth, generation and authority.', ['ALWAYS'], 'BOUND_BYTES', 'SATISFIED', true, 'Exchange only versioned content-addressed contracts and peer bindings; never copy peer truth as local truth.'),
    rule('INTEROP-003', 'INTEROP', 'contract.v1.3.capability_discovery', 'Capability discovery is mandatory before dispatch and control.', ['DISPATCH', 'CONTROL'], 'ADAPTER_CODE', 'SATISFIED', true, 'Build every governed operation from a fresh accepted handshake.'),
    rule('M16-001', 'STRUCTURED_V2', 'manual.m16_governed_staging.fallback_rule', 'Structured V2 never automatically falls back to raw V1.', ['BASH_V2'], 'ADAPTER_CODE', 'SATISFIED', true, 'If any V2 gate is absent or V2 fails, report the gate and stop; do not retry as V1.'),
    rule('M16-002', 'STRUCTURED_V2', 'manual.m16_governed_staging.powershell_v2_advertised', 'PowerShell V2 is not advertised and must not be inferred.', ['POWERSHELL'], 'RUNTIME_CAPABILITY', 'SATISFIED', true, 'Use only imerterm.powershell_dispatch/1 until a future contract and Host explicitly advertise a successor.'),
    rule('M16-003', 'STRUCTURED_V2', 'contract.v1.3.structured_dispatch_v2', 'Bash V2 uses logical runtime_id, typed argv and verified logical artifacts; raw script/executable/remote absolute path injection is forbidden.', ['BASH_V2'], 'ADAPTER_CODE', 'SATISFIED', true, 'Use LITERAL/ARTIFACT_PATH typed arguments and declared artifacts only.'),
    rule('M16-004', 'STRUCTURED_V2', 'contract.v1.3.artifacts.pre_effect_source_verification', 'Artifact length and SHA-256 are verified before effect release and remote destination is derived by ImerTerm.', ['BASH_V2'], 'IMERTERM_AUTHORITY', 'REQUIRES_CONTEXT', false, 'Let ImerTerm verify/stage artifacts; never choose a caller-controlled remote destination.'),
    rule('KNOWN-001', 'KNOWN_LIMIT', 'manual.known_limits.gui_boundary', 'GUI/Desktop automation is outside the ImerTerm v1 execution-service boundary.', ['GUI'], 'CALLER_PREFLIGHT', 'REQUIRES_CONTEXT', false, 'Use a separately qualified GUI capability instead of treating ImerTerm as desktop automation.'),
    rule('KNOWN-002', 'KNOWN_LIMIT', 'manual.rdc_resilience.upgrade_rule', 'The RDC 0.2.48 compatibility patch is hash-pinned and requires requalification before upgrade/removal.', ['RDC_UPDATE'], 'CALLER_PREFLIGHT', 'REQUIRES_CONTEXT', true, 'Requalify long-line handling and child-loss recovery before changing the pinned patch.'),
    rule('KNOWN-003', 'KNOWN_LIMIT', 'manual.known_limits.imerspine_core', 'ImerTerm ImerSpine Core upgrade is an explicit migration and must not be folded into an unrelated product change.', ['IMERSPINE_UPGRADE'], 'CALLER_PREFLIGHT', 'REQUIRES_CONTEXT', true, 'Perform a separate qualified ImerSpine migration.'),
  ];
}

async function observeBinding(kind: BindingObservation['kind'], filePath: string, expected: string): Promise<BindingObservation> {
  try {
    const bytes = await readFile(filePath);
    const observed = createHash('sha256').update(bytes).digest('hex');
    return { kind, path: filePath, expected_sha256: expected, observed_sha256: observed, verified: observed === expected };
  } catch (error) {
    return { kind, path: filePath, expected_sha256: expected, verified: false, error: String(error) };
  }
}

export async function observeOperationalBindings(): Promise<{ manual: BindingObservation; interop: BindingObservation }> {
  const manualPath = process.env.IMERMCP_IMERTERM_MANUAL_PATH?.trim() || DEFAULT_MANUAL_PATH;
  const interopPath = process.env.IMERMCP_IMERTERM_INTEROP_PATH?.trim() || DEFAULT_INTEROP_PATH;
  const manual = await observeBinding('IMERTERM_OPERATIONS_MANUAL', manualPath, EXPECTED_MANUAL_SHA256);
  const interop = await observeBinding('IMERMCP_INTEROP_CONTRACT', interopPath, EXPECTED_INTEROP_SHA256);
  return { manual, interop };
}

function has(list: unknown, value: string): boolean {
  return Array.isArray(list) && list.includes(value);
}

function asCaps(response: Record<string, unknown>): Record<string, unknown> | undefined {
  if (response.status !== 'CONTROL_OK' || response.result_code !== 'CAPABILITIES') return undefined;
  const value = response.capabilities;
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

const REQUIRED_SCHEMAS = [
  'imerterm.powershell_dispatch/1', 'imerterm.bash_dispatch/1',
  'imerterm.routeros_dispatch/1', 'imerterm.local_control/1',
];
const REQUIRED_FEATURES = [
  'capabilities_handshake_v1', 'task_control_v1', 'task_show_v1', 'task_cancel_v1', 'task_journal_v1',
  'bash_dispatch_v1', 'routeros_dispatch_v1',
];
const STRUCTURED_V2_GATES = ['imerterm.bash_dispatch/2', 'artifact_staging_v1', 'structured_dispatch_v2', 'structured_runtime_catalog_v1'];

function structuredV2Available(caps: Record<string, unknown> | undefined): boolean {
  if (!caps) return false;
  return has(caps.dispatch_schemas, STRUCTURED_V2_GATES[0]) &&
    STRUCTURED_V2_GATES.slice(1).every(feature => has(caps.features, feature));
}

function bindingRejections(manual: BindingObservation, interop: BindingObservation): PolicyRejection[] {
  const out: PolicyRejection[] = [];
  if (!manual.verified) out.push(rejection(
    'IMERTERM_MANUAL_BINDING_MISMATCH', 'manual.binding.sha256',
    'The ImerTerm operations manual bytes do not match the ImerMCP-accepted manual binding.',
    manual.observed_sha256 ?? manual.error ?? 'UNAVAILABLE', manual.expected_sha256, true,
    next('RECOVER_AUTHORITATIVE_MANUAL', 'Recover current ImerTerm Git/ImerSpine authority and re-accept the exact manual bytes. Do not dispatch while the binding is unresolved.'),
  ));
  if (!interop.verified) out.push(rejection(
    'IMERMCP_INTEROP_BINDING_MISMATCH', 'contract.v1.3.binding.sha256',
    'The local interoperability contract bytes do not match the bilaterally active v1.3 binding.',
    interop.observed_sha256 ?? interop.error ?? 'UNAVAILABLE', interop.expected_sha256, true,
    next('RECOVER_BILATERAL_CONTRACT', 'Recover the byte-identical bilaterally active v1.3 contract. Do not substitute another contract version or infer compatibility.'),
  ));
  return out;
}

function capabilityRejections(response: Record<string, unknown>, caps: Record<string, unknown> | undefined): PolicyRejection[] {
  if (!caps) return [rejection(
    'IMERTERM_CAPABILITIES_INVALID', 'manual.stable_cli.handshake_required_before_dispatch',
    'The running ImerTerm Host did not return a valid machine-first CAPABILITIES response.',
    { status: response.status, result_code: response.result_code }, { status: 'CONTROL_OK', result_code: 'CAPABILITIES' }, true,
    next('REFRESH_CAPABILITIES', 'Query the running ImerTerm Host Capabilities again. Do not construct or dispatch an effect until a valid handshake is available.'),
  )];
  const out: PolicyRejection[] = [];
  if (caps.schema !== 'imerterm.local_capabilities/1') out.push(rejection(
    'IMERTERM_CAPABILITIES_SCHEMA_MISMATCH', 'manual.stable_cli.compatibility_rule',
    'The running Host capabilities schema is incompatible with the accepted ImerMCP adapter.', caps.schema, 'imerterm.local_capabilities/1', false,
    next('STOP_INCOMPATIBLE_HOST', 'Do not dispatch. Reconcile the deployed ImerTerm Host and the accepted ImerMCP interoperability contract before retrying.'),
  ));
  if (caps.protocol_epoch !== 1) out.push(rejection(
    'IMERTERM_PROTOCOL_EPOCH_MISMATCH', 'manual.stable_cli.protocol_epoch',
    'The running ImerTerm protocol epoch is incompatible.', caps.protocol_epoch, 1, false,
    next('STOP_INCOMPATIBLE_HOST', 'Do not dispatch or infer compatibility. Requalify the Host/adapter contract for the observed protocol epoch.'),
  ));
  for (const schema of REQUIRED_SCHEMAS) if (!has(caps.dispatch_schemas, schema)) out.push(rejection(
    'IMERTERM_REQUIRED_SCHEMA_MISSING', 'contract.v1.3.southbound_binding.dispatch.schemas',
    `The running ImerTerm Host does not advertise required schema ${schema}.`, caps.dispatch_schemas, schema, true,
    next('REFRESH_CAPABILITIES', 'Refresh the running Host Capabilities. Do not emulate the missing schema and do not choose an implicit fallback.'),
  ));
  for (const feature of REQUIRED_FEATURES) if (!has(caps.features, feature)) out.push(rejection(
    'IMERTERM_REQUIRED_FEATURE_MISSING', 'manual.stable_cli.compatibility_rule',
    `The running ImerTerm Host does not advertise required feature ${feature}.`, caps.features, feature, true,
    next('REFRESH_CAPABILITIES', 'Refresh the running Host Capabilities. If the feature remains absent, stop and requalify the deployed Host/contract; do not bypass it.'),
  ));
  return out;
}

export function evaluateOperationalHandshake(
  response: Record<string, unknown>,
  bindings: { manual: BindingObservation; interop: BindingObservation },
): ImerTermOperationalHandshake {
  const caps = asCaps(response);
  const rejections = [
    ...bindingRejections(bindings.manual, bindings.interop),
    ...capabilityRejections(response, caps),
  ];
  const rules: OperationalPolicyRule[] = [
    rule('BIND-001', 'BINDING', 'manual.binding.sha256', 'ImerMCP is bound to the exact accepted ImerTerm operations-manual bytes.', ['ALL_IMITERM_TOOLS'], 'BOUND_BYTES', bindings.manual.verified ? 'SATISFIED' : 'BLOCKED', true, 'A manual byte change requires explicit ImerMCP policy review and re-acceptance.'),
    rule('BIND-002', 'BINDING', 'contract.v1.3.binding.sha256', 'ImerMCP is bound to the exact bilaterally active interoperability-contract bytes.', ['ALL_IMITERM_TOOLS'], 'BOUND_BYTES', bindings.interop.verified ? 'SATISFIED' : 'BLOCKED', true, 'Never substitute an unaccepted contract version.'),
    rule('RUNTIME-001', 'RUNTIME', 'manual.stable_cli.compatibility_rule', 'The running Host must expose the accepted capabilities schema and protocol epoch.', ['DISPATCH', 'CONTROL'], 'RUNTIME_CAPABILITY', caps && caps.schema === 'imerterm.local_capabilities/1' && caps.protocol_epoch === 1 ? 'SATISFIED' : 'BLOCKED', true, 'The running Host is authoritative; stop on incompatibility.'),
    rule('RUNTIME-002', 'RUNTIME', 'contract.v1.3.backward_compatibility_rule', 'The running Host must advertise the preserved V1/control base ABI required for ordinary governed operations.', ['DISPATCH', 'CONTROL'], 'RUNTIME_CAPABILITY', rejections.some(item => item.reason_code === 'IMERTERM_REQUIRED_SCHEMA_MISSING' || item.reason_code === 'IMERTERM_REQUIRED_FEATURE_MISSING') ? 'BLOCKED' : 'SATISFIED', true, 'Refresh Capabilities; never infer missing base-ABI support.'),
    rule('RUNTIME-003', 'STRUCTURED_V2', 'contract.v1.3.structured_dispatch_v2.capability_gates', 'Bash Structured V2 is an additive capability and is usable only when all four V2 gates are advertised.', ['BASH_V2'], 'RUNTIME_CAPABILITY', structuredV2Available(caps) ? 'SATISFIED' : 'REQUIRES_CONTEXT', false, 'A V2 request must fail closed when any gate is absent; never auto-fallback to V1. V1 remains independently valid when its own gates are satisfied.'),
    ...staticRules(), ...effectRules(), ...healthAndRecoveryRules(), ...interopRules(),
  ];
  return {
    schema: 'imermcp.imerterm_operational_handshake/1', accepted: rejections.length === 0,
    acceptance_scope: 'IMERTERM_ADAPTER_EFFECT_GATE',
    manual_binding: { ...bindings.manual, version: '1.4.0', source_head: EXPECTED_MANUAL_HEAD },
    interop_binding: { ...bindings.interop, version: '1.3.0', bilateral_status: 'BILATERALLY_ACTIVE' },
    authority: { effect_authority: 'IMERTERM', transport_is_execution_authority: false, shared_truth: false, shared_authority: false },
    ai_guidance: {
      diagnostic_tool: 'imerterm_capabilities',
      on_blocked: [
        'Do not dispatch the blocked operation.',
        'Read every rejection reason_code, rule_ref, rule_authority, observed, required and safe_next_action.',
        'Execute only the stated safe_next_action, then refresh capabilities and rebuild the handshake before retrying.',
      ],
      on_requires_context: [
        'REQUIRES_CONTEXT is not a global failure. Match rule.applies_to against the intended operation.',
        'Before an applicable operation, satisfy its governed preflight and retain machine-readable evidence.',
      ],
      prohibitions: [
        'Never bypass ImerTerm for an ImerTerm-governed effect.',
        'Never automatically fall back from Structured V2 to raw V1.',
        'Never replay UNKNOWN_OUTCOME or allocate a new task_id merely to escape uncertainty.',
        'Never infer an unadvertised schema, feature or target.',
      ],
    },
    native_capabilities: caps, rules, rejections,
    unresolved_context: rules.filter(item => item.status === 'REQUIRES_CONTEXT').map(item => item.id),
  };
}

export async function buildOperationalHandshake(response: Record<string, unknown>): Promise<ImerTermOperationalHandshake> {
  const bindings = await observeOperationalBindings();
  const handshake = evaluateOperationalHandshake(response, bindings);
  if (!bindings.manual.verified) return handshake;
  try {
    const raw = await readFile(bindings.manual.path, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('manual JSON root is not an object');
    const document = parsed as Record<string, unknown>;
    if (document.schema !== 'imerterm.operations_manual/1' || document.version !== '1.4.0' || document.status !== 'CANONICAL_OPERATIONAL_REFERENCE') {
      throw new Error('manual identity fields do not match the accepted operational reference');
    }
    handshake.manual_directives = document;
  } catch (error) {
    handshake.accepted = false;
    handshake.rejections.push(rejection(
      'IMERTERM_MANUAL_DOCUMENT_INVALID', 'manual.binding.document',
      'The hash-verified ImerTerm operations manual could not be materialized as the accepted machine-readable manual.',
      String(error), { schema: 'imerterm.operations_manual/1', version: '1.4.0', status: 'CANONICAL_OPERATIONAL_REFERENCE' }, true,
      next('RECOVER_AUTHORITATIVE_MANUAL', 'Recover the exact authoritative manual bytes and rebuild the handshake. Do not dispatch while the verified manual document is unavailable.'),
    ));
  }
  return handshake;
}

export function requireAcceptedHandshake(handshake: ImerTermOperationalHandshake): Record<string, unknown> {
  if (!handshake.accepted) {
    const first = handshake.rejections[0] ?? rejection(
      'IMERTERM_OPERATIONAL_HANDSHAKE_REJECTED', 'manual.binding',
      'ImerTerm operational handshake was rejected without a classified reason.', undefined, 'accepted=true', false,
      next('STOP_AND_RECOVER_AUTHORITY', 'Recover ImerTerm/ImerMCP authoritative state before any effect or control operation.'),
    );
    throw new ImerTermPolicyError(first, handshake);
  }
  if (!handshake.native_capabilities) throw new ImerTermPolicyError(rejection(
    'IMERTERM_CAPABILITIES_INVALID', 'manual.stable_cli.handshake_required_before_dispatch',
    'Accepted handshake has no native capabilities object.', undefined, 'imerterm.local_capabilities/1', true,
    next('REFRESH_CAPABILITIES', 'Query the running Host Capabilities and rebuild the operational handshake.'),
  ), handshake);
  return handshake.native_capabilities;
}

export function requestValidationError(message: string): ImerTermPolicyError {
  return new ImerTermPolicyError(rejection(
    'IMERMCP_REQUEST_VALIDATION_REJECTED', 'contract.v1.3.interface.northbound_tools', message,
    'request rejected by deterministic adapter validation', 'arguments conforming to the advertised tool inputSchema and active interoperability contract', true,
    next('CORRECT_REQUEST', 'Correct only the request arguments using the current tool inputSchema and operational handshake. Preserve the intended semantics; do not bypass ImerTerm, auto-fallback, or hide the rejected payload in another field.'),
  ));
}

export function requireAdvertisedValue(
  caps: Record<string, unknown>, key: string, value: string,
  ruleRef: string, reasonCode: string, missingInstruction: string,
): void {
  if (has(caps[key], value)) return;
  throw new ImerTermPolicyError(rejection(
    reasonCode, ruleRef, `Running ImerTerm Host does not advertise ${value} in ${key}.`,
    caps[key], value, true,
    next('REFRESH_CAPABILITIES', missingInstruction),
  ));
}
