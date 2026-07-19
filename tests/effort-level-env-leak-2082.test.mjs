/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2082.
 *
 * getClaudeEnv() builds the child environment by spreading process.env. For
 * adaptive-thinking-only models it explicitly deleted an inherited
 * MAX_THINKING_TOKENS, but nothing did the same for CLAUDE_CODE_EFFORT_LEVEL.
 * So whenever the effort logic did not compute a value, an effort level
 * exported by the parent shell survived into the child Claude process.
 *
 * That is not a corner case here: hive-mind's own agents run under Claude Code,
 * which exports CLAUDE_CODE_EFFORT_LEVEL. `haiku --think high` therefore
 * inherited effort=max from the parent, for a model that supports no effort
 * levels at all, and `--think off` inherited an effort level despite thinking
 * being off.
 *
 * It also made the suite lie in both directions. CI runs without the variable,
 * so CI stayed green; a developer running the same tests inside Claude Code saw
 * tests/test-opus-47-model-support.mjs fail with 5 errors. Same commit, opposite
 * verdicts, decided by an ambient shell variable.
 *
 * These tests pin the invariant: the emitted effort level is a function of the
 * model and think level, never of the ambient environment.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2082
 */

import assert from 'node:assert/strict';

const { getClaudeEnv } = await import('../src/config.lib.mjs');

/** Run fn with CLAUDE_CODE_EFFORT_LEVEL forced to `value`, then restore. */
const withInheritedEffort = (value, fn) => {
  const had = Object.hasOwn(process.env, 'CLAUDE_CODE_EFFORT_LEVEL');
  const previous = process.env.CLAUDE_CODE_EFFORT_LEVEL;
  process.env.CLAUDE_CODE_EFFORT_LEVEL = value;
  try {
    return fn();
  } finally {
    if (had) process.env.CLAUDE_CODE_EFFORT_LEVEL = previous;
    else delete process.env.CLAUDE_CODE_EFFORT_LEVEL;
  }
};

// --- The leak -------------------------------------------------------------

{
  // haiku supports no effort levels, so no effort level may reach the child.
  const env = withInheritedEffort('max', () => getClaudeEnv({ model: 'haiku', thinkLevel: 'high' }));
  assert.equal(env.CLAUDE_CODE_EFFORT_LEVEL, undefined, 'a model with no effort-level support must not inherit one from the parent shell');
}

{
  // --think off on a non-adaptive model means no effort level, not the parent's.
  const env = withInheritedEffort('max', () => getClaudeEnv({ model: 'opus-4-6', thinkLevel: 'off' }));
  assert.equal(env.CLAUDE_CODE_EFFORT_LEVEL, undefined, '--think off must not inherit an effort level from the parent shell');
}

// --- The behaviour that must survive the sanitisation ---------------------

{
  // Issue #2032: adaptive-only models still get the lowest effort for --think off.
  for (const inherited of ['max', undefined]) {
    const run = () => getClaudeEnv({ model: 'opus', thinkLevel: 'off' });
    const env = inherited === undefined ? run() : withInheritedEffort(inherited, run);
    assert.equal(env.CLAUDE_CODE_EFFORT_LEVEL, 'low', 'an adaptive-only model keeps its lowest-effort mapping for --think off');
  }
}

{
  // A computed level still wins, and is not disturbed by a different inherited one.
  const env = withInheritedEffort('low', () => getClaudeEnv({ model: 'opus-4-6', thinkLevel: 'high' }));
  assert.equal(env.CLAUDE_CODE_EFFORT_LEVEL, 'high', 'an explicitly computed effort level overrides the inherited value');
}

// --- The general invariant ------------------------------------------------

{
  // Whatever the parent exports, the result depends only on the options.
  const cases = [
    { model: 'opus', thinkLevel: 'max' },
    { model: 'opus-4-5', thinkLevel: 'max' },
    { model: 'sonnet-4-6', thinkLevel: 'medium' },
    { model: 'haiku', thinkLevel: 'off' },
  ];

  for (const options of cases) {
    const clean = withInheritedEffort(undefined, () => {
      delete process.env.CLAUDE_CODE_EFFORT_LEVEL;
      return getClaudeEnv(options);
    });
    for (const polluted of ['low', 'high', 'max']) {
      const dirty = withInheritedEffort(polluted, () => getClaudeEnv(options));
      assert.equal(dirty.CLAUDE_CODE_EFFORT_LEVEL, clean.CLAUDE_CODE_EFFORT_LEVEL, `${options.model} + --think ${options.thinkLevel} resolves identically whether or not the parent exports CLAUDE_CODE_EFFORT_LEVEL=${polluted}`);
    }
  }
}

console.log('effort-level-env-leak-2082.test.mjs: all assertions passed');
