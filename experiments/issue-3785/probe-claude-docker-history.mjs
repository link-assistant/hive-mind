#!/usr/bin/env node
// Actual pinned CLI and production mounts; synthetic loopback-only provider.
import os from 'node:os';
import { verifyMountedClaudeHistory } from '../../scripts/verify-mounted-claude-history.mjs';

await verifyMountedClaudeHistory({ nativeBinary: process.argv[2], legacy: process.argv.includes('--expect-legacy-history-gap'), experimental: true, fixtureParent: os.tmpdir() });
