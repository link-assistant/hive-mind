import js from '@eslint/js';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import requireGhPaginate from './eslint-rules/require-gh-paginate.mjs';
import noUnderscorePassthroughWrapper from './eslint-rules/no-underscore-passthrough-wrapper.mjs';
import noLeakedTimers from './eslint-rules/no-leaked-timers.mjs';
import noLeakedStreams from './eslint-rules/no-leaked-streams.mjs';
import noDirectGhExec from './eslint-rules/no-direct-gh-exec.mjs';
import noUnretriedGitNetwork from './eslint-rules/no-unretried-git-network.mjs';
import requireSanitizedOutput from './eslint-rules/require-sanitized-output.mjs';
import noUnsafeTelegramSend from './eslint-rules/no-unsafe-telegram-send.mjs';
import noUnescapedTelegramMarkdown from './eslint-rules/no-unescaped-telegram-markdown.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import promisePlugin from 'eslint-plugin-promise';
import noSyncInBotProcess from './eslint-rules/no-sync-in-bot-process.mjs';
import requireExecTimeout from './eslint-rules/require-exec-timeout.mjs';
import noSlowAwaitInTelegramHandler from './eslint-rules/no-slow-await-in-telegram-handler.mjs';
import { computeImportClosure } from './eslint-rules/bot-import-closure.mjs';

// Create custom plugin for gh paginate rule
const ghPaginatePlugin = {
  rules: {
    'require-gh-paginate': requireGhPaginate,
  },
};

// Create custom plugin for underscore passthrough wrapper rule
const noUnderscoreWrapperPlugin = {
  rules: {
    'no-underscore-passthrough-wrapper': noUnderscorePassthroughWrapper,
  },
};

// Create custom plugin to prevent leaked timer handles (issue #1346)
const timerPlugin = {
  rules: {
    'no-leaked-timers': noLeakedTimers,
  },
};

// Create custom plugin to prevent leaked stream handles (issue #1431)
const streamsPlugin = {
  rules: {
    'no-leaked-streams': noLeakedStreams,
  },
};

// Create custom plugin to keep every formatted Telegram send inside the safe
// send funnel, so a malformed entity can never become a silent 400 (issue #2166)
const telegramSafetyPlugin = {
  rules: {
    'no-unsafe-telegram-send': noUnsafeTelegramSend,
    // Issue #3505: dynamic text in a legacy-Markdown message must be escaped.
    'no-unescaped-telegram-markdown': noUnescapedTelegramMarkdown,
  },
};

// Create custom plugin to prevent rate-limit-unsafe gh exec calls (issue #1726)
const ghRateLimitPlugin = {
  rules: {
    'no-direct-gh-exec': noDirectGhExec,
    // Issue #2168: the git half of the same requirement.
    'no-unretried-git-network': noUnretriedGitNetwork,
  },
};

const outputSanitizationPlugin = {
  rules: {
    'require-sanitized-output': requireSanitizedOutput,
  },
};

// Issue #3206: rules that keep the long-lived Telegram bot process responsive.
// One slow handler or one synchronous call stalls every chat, so:
// - hive/no-sync-in-bot-process: no `*Sync` calls in any module the bot loads;
// - hive/no-slow-await-in-telegram-handler: handlers hand slow work to
//   detachHandler/runInBackground instead of awaiting it;
// - hive/require-exec-timeout: docker/git/gh child processes get a timeout.
const hivePlugin = {
  rules: {
    'no-sync-in-bot-process': noSyncInBotProcess,
    'require-exec-timeout': requireExecTimeout,
    'no-slow-await-in-telegram-handler': noSlowAwaitInTelegramHandler,
  },
};

const readBaseline = name => JSON.parse(readFileSync(new URL(`./eslint-rules/baselines/${name}.json`, import.meta.url), 'utf8'));

// Every module reachable from the bot entry point through relative imports.
// Computed on each lint run, so a module the bot starts importing is covered
// without editing a list.
const botProcessFiles = computeImportClosure(fileURLToPath(new URL('./src/telegram-bot.mjs', import.meta.url)), {
  rootDir: fileURLToPath(new URL('.', import.meta.url)),
});

