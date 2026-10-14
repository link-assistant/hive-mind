/**
 * Universal, definition-driven CLI option forwarding (issue #3190).
 *
 * Every place that launches a child `solve` process must carry the user's
 * options through. Hand-written allowlists ("forward --model, --verbose and
 * --fork") silently drop every option nobody remembered to add — issue #3190:
 * the auto-resume relaunch lost `--auto-merge` and `--think high`, so the
 * resumed session ran with thinking off and never auto-merged the PR.
 *
 * Two complementary mechanisms live here, both driven by an option-definition
 * map (the same `{ name: { type, alias, default } }` data yargs is configured
 * with), so a newly added option is forwarded without touching any caller:
 *
 *   - `forwardRawCliArgs` — replays the ORIGINAL command-line tokens minus the
 *     options the caller re-sets itself. Used when a process relaunches itself
 *     (solve auto-resume/auto-restart, the printed manual-resume command). Raw
 *     tokens are preferred over re-serializing parsed values because solve's
 *     post-parse normalization depends on which flags were literally present
 *     (explicit --model/--fallback-model/--think, --claude-file vs
 *     --gitkeep-file, --plan, --escalate, ...).
 *   - `buildArgsFromParsedArgv` — serializes PARSED values for a different
 *     command's CLI. Used by hive, whose own argv is a superset of solve's
 *     options (issue #1209).
 *
 * Nothing here touches the network or the filesystem.
 */

export const kebabToCamel = value => value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());

const toAliasList = alias => (Array.isArray(alias) ? alias : alias ? [alias] : []);

/**
 * Map every spelling of every option to its canonical name and type:
 * `--name`, `--camelName`, every alias (`-r`, `--worker-model`, ...) and, for
 * booleans, the `--no-*` negations yargs accepts.
 *
 * @param {Object<string, {type?: string, alias?: string|string[]}>} definitions
 * @returns {Map<string, {name: string, type: string}>}
 */
export const buildOptionTokenIndex = definitions => {
  const index = new Map();
  for (const [name, def] of Object.entries(definitions || {})) {
    const entry = { name, type: def?.type || 'string' };
    for (const spelling of [name, ...toAliasList(def?.alias)]) {
      const camel = kebabToCamel(spelling);
      const prefix = spelling.length === 1 ? '-' : '--';
      index.set(`${prefix}${spelling}`, entry);
      if (spelling.length > 1) {
        index.set(`--${camel}`, entry);
        if (entry.type === 'boolean') {
          index.set(`--no-${spelling}`, entry);
          index.set(`--no${camel.charAt(0).toUpperCase()}${camel.slice(1)}`, entry);
        }
      }
    }
  }
  return index;
};

const looksLikeOption = token => typeof token === 'string' && token.length > 1 && token.startsWith('-') && !/^-\d/.test(token);

/**
 * Split raw CLI tokens into positionals and option groups, following the
 * yargs conventions solve/hive use: `--opt value`, `--opt=value`, booleans
 * optionally followed by a literal `true`/`false`, arrays greedily consuming
 * values, and `--` ending option parsing. Unknown options are kept verbatim
 * (name `null`) without consuming the next token.
 *
 * @param {string[]} rawArgs
 * @param {Object} definitions - Option definitions (see buildOptionTokenIndex)
 * @returns {{ positionals: string[], options: Array<{ name: string|null, tokens: string[] }> }}
 */
export const partitionRawCliArgs = (rawArgs, definitions) => {
  const index = buildOptionTokenIndex(definitions);
  const args = Array.isArray(rawArgs) ? rawArgs.map(String) : [];
  const positionals = [];
  const options = [];

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === '--') {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (!looksLikeOption(token)) {
      positionals.push(token);
      continue;
    }

    const eq = token.indexOf('=');
    const key = eq === -1 ? token : token.slice(0, eq);
    const hasInlineValue = eq !== -1;
    // Short-flag groups such as `-vf`: the last letter decides value consumption.
    const lookupKey = !key.startsWith('--') && key.length > 2 ? `-${key.slice(-1)}` : key;
    const entry = index.get(lookupKey) || null;
    const group = { name: key === lookupKey && entry ? entry.name : null, tokens: [token] };

    if (entry && !hasInlineValue) {
      if (entry.type === 'boolean') {
        if (args[i + 1] === 'true' || args[i + 1] === 'false') group.tokens.push(args[++i]);
      } else if (entry.type === 'array') {
        while (i + 1 < args.length && args[i + 1] !== '--' && !looksLikeOption(args[i + 1])) group.tokens.push(args[++i]);
      } else if (i + 1 < args.length && args[i + 1] !== '--' && !looksLikeOption(args[i + 1])) {
        group.tokens.push(args[++i]);
      }
    }
    options.push(group);
  }

  return { positionals, options };
};

/**
 * Return the original option tokens (positionals dropped) minus every option
 * whose canonical name is in `exclude` — in any spelling (alias, camelCase,
 * `--no-*`, `--opt=value`) and together with its value.
 *
 * @param {Object} params
 * @param {string[]} params.rawArgs - Original CLI tokens (without node/script)
 * @param {Object} params.definitions - Option definitions
 * @param {Iterable<string>} [params.exclude] - Canonical option names the caller sets itself
 * @returns {string[]}
 */
export const forwardRawCliArgs = ({ rawArgs, definitions, exclude = [] }) => {
  const excluded = new Set(exclude);
  const { options } = partitionRawCliArgs(rawArgs, definitions);
  return options.filter(group => !(group.name && excluded.has(group.name))).flatMap(group => group.tokens);
};

/**
 * Serialize parsed option values back into CLI tokens for another command
 * (issue #1209: hive forwards every solve option it shares).
 *
 * - booleans whose default is true/undefined are forwarded both ways
 *   (`--flag` / `--no-flag`), default-false booleans only when truthy;
 * - arrays repeat the flag per entry;
 * - strings/numbers are forwarded unless undefined or `false` — some string
 *   options use `default: false` as "disabled" (issue #1718).
 *
 * @param {Object} params
 * @param {Object} params.argv - Parsed argv (camelCase keys)
 * @param {Object} params.definitions - Option definitions of the TARGET command
 * @param {Iterable<string>} params.optionNames - Canonical names to consider
 * @param {Iterable<string>} [params.skip] - Names the caller forwards itself
 * @returns {string[]}
 */
export const buildArgsFromParsedArgv = ({ argv, definitions, optionNames, skip = [] }) => {
  const skipped = new Set(skip);
  const args = [];
  for (const optionName of optionNames) {
    if (skipped.has(optionName)) continue;
    const def = definitions[optionName];
    if (!def) continue;
    const value = argv[kebabToCamel(optionName)];
    if (def.type === 'boolean') {
      if (value === undefined) continue;
      if (def.default === true || def.default === undefined) {
        args.push(value ? `--${optionName}` : `--no-${optionName}`);
      } else if (value) {
        args.push(`--${optionName}`);
      }
    } else if (def.type === 'array' && Array.isArray(value) && value.length > 0) {
      for (const entry of value) args.push(`--${optionName}`, String(entry));
    } else if ((def.type === 'string' || def.type === 'number') && value !== undefined && value !== false) {
      args.push(`--${optionName}`, String(value));
    }
  }
  return args;
};
