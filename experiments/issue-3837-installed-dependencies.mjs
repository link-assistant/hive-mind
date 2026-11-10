// Offline prompt checks use the lockfile's installed packages and built-ins.
// use-m normally resolves version-suffixed names through its remote loader.
globalThis.use ??= specifier => import(specifier.replace(/@\d[^/]*$/, ''));
