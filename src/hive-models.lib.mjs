#!/usr/bin/env node

/**
 * Shared runner for the `hive-models` bin command (issue #2202, R5).
 *
 * R5 asks for a listing that merges what this installation ships with what the
 * providers are serving right now, "from fully supported, to hot loaded", per
 * tool. This module is the CLI half of that; `telegram-models-command.lib.mjs`
 * is the `/models` half, and both render through
 * `model-catalogue-render.lib.mjs` so the two can never disagree.
 *
 * R6 is honoured here too: before printing a catalogue the runner gives the
 * agentic CLIs a chance to update, because a stale `codex` binary is exactly
 * what makes a new model look unavailable.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2202
 */

import { ensureAgenticCliFreshness, describeFreshnessResult } from './agentic-cli-freshness.lib.mjs';
import { parseCliArgumentsWithLino } from './cli-arguments.lib.mjs';
import { MODEL_CATALOGUE_TOOLS, getMergedModelCatalogue } from './model-catalogue.lib.mjs';
import { formatModelCatalogueText } from './model-catalogue-render.lib.mjs';

export const HIVE_MODELS_HELP = `Usage: hive-models [--tool <name>...] [--refresh] [--details] [--json] [--no-update] [--verbose]

List the models Hive Mind can drive, merged from every source that can be read
without spending a token — the router's live catalogue, the provider listing
endpoints, the codex CLI's own catalogue, models.dev metadata, and the models
bundled with this installation.

Models are grouped so it is obvious what each one is:
  Bundled and live   shipped here and confirmed reachable now
  Hot loaded         a live source has it, this installation does not ship it
  Bundled only       shipped here, no live source confirmed it

Options:
  -t, --tool <name>    Restrict to one tool (${MODEL_CATALOGUE_TOOLS.join(', ')}).
                       Repeatable; defaults to every tool.
      --refresh        Ignore the cached answer and re-read every live source
      --details        Show context window, pricing, and which source had it
      --json           Print machine-readable JSON instead of text
      --no-update      Do not check the agentic CLIs for a newer version first
                       (also spelled --no-tool-update, as in /solve and /task)
  -v, --verbose        Print diagnostics to stderr
  -h, --help           Show this help and exit

Environment:
  HIVE_MIND_MODELS_HOT_LOAD=0            Only list the bundled catalogue
  HIVE_MIND_MODELS_ROUTER=0              Skip the router source specifically
  HIVE_MIND_MODEL_CATALOGUE_TTL_MINUTES  Raise the 60 minute cache lifetime
  HIVE_MIND_AGENTIC_CLI_AUTO_UPDATE=0    Never update the CLIs

Examples:
  hive-models                      # every tool, cached answers
  hive-models --tool codex         # just codex
  hive-models --tool claude --details --refresh
  hive-models --json | jq '.tools.claude.liveOnly'

Reference:
  https://github.com/link-assistant/hive-mind/issues/2202
`;

const VALUE_FLAGS = new Set(['--tool', '-t']);
const BOOLEAN_FLAGS = new Set(['--refresh', '--details', '--json', '--no-update', '--no-tool-update', '--verbose', '-v', '--help', '-h']);

// `/solve`, `/hive` and `/task` spell the opt-out `--no-tool-update` (it lives in
// their `tool-*` namespace). Accept that spelling here too, so the flag an
// operator already knows works everywhere it makes sense (issue #2202, R6).
const normaliseUpdateFlag = arg => (arg === '--no-tool-update' ? '--no-update' : arg);

const createHiveModelsYargsConfig = yargsInstance => yargsInstance.usage('Usage: hive-models [--tool <name>...] [--refresh] [--details] [--json] [--no-update] [--verbose]').option('tool', { type: 'array', alias: 't', default: [] }).option('refresh', { type: 'boolean', default: false }).option('details', { type: 'boolean', default: false }).option('json', { type: 'boolean', default: false }).option('update', { type: 'boolean', default: true }).option('verbose', { type: 'boolean', alias: 'v', default: false }).option('help', { type: 'boolean', alias: 'h', default: false }).help(false).version(false).strict(false);

