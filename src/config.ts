import path from 'path';
import os from 'os';

// Desktop Commander keeps its historical per-user path. ImerMCP may override
// the config file explicitly so both products can coexist without shared state.
export const USER_HOME = os.homedir();
const DEFAULT_CONFIG_DIR = path.join(USER_HOME, '.claude-server-commander');
const configuredFile = process.env.IMERMCP_CONFIG_FILE?.trim();
export const CONFIG_FILE = configuredFile ? path.resolve(configuredFile) : path.join(DEFAULT_CONFIG_DIR, 'config.json');
const CONFIG_DIR = path.dirname(CONFIG_FILE);

export const TOOL_CALL_FILE = path.join(CONFIG_DIR, 'claude_tool_call.log');
export const TOOL_CALL_FILE_MAX_SIZE = 1024 * 1024 * 10; // 10 MB
export const DEFAULT_COMMAND_TIMEOUT = 1000; // milliseconds
