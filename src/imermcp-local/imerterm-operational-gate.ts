export type GateRequirement = {
  dispatchSchema?: string;
  features?: string[];
  targetKey?: string;
  targetId?: string;
};

export type OperationalGateResult = {
  schema: 'imermcp.operational_gate_result/1';
  accepted: boolean;
  result_code: 'HANDSHAKE_ACCEPTED' | 'HANDSHAKE_REJECTED';
  reason_code: string;
  message: string;
  rule: string;
  observed: Record<string, unknown>;
  required: Record<string, unknown>;
  retryable: boolean;
  next_allowed_action: string;
  prohibited_actions: string[];
  policy: typeof OPERATIONAL_POLICY;
};

export const OPERATIONAL_POLICY = {
  schema: 'imermcp.imerterm_operational_policy/1',
  source_manual: {
    schema: 'imerterm.operations_manual/1',
    version: '1.4.0',
    path: 'ImerSpine/resources/IMERTERM-OPERATIONS-MACHINE-FIRST-v1.4.0-20260913.json',
    sha256: '5b66e149810366e99cc5108461d711d26aec2e3da053aa1779152d85413d4a30',
  },
  authority: {
    effect_authority: 'IMERTERM',
    transport_is_execution_authority: false,
    second_execution_authority_allowed: false,
    live_host_capabilities_authoritative: true,
    chat_or_helper_may_override_live_state: false,
  },
  discovery: {
    doctor_before_project_mutation: true,
    reconcile_check_before_project_mutation: true,
    canonical_views_before_project_mutation: ['HANDOFF', 'BUSSOLA', 'CURRENT-TRUTH', 'CLEAR-ROOM'],
    operations_manual_required: true,
    capabilities_before_dispatch_or_control: true,
    fail_closed_on_missing_epoch_schema_feature_or_target: true,
  },
  effect_semantics: {
    durable_identity_and_intent_before_effect: true,
    target_attestation_before_remote_effect: true,
    duplicate_task_id_blind_reexecution: false,
    unknown_outcome_automatic_replay: false,
    new_task_id_to_bypass_uncertainty: false,
    completion_cancellation_recovery_authority: 'IMERTERM',
  },
  command_construction: {
    grouped_commands_as_normative_transport: false,
    dynamic_nested_shell_interpolation: false,
    preferred_structured_paths: ['TYPED_ARGV', 'JSON_FILE', 'STDIN', 'POWERSHELL_FILE'],
    encode_late_decode_early: true,
  },
  prohibited_parallel_apis: {
    direct_sqlite_control: false,
    direct_ssh_for_governed_targets: false,
    direct_systemctl_or_ubus_bypass: false,
    direct_routeros_bypass: false,
    helper_or_chat_execution_authority: false,
  },
  health: {
    imerterm_service_running_automatic_before_mutation: true,
    rdc_service_running_automatic_when_rdc_needed: true,
    sqlite_quick_check_ok_before_mutation: true,
    zero_nonterminal_before_new_mutation: true,
    advertised_target_required: true,
  },
  recovery: {
    durable_state_is_monotonic: true,
    binary_rollback_may_restore_old_sqlite: false,
    ambiguous_effect_result: 'UNKNOWN_OUTCOME',
    transport_exit_code_is_completion_authority: false,
  },
  rdc_git: {
    exact_worktree_enrollment_required: true,
    success_result_code: 'WORKTREE_ENROLLMENT_PASS',
    wildcard_safe_directory_allowed: false,
    mutate_acl_or_ownership_for_git_trust: false,
    interactive_git_credentials_reused_by_localsystem: false,
  },
  compatibility: {
    protocol_epoch: 1,
    implicit_capability_inference: false,
    automatic_v2_to_v1_fallback: false,
    powershell_v2_inferred: false,
  },
  limits: {
    local_pipe_max_request_bytes: 131072,
    local_pipe_max_response_bytes: 65536,
    imermcp_adapter_max_request_bytes: 524288,
    imermcp_adapter_max_capture_bytes: 4194304,
    structured_stream_max_bytes_each: 8192,
    resources_must_be_bounded: true,
  },
  secrets_and_evidence: {
    resolved_secrets_in_git_or_task_envelopes: false,
    payload_logging_by_default: false,
    evidence_prefers_ids_hashes_sizes_states_timings: true,
  },
  provenance: {
    functional_runtime_and_governance_head_are_distinct: true,
    redeploy_only_to_match_governance_hash: false,
  },
  interop: {
    contract_version: '1.3.0',
    shared_truth_or_authority: false,
    powershell_v2_supported: false,
    bash_v2_requires_all_gates: true,
    caller_supplied_executable_path_in_v2: false,
    caller_supplied_remote_absolute_path_in_v2: false,
    hidden_raw_script_in_v2: false,
    typed_arguments_required_in_v2: true,
    staged_bytes_verified_before_effect: true,
  },
  known_limits: {
    gui_desktop_automation_in_imerterm_v1: false,
    routeros_ambiguous_running_becomes_unknown_outcome: true,
    routine_qualification_noninteractive_session0: true,
  },
} as const;
export class OperationalGateError extends Error {
  constructor(public readonly gate: OperationalGateResult) {
    super(gate.message);
    this.name = 'OperationalGateError';
  }
}

