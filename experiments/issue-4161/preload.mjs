// Run the real solve entry point without downloading use-m or contacting a provider.
import { isBuiltin } from 'node:module';

globalThis.use = async specifier => {
  if (isBuiltin(specifier)) return import(specifier);
  if (specifier.startsWith('command-stream@') || specifier.startsWith('zx@')) return import('command-stream');
  if (specifier.startsWith('getenv@')) return (name, fallback) => process.env[name] ?? fallback;
  if (specifier.startsWith('links-notation@')) {
    return {
      Parser: class {
        parse() {
          return [];
        }
      },
    };
  }
  throw new Error(`Unexpected use-m dependency: ${specifier}`);
};

globalThis.fetch = async url => {
  throw new Error(`Unexpected network request: ${url}`);
};
