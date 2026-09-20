/**
 * Shared CLI-argument override merging (issue #2085).
 *
 * The Telegram bot lets operators configure "override" options that are always
 * applied to a command regardless of what the requester typed — e.g.
 * `TELEGRAM_SOLVE_OVERRIDES="(\n  --attach-logs\n  --auto-continue\n)"`. These
 * overrides encode the operator's defaults for `/solve`.
 *
 * `mergeArgsWithOverrides` used to live inside `telegram-bot.mjs`, where only
 * the `/solve` and `/hive` handlers could reach it. `/fix` hands its generated
 * issue off to `/solve`, so it must apply the very same solve overrides —
 * otherwise the solve started by `/fix` silently runs without the operator's
 * defaults (issue #2085: "`--attach-logs` were not applied"). Extracting the
 * helper here lets `telegram-fix-command.lib.mjs` reuse the exact same merge
 * semantics without importing the bot entry point (which would be circular).
 */

/**
 * Merge operator override options into a user-supplied argument list.
 *
 * Override flags win: any user flag that also appears in `overrides` (together
 * with its value, if any) is dropped, then every override is appended. Boolean
 * flags and `--flag value` pairs are both handled. The relative order of the
 * surviving user args (including positionals like the issue/repository URL) is
 * preserved, and the overrides are appended at the end so they take precedence
 * in last-wins CLI parsers.
 *
 * @param {string[]} userArgs - Arguments the requester supplied.
 * @param {string[]} overrides - Operator override options (already tokenized).
 * @returns {string[]} The merged argument list.
 */
export function mergeArgsWithOverrides(userArgs, overrides) {
  if (!overrides || overrides.length === 0) {
    return Array.isArray(userArgs) ? userArgs : [];
  }
  const safeUserArgs = Array.isArray(userArgs) ? userArgs : [];

  // Parse overrides to identify flags and their values
  const overrideFlags = new Map(); // Map of flag -> value (or null for boolean flags)

  for (let i = 0; i < overrides.length; i++) {
    const arg = overrides[i];
    if (arg.startsWith('--')) {
      // Check if next item is a value (doesn't start with --)
      if (i + 1 < overrides.length && !overrides[i + 1].startsWith('--')) {
        overrideFlags.set(arg, overrides[i + 1]);
        i++; // Skip the value in next iteration
      } else {
        overrideFlags.set(arg, null); // Boolean flag
      }
    }
  }

  // Filter user args to remove any that conflict with overrides
  const filteredArgs = [];
  for (let i = 0; i < safeUserArgs.length; i++) {
    const arg = safeUserArgs[i];
    if (arg.startsWith('--')) {
      // If this flag exists in overrides, skip it and its value
      if (overrideFlags.has(arg)) {
        // Skip the flag
        // Also skip next arg if it's a value (doesn't start with --)
        if (i + 1 < safeUserArgs.length && !safeUserArgs[i + 1].startsWith('--')) {
          i++; // Skip the value too
        }
        continue;
      }
    }
    filteredArgs.push(arg);
  }

  // Merge: filtered user args + overrides
  return [...filteredArgs, ...overrides];
}
