#!/usr/bin/env node
// Issue #3001: the sibling probes in isolation-runner.lib.mjs assume command-stream
// throws on a non-zero exit. Check what they actually return for a missing
// image / unknown tmux session / missing container.
import { checkDockerImagePresent, checkTmuxSessionRunning, checkDockerStorageDriver } from '../../src/isolation-runner.lib.mjs';

console.log('checkDockerImagePresent(missing):', await checkDockerImagePresent('konard/does-not-exist-3001:none'));
console.log('checkTmuxSessionRunning(missing):', await checkTmuxSessionRunning('no-such-session-3001'));
console.log('checkDockerStorageDriver():', await checkDockerStorageDriver());
