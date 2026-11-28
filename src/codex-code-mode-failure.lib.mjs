export const codexCodeModeHostFailure = 'Codex Code Mode host is unavailable. Repair the pinned Codex runtime before retrying.';

// Codex emits this fail-closed diagnostic as an item error even when the
// language model finishes its turn. Ordinary tool errors can recover in turn.
export const isCodexCodeModeHostError = message => /^Code Mode is unavailable because .+\. Code mode will fail closed; enable `features\.code_mode_host` and install `codex-code-mode-host`\.$/u.test(message);
