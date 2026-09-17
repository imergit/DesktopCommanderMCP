#!/usr/bin/env node

// MUST be first: raises the libuv threadpool size before any fs work is
// submitted. See src/bootstrap.ts for why import order matters.
import './bootstrap.js';
import { FilteredStdioServerTransport } from './custom-stdio.js';
import { server, flushDeferredMessages } from './server.js';
import { installFileMaterializationBoundary } from './imermcp-local/file-materialization-registration.js';
import { installBusinessGoldBoundary } from './imermcp-local/business-gold-registration.js';
import { commandManager } from './command-manager.js';
import { configManager } from './config-manager.js';
import { featureFlagManager } from './utils/feature-flags.js';
import { runSetup } from './npm-scripts/setup.js';
import { runUninstall } from './npm-scripts/uninstall.js';
import { capture } from './utils/capture.js';
import { logToStderr, logger } from './utils/logger.js';
import { runRemote } from './npm-scripts/remote.js';
import { ensureChromeAvailable } from './tools/pdf/markdown.js';

installFileMaterializationBoundary(server);
installBusinessGoldBoundary(server);

// Store messages to defer until after initialization
const deferredMessages: Array<{ level: string, message: string }> = [];
function deferLog(level: string, message: string) {
  deferredMessages.push({ level, message });
}

async function runServer() {
  try {
    // Check if first argument is "setup"
    if (process.argv[2] === 'setup') {
      await runSetup();
      return;
    }

    // Check if first argument is "remove"
    if (process.argv[2] === 'remove') {
      await runUninstall();
      return;
    }

    // Check if first argument is "remote"
    if (process.argv[2] === 'remote') {
      await runRemote();
      return;
    }

    // Parse command line arguments for onboarding control
    const DISABLE_ONBOARDING = process.argv.includes('--no-onboarding');
    if (DISABLE_ONBOARDING) {
      logToStderr('info', 'Onboarding disabled via --no-onboarding flag');
    }

    // Set global flag for onboarding control
    (global as any).disableOnboarding = DISABLE_ONBOARDING;

    // Create transport FIRST so all logging gets properly buffered
    // This must happen before any code that might use logger.*
    const transport = new FilteredStdioServerTransport();

    // Export transport for use throughout the application
    global.mcpTransport = transport;

    try {
      deferLog('info', 'Loading configuration...');
      await configManager.loadConfig();
      deferLog('info', 'Configuration loaded successfully');

      // Initialize feature flags (non-blocking)
      deferLog('info', 'Initializing feature flags...');
      await featureFlagManager.initialize();
    } catch (configError) {
      deferLog('error', `Failed to load configuration: ${configError instanceof Error ? configError.message : String(configError)}`);
      if (configError instanceof Error && configError.stack) {
        deferLog('debug', `Stack trace: ${configError.stack}`);
      }
      deferLog('warning', 'Continuing with in-memory configuration only');
      // Continue anyway - we'll use an in-memory config
    }

    // Handle uncaught exceptions
    process.on('uncaughtException', async (error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // If this is a JSON parsing error, log it to stderr but don't crash
      if (errorMessage.includes('JSON') && errorMessage.includes('Unexpected token')) {
        logger.error(`JSON parsing error: ${errorMessage}`);
        return; // Don't exit on JSON parsing errors
      }

      capture('run_server_uncaught_exception', {
        error: errorMessage
      });

      logger.error(`Uncaught exception: ${errorMessage}`);
      process.exit(1);
    });

    // Handle unhandled rejections
    process.on('unhandledRejection', async (reason) => {
      const errorMessage = reason instanceof Error ? reason.message : String(reason);

      // If this is a JSON parsing error, log it to stderr but don't crash
      if (errorMessage.includes('JSON') && errorMessage.includes('Unexpected token')) {
        logger.error(`JSON parsing rejection: ${errorMessage}`);
        return; // Don't exit on JSON parsing errors
      }

      capture('run_server_unhandled_rejection', {
        error: errorMessage
      });

      logger.error(`Unhandled rejection: ${errorMessage}`);
      process.exit(1);
    });

    capture('run_server_start');

    deferLog('info', 'Connecting server...');

    // Add handler for oninitialized to configure notifications based on client capabilities
    server.oninitialized = async () => {
      try {
        transport.enableNotifications();
        await flushDeferredMessages();
        for (const msg of deferredMessages) {
          if (msg.level === 'error') logger.error(msg.message);
          else if (msg.level === 'warning') logger.warn(msg.message);
          else logger.info(msg.message);
        }
        deferredMessages.length = 0;
        await ensureChromeAvailable();
      } catch (error) {
        logger.error(`Post-initialization error: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    // Connect the server to the stdio transport
    await server.connect(transport);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`FATAL ERROR: ${errorMessage}`);
    if (error instanceof Error && error.stack) {
      logger.debug(error.stack);
    }

    // Send a structured error notification
    const errorNotification = {
      jsonrpc: "2.0" as const,
      method: "notifications/message",
      params: {
        level: "error",
        logger: "desktop-commander",
        data: `Failed to start server: ${errorMessage} (${new Date().toISOString()})`
      }
    };
    process.stdout.write(JSON.stringify(errorNotification) + '\n');

    capture('run_server_failed_start_error', {
      error: errorMessage
    });
    process.exit(1);
  }
}

runServer().catch(async (error) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(`RUNTIME ERROR: ${errorMessage}`);
  console.error(error instanceof Error && error.stack ? error.stack : 'No stack trace available');
  process.stderr.write(JSON.stringify({
    type: 'error',
    timestamp: new Date().toISOString(),
    message: `Fatal error running server: ${errorMessage}`
  }) + '\n');

  capture('run_server_fatal_error', {
    error: errorMessage
  });
  process.exit(1);
});
