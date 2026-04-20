#!/usr/bin/env node

/**
 * `hive-screens` — list, enter, or close detached GNU screen sessions
 * produced by `solve` / `hive` runs that have completed a mergeable PR.
 *
 * Replaces the embedded `hive-screens.sh` script that previously lived
 * in README.md. The matching predicate is shared across `--list`,
 * `--enter`, and `--close`, so any session visible under `--list` is
 * guaranteed to be actionable by the other two flags.
 *
 * See issue #1649.
 */

import { runHiveScreens } from './hive-screens.lib.mjs';

const exitCode = await runHiveScreens(process.argv.slice(2));
process.exit(exitCode);
