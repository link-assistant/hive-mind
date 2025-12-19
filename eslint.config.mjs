import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
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

        // Custom globals
        use: 'readonly',
        fetch: 'readonly',
        URL: 'readonly'
      }
    },
    files: ['src/**/*.{js,mjs,cjs}'],
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error'],
      'no-console': 'off',
      'semi': ['error', 'always'],
      'quotes': ['error', 'single', { avoidEscape: true }],
      'no-useless-escape': 'warn',
      'no-case-declarations': 'warn',
      'no-empty': 'error',
      'camelcase': ['error', {
        properties: 'never',
        ignoreDestructuring: true,
        ignoreImports: false,
        ignoreGlobals: false,
        allow: ['^[A-Z_]+$']
      }]
    }
  }
];