function listHas(caps: Record<string, unknown>, key: string, value: string): boolean {
  const list = caps[key];
  return Array.isArray(list) && list.includes(value);
}

function rejectGate(
  reasonCode: string,
  message: string,
  rule: string,
  observed: Record<string, unknown>,
  required: Record<string, unknown>,
  retryable: boolean,
  nextAllowedAction: string,
  prohibitedActions: string[],
): never {
  throw new OperationalGateError({
    schema: 'imermcp.operational_gate_result/1', accepted: false,
    result_code: 'HANDSHAKE_REJECTED', reason_code: reasonCode, message, rule,
    observed, required, retryable, next_allowed_action: nextAllowedAction,
    prohibited_actions: prohibitedActions, policy: OPERATIONAL_POLICY,
  });
}
export function evaluateOperationalGate(
  caps: Record<string, unknown>,
  requirement: GateRequirement = {},
): OperationalGateResult {
  if (caps.protocol_epoch !== OPERATIONAL_POLICY.compatibility.protocol_epoch) {
    rejectGate(
      'IMERTERM_PROTOCOL_EPOCH_MISMATCH',
      'Running ImerTerm Host protocol epoch is incompatible with the accepted ImerMCP policy.',
      'Running Host Capabilities are authoritative; incompatible protocol epochs fail closed.',
      { protocol_epoch: caps.protocol_epoch },
      { protocol_epoch: OPERATIONAL_POLICY.compatibility.protocol_epoch },
      true,
      'Refresh ImerTerm Capabilities after deploying a mutually compatible Host/adapter pair.',
      ['Do not infer compatibility.', 'Do not bypass ImerTerm.', 'Do not fall back to a different execution authority.'],
    );
  }
  if (requirement.dispatchSchema && !listHas(caps, 'dispatch_schemas', requirement.dispatchSchema)) {
    rejectGate(
      'IMERTERM_DISPATCH_SCHEMA_MISSING',
      `Running ImerTerm Host does not advertise ${requirement.dispatchSchema}.`,
      'Dispatch is allowed only for schemas explicitly advertised by the running Host.',
      { dispatch_schemas: caps.dispatch_schemas }, { dispatch_schema: requirement.dispatchSchema }, true,
      'Refresh Capabilities and use only an explicitly advertised schema.',
      ['Do not infer schema support.', 'Do not auto-fallback to another schema.', 'Do not bypass ImerTerm with direct shell execution.'],
    );
  }
  for (const feature of requirement.features ?? []) {
    if (!listHas(caps, 'features', feature)) {
      rejectGate(
        'IMERTERM_FEATURE_MISSING',
        `Running ImerTerm Host does not advertise ${feature}.`,
        'Feature use is allowed only when the running Host advertises it explicitly.',
        { features: caps.features }, { feature }, true,
        'Refresh ImerTerm Capabilities and re-evaluate the request. Preserve the requested mode.',
        ['Do not infer the feature.', 'Do not auto-fallback to raw V1.', 'Do not bypass ImerTerm with direct execution.'],
      );
    }
  }
  if (requirement.targetKey && requirement.targetId && !listHas(caps, requirement.targetKey, requirement.targetId)) {
    rejectGate(
      'IMERTERM_TARGET_NOT_ADVERTISED',
      `Running ImerTerm Host does not expose target ${requirement.targetId} in ${requirement.targetKey}.`,
      'Target attestation and advertisement precede remote effect release.',
      { [requirement.targetKey]: caps[requirement.targetKey] },
      { target_key: requirement.targetKey, target_id: requirement.targetId },
      true,
      'Refresh Capabilities and select only a target advertised by the running Host.',
      ['Do not bypass target attestation.', 'Do not substitute direct SSH or RouterOS access.'],
    );
  }
  return {
    schema: 'imermcp.operational_gate_result/1', accepted: true,
    result_code: 'HANDSHAKE_ACCEPTED', reason_code: 'POLICY_AND_CAPABILITIES_ACCEPTED',
    message: 'ImerMCP operational policy and requested live ImerTerm capability gates are satisfied.',
    rule: 'Effects remain owned by ImerTerm and only explicitly advertised capabilities may be used.',
    observed: { protocol_epoch: caps.protocol_epoch }, required: requirement,
    retryable: false, next_allowed_action: 'Proceed only with the already-validated governed operation.',
    prohibited_actions: [], policy: OPERATIONAL_POLICY,
  };
}
