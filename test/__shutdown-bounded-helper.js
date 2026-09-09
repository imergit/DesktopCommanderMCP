#!/usr/bin/env node
import { scheduleLocalShutdown } from '../dist/imermcp-local/rdc-compat.js';

setTimeout(() => {}, 8000);
scheduleLocalShutdown(async () => {});
