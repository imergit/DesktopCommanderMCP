export type GovernedEffectRouteDecision =
  | { route_required: false }
  | {
      route_required: true;
      reason_code: 'IMERTERM_ROUTE_REQUIRED';
      matched_commands: string[];
      rule: string;
      next_allowed_tools: string[];
      prohibited_action: string;
    };

const GOVERNED_DIRECT_COMMANDS = new Set([
  'mkfs', 'format', 'mount', 'umount', 'fdisk', 'dd', 'parted', 'diskpart',
  'sudo', 'su', 'passwd', 'adduser', 'useradd', 'usermod', 'groupadd', 'chsh', 'visudo',
  'shutdown', 'reboot', 'halt', 'poweroff', 'init', 'systemctl', 'ubus',
  'iptables', 'firewall', 'netsh', 'sfc', 'bcdedit', 'reg', 'net', 'sc', 'runas', 'cipher', 'takeown',
  'ssh', 'scp', 'sftp', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe', 'cmd', 'cmd.exe', 'bash', 'bash.exe', 'sh', 'wsl',
]);

export function evaluateImerMcpDirectTerminalRoute(commands: string[]): GovernedEffectRouteDecision {
  if (process.env.IMERMCP_ENABLE_IMERTERM !== '1') return { route_required: false };
  const matched = [...new Set(commands.map((c) => c.toLowerCase()).filter((c) => GOVERNED_DIRECT_COMMANDS.has(c)))];
  if (matched.length === 0) return { route_required: false };
  return {
    route_required: true,
    reason_code: 'IMERTERM_ROUTE_REQUIRED',
    matched_commands: matched,
    rule: 'ImerMCP may expose compatibility tools, but governed local/remote effects remain owned by ImerTerm.',
    next_allowed_tools: ['imerterm_run_powershell', 'imerterm_run_ssh', 'imerterm_run_routeros'],
    prohibited_action: 'Do not bypass the ImerTerm authority by replaying the command through start_process or another direct shell path.',
  };
}