/**
 * Parse argv for `hive-models`. Returns `error` as a string rather than
 * throwing, so the bin can print it and exit non-zero.
 */
export const parseHiveModelsArgs = argv => {
  const result = { tools: [], refresh: false, details: false, json: false, update: true, verbose: false, help: false, error: null };
  const help = argv.includes('--help') || argv.includes('-h');

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [name] = arg.split('=');
    if (VALUE_FLAGS.has(name)) {
      if (!arg.includes('=')) index += 1;
      continue;
    }
    if (!BOOLEAN_FLAGS.has(arg)) {
      result.error = `Unknown option: ${arg}`;
      return result;
    }
  }

  let parsed;
  try {
    parsed = parseCliArgumentsWithLino({
      argv: argv.filter(arg => arg !== '--help' && arg !== '-h').map(normaliseUpdateFlag),
      commandName: 'hive-models',
      createYargsConfig: createHiveModelsYargsConfig,
      lenv: { enabled: false },
      getenv: { enabled: false },
    });
  } catch (err) {
    result.error = err.message || String(err);
    return result;
  }

  result.help = help;
  result.refresh = parsed.refresh === true;
  result.details = parsed.details === true;
  result.json = parsed.json === true;
  result.update = parsed.update !== false;
  result.verbose = parsed.verbose === true || parsed.v === true;

  const requested = []
    .concat(parsed.tool ?? [])
    .flatMap(entry =>
      String(entry)
        .split(',')
        .map(part => part.trim().toLowerCase())
    )
    .filter(Boolean);
  for (const tool of requested) {
    if (!MODEL_CATALOGUE_TOOLS.includes(tool)) {
      result.error = `Unknown tool: ${tool}. Known tools: ${MODEL_CATALOGUE_TOOLS.join(', ')}`;
      return result;
    }
    if (!result.tools.includes(tool)) result.tools.push(tool);
  }
  if (result.tools.length === 0) result.tools = [...MODEL_CATALOGUE_TOOLS];
  return result;
};

/**
 * Top-level orchestrator used by the bin. `deps` is injected so tests can run
 * the whole command without a network, a router, or a package registry.
 */
export const runHiveModels = async (argv, deps = {}) => {
  const { env = process.env, log = (...args) => console.log(...args), error = (...args) => console.error(...args), loadCatalogue = getMergedModelCatalogue, freshness = ensureAgenticCliFreshness } = deps;

  const args = parseHiveModelsArgs(argv);
  if (args.help) {
    log(HIVE_MODELS_HELP);
    return 0;
  }
  if (args.error) {
    error(args.error);
    return 1;
  }

  const debug = args.verbose ? (...parts) => error('[hive-models]', ...parts) : () => {};

  // R6: refresh the CLIs before answering, so the list describes the binaries
  // the next run will actually use. Best-effort — never fatal.
  const refreshed = await freshness({ tools: args.tools, env, verbose: args.verbose, enabled: args.update, log: async message => debug(message) });
  debug(`cli freshness: ${refreshed.status}${refreshed.reason ? ` (${refreshed.reason})` : ''}`);
  const freshnessLine = describeFreshnessResult(refreshed);

  const results = {};
  let failures = 0;
  for (const tool of args.tools) {
    try {
      results[tool] = await loadCatalogue({ tool, env, refresh: args.refresh, log: async message => debug(message) });
    } catch (err) {
      failures += 1;
      error(`Could not build the ${tool} catalogue: ${err?.message ?? err}`);
    }
  }

  if (args.json) {
    log(JSON.stringify({ generatedAt: new Date().toISOString(), cliUpdate: refreshed, tools: results }, null, 2));
    return failures > 0 && Object.keys(results).length === 0 ? 1 : 0;
  }

  if (freshnessLine) log(freshnessLine);
  const sections = Object.values(results).map(merged => formatModelCatalogueText(merged, { details: args.details, defaultModel: merged.default }));
  log(sections.join('\n\n'));
  return failures > 0 && sections.length === 0 ? 1 : 0;
};

export default { HIVE_MODELS_HELP, parseHiveModelsArgs, runHiveModels };