export default [
  js.configs.recommended,
  prettierConfig,
  {
    plugins: {
      prettier,
      'gh-paginate': ghPaginatePlugin,
      'no-underscore-wrapper': noUnderscoreWrapperPlugin,
      timers: timerPlugin,
      streams: streamsPlugin,
      'gh-rate-limit': ghRateLimitPlugin,
      'output-sanitization': outputSanitizationPlugin,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // Node.js globals
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        exports: 'writable',
        module: 'writable',
        require: 'readonly',
        global: 'readonly',
        globalThis: 'readonly',

        // Timer functions
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        clearTimeout: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',

        // Web API globals available in Node.js 18+
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        structuredClone: 'readonly',

        // Custom globals
        use: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
      },
    },
    files: ['src/**/*.{js,mjs,cjs}', 'scripts/**/*.{js,mjs,cjs}', 'eslint-rules/**/*.{js,mjs,cjs}', 'tests/**/*.{js,mjs,cjs}'],
    rules: {
      'no-undef': 'error',
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'no-console': 'off',
      'no-useless-escape': 'warn',
      'no-case-declarations': 'warn',
      'no-empty': 'error',
      camelcase: [
        'error',
        {
          properties: 'never',
          ignoreDestructuring: true,
          ignoreImports: false,
          ignoreGlobals: false,
          allow: ['^[A-Z_]+$'],
        },
      ],
      'prettier/prettier': 'warn',
      // Require --paginate on gh api calls that return lists
      // This prevents missing data when GitHub API returns more than 30 results
      'gh-paginate/require-gh-paginate': 'error',
      // Disallow thin wrapper functions that only pass arguments through to an underscore-prefixed import
      // These wrappers add no value — call the underscore function directly at the call site
      'no-underscore-wrapper/no-underscore-passthrough-wrapper': 'error',
      // Require capturing setTimeout/setInterval return values so timers can be cleared.
      // Floating timers keep the Node.js event loop alive and cause hangs (issue #1346).
      'timers/no-leaked-timers': 'error',
      // Require capturing createReadStream/createWriteStream return values so streams can be closed.
      // Unclosed streams keep the Node.js event loop alive and cause hangs (issue #1431).
      'streams/no-leaked-streams': 'error',
      // Disallow `gh` API calls (exec/execFile/spawn/runner/$, shell-string or argv
      // style) that do not run under the shared retry loop (issue #1726). Since
      // issue #3552 this is decided per call site, not per file: the executor must
      // be built by a wrap factory (wrapDollarWithGhRetry, wrapRunnerWith*Retry),
      // handed in by the caller, or the call must sit inside a retry helper
      // (retryGitHubOperation, ghWithRateLimitRetry, execGhWithRetry, ...).
      // A deliberate single shot needs `// github-retry-ok: <reason>`.
      'gh-rate-limit/no-direct-gh-exec': 'error',
      'output-sanitization/require-sanitized-output': 'error',
      // Enforce max 1500 lines per file to match CI workflow check.
      // Counts blank lines and comments (skipBlankLines/skipComments=false) so
      // this rule and scripts/check-file-line-limits.sh (raw `wc -l`) agree —
      // otherwise ESLint passes locally while CI fails (issue #1730).
      // See: docs/case-studies/issue-1141, docs/case-studies/issue-1730.
      'max-lines': [
        'error',
        {
          max: 1500,
          skipBlankLines: false,
          skipComments: false,
        },
      ],
    },
  },
  {
    // Issue #2166: production code must never talk to the Bot API with a
    // `parse_mode` directly — a malformed entity would surface as an unhandled
    // 400 and the user would see nothing. Tests and scripts are free to build
    // raw payloads (they assert on them), so the rule is scoped to src/.
    files: ['src/**/*.{js,mjs,cjs}'],
    plugins: {
      'telegram-safety': telegramSafetyPlugin,
    },
    rules: {
      'telegram-safety/no-unsafe-telegram-send': 'error',
      // Issue #3505: a raw `in_progress`, branch, URL or error message in a
      // Markdown message opens an entity that never closes, and Telegram rejects
      // the whole message. Escape it (`escapeMarkdown`), put it in a code span,
      // or mark a known-safe line `// telegram-markdown-ok: <reason>`.
      'telegram-safety/no-unescaped-telegram-markdown': 'error',
    },
  },
  {
    // Issue #2168: network-facing git commands (`git push`/`fetch`/`pull`/
    // `ls-remote`) must run under the shared retry loop, otherwise a single
    // transient remote failure aborts the whole session. Helpers that receive
    // `$` from their caller are exempt - the caller owns the wrapper.
    // Issue #3552: scripts/ is covered too - the release script's single-shot
    // `git push` is exactly what GitHub's `fatal error in commit_refs` killed.
    // Tests drive local fixture repositories and stay out of scope.
    files: ['src/**/*.{js,mjs,cjs}', 'scripts/**/*.{js,mjs,cjs}'],
    plugins: {
      'gh-rate-limit': ghRateLimitPlugin,
    },
    rules: {
      'gh-rate-limit/no-unretried-git-network': 'error',
    },
  },
  {
    // Issue #3206: modules loaded by the bot process share its one event loop.
    // The per-file baseline lists sync calls that existed before the rule; a
    // file may not add more, and converting one means lowering its count.
    // Each entry gives the reason the file may keep them (issue #3278).
    // One-time startup and exit-handler code is marked `// hive-sync-ok: <reason>`.
    // An un-returned, un-caught promise chain in the bot is an unhandled
    // rejection waiting to happen, so promise/catch-or-return applies too.
    files: botProcessFiles,
    plugins: {
      hive: hivePlugin,
      promise: promisePlugin,
    },
    rules: {
      'hive/no-sync-in-bot-process': ['error', { baseline: readBaseline('no-sync-in-bot-process') }],
      'promise/catch-or-return': ['error', { allowFinally: true }],
    },
  },
  {
    // Issue #3206: a hung docker/git/gh process never ends by itself, wherever
    // it is started from. The baseline lists calls that predate the rule,
    // each file with its reason; command-stream `$` calls count too (#3278).
    files: ['src/**/*.{js,mjs,cjs}'],
    plugins: {
      hive: hivePlugin,
    },
    rules: {
      'hive/require-exec-timeout': ['error', { baseline: readBaseline('require-exec-timeout') }],
      'hive/no-slow-await-in-telegram-handler': 'error',
    },
  },
  {
    // Issue #3206: sequential awaits in a loop are often a hidden N x latency.
    // Most hits elsewhere are deliberate (ordered git operations, retries), so
    // the warning is limited to the bot's own telegram-*/bot-* modules, where
    // that latency is felt by users waiting for a reply. A loop that must stay
    // sequential (polling, retries, ordered sends) says why in its
    // `eslint-disable` comment; `npm run lint` fails on any warning.
    files: ['src/telegram-*.{js,mjs,cjs}', 'src/bot-*.{js,mjs,cjs}'],
    rules: {
      'no-await-in-loop': 'warn',
    },
  },
];
