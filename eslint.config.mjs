import js from '@eslint/js';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import requireGhPaginate from './eslint-rules/require-gh-paginate.mjs';
import noUnderscorePassthroughWrapper from './eslint-rules/no-underscore-passthrough-wrapper.mjs';
import noLeakedTimers from './eslint-rules/no-leaked-timers.mjs';

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

export default [
  js.configs.recommended,
  prettierConfig,
  {
    plugins: {
      prettier,
      'gh-paginate': ghPaginatePlugin,
      'no-underscore-wrapper': noUnderscoreWrapperPlugin,
      timers: timerPlugin,
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

        // Custom globals
        use: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
      },
    },
    files: ['src/**/*.{js,mjs,cjs}'],
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error'],
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
      'gh-paginate/require-gh-paginate': 'warn',
      // Disallow thin wrapper functions that only pass arguments through to an underscore-prefixed import
      // These wrappers add no value — call the underscore function directly at the call site
      'no-underscore-wrapper/no-underscore-passthrough-wrapper': 'error',
      // Require capturing setTimeout/setInterval return values so timers can be cleared.
      // Floating timers keep the Node.js event loop alive and cause hangs (issue #1346).
      'timers/no-leaked-timers': 'error',
      // Enforce max 1500 lines per file to match CI workflow check
      // This ensures ESLint and check-file-line-limits job are synchronized
      // See: docs/case-studies/issue-1141 for context
      'max-lines': [
        'error',
        {
          max: 1500,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
    },
  },
];
