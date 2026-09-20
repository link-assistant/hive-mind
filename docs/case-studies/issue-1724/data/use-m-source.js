const extractCallerContext = (stack) => {
  // In browser environment, use the current document URL as fallback
  if (typeof window !== 'undefined' && window.location) {
    // For inline scripts in HTML, use the document's URL
    // This will be the fallback if we can't extract from stack
    const documentUrl = window.location.href;
    
    // Try to extract from stack first, but we'll fallback to document URL
    if (!stack) return documentUrl;
  } else if (!stack) {
    return null;
  }

  const lines = stack.split('\n');
  // Look for the first file that isn't use.mjs - skip the first few frames
  // to get past our internal function calls
  for (const line of lines) {
    // Skip the first few frames which are internal to use.mjs
    if (line.includes('extractCallerContext') ||
      line.includes('_use') ||
      line.includes('makeUse') ||
      line.includes('<anonymous>') && line.includes('/use.mjs')) {
      continue;
    }

    // Try to match http(s):// URLs for browser environments
    let match = line.match(/https?:\/\/[^\s)]+/);
    if (match && !match[0].endsWith('/use.mjs') && !match[0].endsWith('/use.js')) {
      // Remove line:column numbers if present
      const url = match[0].replace(/:\d+:\d+$/, '');
      return url;
    }

    // Try to match file:// URLs
    match = line.match(/file:\/\/[^\s)]+/);
    if (match && !match[0].endsWith('/use.mjs')) {
      // Remove line:column numbers if present
      const url = match[0].replace(/:\d+:\d+$/, '');
      return url;
    }

    // Special handling for Jest environment
    // Jest paths often look like: at Object.<anonymous> (/path/to/test.mjs:7:24)
    // Or: at /path/to/test.mjs:7:24
    if (line.includes('.test.') || line.includes('.spec.')) {
      // Try to extract the actual test file path from Jest stack traces
      match = line.match(/\(([^)]+\.(?:test|spec)\.[^)]+):\d+:\d+\)/);
      if (!match) {
        match = line.match(/([^(\s]+\.(?:test|spec)\.[^(\s:]+):\d+:\d+/);
      }
      if (match && match[1]) {
        const testPath = match[1];
        // Convert to file:// URL format if it's an absolute path
        if (testPath.startsWith('/')) {
          return `file://${testPath}`;
        }
      }
    }

    // For Node/Deno, try to match absolute paths (improved to handle more cases)
    match = line.match(/at\s+(?:Object\.<anonymous>\s+)?(?:async\s+)?[(]?(\/[^\s:)]+\.(?:m?js|json))(?::\d+:\d+)?\)?/);
    if (match && !match[1].endsWith('/use.mjs') && !match[1].includes('node_modules')) {
      return 'file://' + match[1];
    }

    // Alternative pattern for Jest and other environments
    match = line.match(/at\s+[^(]*\(([^)]+\.(?:m?js|json)):\d+:\d+\)/);
    if (match && !match[1].endsWith('/use.mjs') && !match[1].includes('node_modules')) {
      return 'file://' + (match[1].startsWith('/') ? match[1] : '/' + match[1]);
    }
  }
  return null;
};

const parseModuleSpecifier = (moduleSpecifier) => {
  if (!moduleSpecifier || typeof moduleSpecifier !== 'string' || moduleSpecifier.length <= 0) {
    throw new Error(
      `Name for a package to be imported is not provided.
Please specify package name and an optional version (e.g., 'lodash', 'lodash@4.17.21' or '@chakra-ui/react@1.0.0').`
    );
  }
  const regex = /^(?<packageName>(@[^@/]+\/)?[^@/]+)?(?:@(?<version>[^/]*))?(?<modulePath>(?:\/[^@]+)*)?$/;
  const match = moduleSpecifier.match(regex);
  if (!match || typeof match.groups.packageName !== 'string' || match.groups.packageName.trim() === '') {
    throw new Error(
      `Failed to parse package identifier '${moduleSpecifier}'.
Please specify a package name, and an optional version (e.g.: 'lodash', 'lodash@4.17.21' or '@chakra-ui/react@1.0.0').`
    );
  }
  let { packageName, version, modulePath } = match.groups;
  if (typeof version !== 'string' || version.trim() === '') {
    version = 'latest';
  }
  if (typeof modulePath !== 'string' || modulePath.trim() === '') {
    modulePath = '';
  }
  return { packageName, version, modulePath };
}

// Built-in modules that we support across all environments
// Always use lowercase names for consistency
const supportedBuiltins = {
  // Universal modules
  'console': {
    browser: () => ({ default: console, log: console.log, error: console.error, warn: console.warn, info: console.info }),
    node: () => import('node:console').then(m => ({ default: m.Console, ...m }))
  },
  'crypto': {
    browser: () => ({ default: crypto, subtle: crypto.subtle }),
    node: () => import('node:crypto').then(m => ({ default: m, ...m }))
  },
  'url': {
    browser: () => ({ default: URL, URL, URLSearchParams }),
    node: () => import('node:url').then(m => ({ default: m, ...m }))
  },
  'performance': {
    browser: () => ({ default: performance, now: performance.now.bind(performance) }),
    node: () => import('node:perf_hooks').then(m => ({ default: m.performance, performance: m.performance, now: m.performance.now.bind(m.performance), ...m }))
  },

  // Node.js/Bun only modules
  'fs': {
    browser: null, // Not available in browser
    node: () => import('node:fs').then(m => ({ default: m, ...m }))
  },
  'fs/promises': {
    browser: null, // Not available in browser
    node: async () => {
      const runtime = typeof Bun !== 'undefined' ? 'Bun' : typeof Deno !== 'undefined' ? 'Deno' : 'Node.js';
      
      // For Bun and Deno, use a different approach since their node:fs/promises may not be fully compatible
      if (runtime === 'Bun' || runtime === 'Deno') {
        console.log(`[${runtime}] Using promisify fallback for fs/promises compatibility`);
        try {
          const fs = await import('node:fs');
          const { promisify } = await import('node:util');
          
          // Create wrapper functions that match native fs/promises signatures
          // These need to have the correct .length property and be async functions
          const createAsyncWrapper = (promisifiedFn, expectedLength) => {
            // Create an async function with the correct length
            const wrapper = {
              1: async (a) => promisifiedFn(a),
              2: async (a, b) => promisifiedFn(a, b),
              3: async (a, b, c) => promisifiedFn(a, b, c),
              4: async (a, b, c, d) => promisifiedFn(a, b, c, d)
            }[expectedLength];
            
            // Copy the name if possible
            try {
              Object.defineProperty(wrapper, 'name', { value: promisifiedFn.name });
            } catch (e) {
              // Ignore if name can't be set
            }
            
            return wrapper || promisifiedFn;
          };
          
          // Helper to safely promisify functions that may not exist
          const safePromisify = (fn, expectedLength) => {
            if (typeof fn !== 'function') {
              return undefined;
            }
            return createAsyncWrapper(promisify(fn), expectedLength);
          };
          
          const promisifiedFs = {
            access: safePromisify(fs.access, 2),
            appendFile: safePromisify(fs.appendFile, 3),
            chmod: safePromisify(fs.chmod, 2),
            chown: safePromisify(fs.chown, 3),
            copyFile: safePromisify(fs.copyFile, 3),
            lchmod: safePromisify(fs.lchmod, 2),
            lchown: safePromisify(fs.lchown, 3),
            link: safePromisify(fs.link, 2),
            lstat: safePromisify(fs.lstat, 2),
            mkdir: safePromisify(fs.mkdir, 2),
            mkdtemp: safePromisify(fs.mkdtemp, 2),
            open: safePromisify(fs.open, 3),
            readdir: safePromisify(fs.readdir, 2),
            readFile: safePromisify(fs.readFile, 2),
            readlink: safePromisify(fs.readlink, 2),
            realpath: safePromisify(fs.realpath, 2),
            rename: safePromisify(fs.rename, 2),
            rmdir: safePromisify(fs.rmdir, 2),
            stat: safePromisify(fs.stat, 2),
            symlink: safePromisify(fs.symlink, 3),
            truncate: safePromisify(fs.truncate, 2),
            unlink: safePromisify(fs.unlink, 1),
            utimes: safePromisify(fs.utimes, 3),
            writeFile: safePromisify(fs.writeFile, 3),
            constants: fs.constants
          };
          
          // Add newer functions if they exist
          if (fs.rm) promisifiedFs.rm = safePromisify(fs.rm, 2);
          if (fs.cp) promisifiedFs.cp = safePromisify(fs.cp, 3);
          if (fs.lutimes) promisifiedFs.lutimes = safePromisify(fs.lutimes, 3);
          if (fs.opendir) promisifiedFs.opendir = safePromisify(fs.opendir, 2);
          if (fs.statfs) promisifiedFs.statfs = safePromisify(fs.statfs, 2);
          if (fs.watch) promisifiedFs.watch = fs.watch.bind(fs); // watch is not callback-based
          
          console.log(`[${runtime}] Fallback mkdir.length:`, promisifiedFs.mkdir?.length);
          console.log(`[${runtime}] Fallback mkdir.constructor.name:`, promisifiedFs.mkdir?.constructor.name);
          return { default: promisifiedFs, ...promisifiedFs };
        } catch (error) {
          throw new Error(`Failed to create fs/promises fallback for ${runtime}: ${error.message}`, { cause: error });
        }
      }
      
      // For Node.js, use the native implementation
      try {
        const m = await import('node:fs/promises');
        return { default: m, ...m };
      } catch (error) {
        throw new Error(`Failed to load fs/promises module: ${error.message}`, { cause: error });
      }
    }
  },
  'dns/promises': {
    browser: null, // Not available in browser
    node: async () => {
      const m = await import('node:dns/promises');
      return { default: m, ...m };
    }
  },
  'stream/promises': {
    browser: null, // Not available in browser
    node: async () => {
      const m = await import('node:stream/promises');
      return { default: m, ...m };
    }
  },
  'readline/promises': {
    browser: null, // Not available in browser
    node: async () => {
      const m = await import('node:readline/promises');
      return { default: m, ...m };
    }
  },
  'timers/promises': {
    browser: null, // Not available in browser
    node: async () => {
      const m = await import('node:timers/promises');
      return { default: m, ...m };
    }
  },
  'path': {
    browser: null, // Not available in browser
    node: () => import('node:path').then(m => ({ default: m, ...m }))
  },
  'os': {
    browser: null, // Not available in browser
    node: () => import('node:os').then(m => ({ default: m, ...m }))
  },
  'util': {
    browser: null, // Not available in browser
    node: () => import('node:util').then(m => ({ default: m, ...m }))
  },
  'events': {
    browser: null, // Not available in browser
    node: () => import('node:events').then(m => ({ default: m.EventEmitter, EventEmitter: m.EventEmitter, ...m }))
  },
  'stream': {
    browser: null, // Not available in browser
    node: () => import('node:stream').then(m => ({ default: m.Stream, Stream: m.Stream, ...m }))
  },
  'buffer': {
    browser: null, // Not available in browser (would need polyfill)
    node: () => import('node:buffer').then(m => ({ default: m, Buffer: m.Buffer, ...m }))
  },
  'process': {
    browser: null, // Not available in browser
    node: () => {
      if (typeof Deno !== 'undefined') {
        // Deno 2.x has a process global, use it if available
        if (typeof process !== 'undefined') {
          // In Deno, process is an EventEmitter and spreading doesn't work properly
          // We need to explicitly copy the properties we need
          const proc = {
            default: process,
            pid: process.pid,
            platform: process.platform,
            version: process.version,
            versions: process.versions,
            argv: process.argv,
            env: process.env,
            exit: process.exit,
            cwd: process.cwd,
            chdir: process.chdir,
            // Add any other commonly used process properties
            nextTick: process.nextTick,
            stdout: process.stdout,
            stderr: process.stderr,
            stdin: process.stdin,
          };
          return proc;
        }
        // This shouldn't happen but provide a fallback
        throw new Error(`Failed to resolve 'process' module in Deno environment.`);
      }
      return ({ default: process, ...process });
    }
  },
  'child_process': {
    browser: null,
    node: () => import('node:child_process').then(m => ({ default: m, ...m }))
  },
  'http': {
    browser: null,
    node: () => import('node:http').then(m => ({ default: m, ...m }))
  },
  'https': {
    browser: null,
    node: () => import('node:https').then(m => ({ default: m, ...m }))
  },
  'net': {
    browser: null,
    node: () => import('node:net').then(m => ({ default: m, ...m }))
  },
  'dns': {
    browser: null,
    node: () => import('node:dns').then(m => ({ default: m, ...m }))
  },
  'zlib': {
    browser: null,
    node: () => import('node:zlib').then(m => ({ default: m, ...m }))
  },
  'querystring': {
    browser: null,
    node: () => import('node:querystring').then(m => ({ default: m, ...m }))
  },
  'assert': {
    browser: null,
    node: () => import('node:assert').then(m => ({ default: m.default || m, ...m }))
  }
};

const resolvers = {
  builtin: async (moduleSpecifier, pathResolver) => {
    const { packageName, modulePath } = parseModuleSpecifier(moduleSpecifier);

    // Handle built-in modules with subpaths like 'node:fs/promises'
    let moduleName;
    if (packageName.startsWith('node:')) {
      // For node: modules, include the path in the module name
      moduleName = packageName.slice(5) + modulePath;
    } else {
      moduleName = packageName + modulePath;
    }

    // Check if we support this built-in module
    if (supportedBuiltins[moduleName]) {
      const builtinConfig = supportedBuiltins[moduleName];

      if (!builtinConfig) {
        throw new Error(`Built-in module '${moduleName}' is not supported.`);
      }

      // Determine environment
      const isBrowser = typeof window !== 'undefined';
      const environment = isBrowser ? 'browser' : 'node';

      const moduleFactory = builtinConfig[environment];
      if (!moduleFactory) {
        throw new Error(`Built-in module '${moduleName}' is not available in ${environment} environment.`);
      }

      try {
        // Execute the factory function to get the module
        const result = await moduleFactory();
        return result;
      } catch (error) {
        throw new Error(`Failed to load built-in module '${moduleName}' in ${environment} environment.`, { cause: error });
      }
    }

    // Not a supported built-in module
    return null;
  },
  relative: async (moduleSpecifier, pathResolver, callerContext) => {
    // Check if this is a relative path (supports any depth: ./, ../, ../../, etc.)
    if (!moduleSpecifier.startsWith('./') && !moduleSpecifier.startsWith('../')) {
      return null;
    }

    // Try to get the caller's URL from the context or stack trace
    let callerUrl = callerContext;
    let resolvedPath = null;

    // If we have a caller URL, resolve relative to it
    if (callerUrl && (callerUrl.startsWith('file://') || callerUrl.startsWith('http://') || callerUrl.startsWith('https://'))) {
      try {
        // Try URL-based resolution for both file:// and http(s):// URLs
        const url = new URL(moduleSpecifier, callerUrl);
        // For Bun, return pathname instead of full URL
        if (typeof Bun !== 'undefined' && callerUrl.startsWith('file://')) {
          resolvedPath = url.pathname;
        } else {
          resolvedPath = url.href;
        }
      } catch (error) {
        // Fallback for non-URL basePath (only for file:// URLs)
        if (callerUrl.startsWith('file://')) {
          const path = await import('node:path');
          const normalizedPath = new URL(callerUrl).pathname;
          resolvedPath = path.resolve(path.dirname(normalizedPath), moduleSpecifier);
        }
      }
    }

    // If we couldn't resolve with URL, try pathResolver
    if (!resolvedPath) {
      if (!pathResolver) {
        throw new Error('Path resolver is required for relative path resolution.');
      }

      try {
        // Use the provided pathResolver to resolve the relative path
        resolvedPath = await pathResolver(moduleSpecifier);
      } catch (error) {
        throw new Error(`Failed to resolve relative path '${moduleSpecifier}'.`, { cause: error });
      }
    }

    // Import the module and return it
    // Check if this is a JSON file and handle it specially
    if (resolvedPath.endsWith('.json')) {
      try {
        // For JSON files, we need to use import assertions
        const module = await import(resolvedPath, { with: { type: 'json' } });
        return module.default || module;
      } catch (error) {
        // Fallback to baseUse if import assertions fail
        return baseUse(resolvedPath);
      }
    }
    
    return baseUse(resolvedPath);
  },
  npm: async (moduleSpecifier, pathResolver) => {
    const path = await import('node:path');
    const { exec } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { stat, readFile } = await import('node:fs/promises');
    const execAsync = promisify(exec);

    if (!pathResolver) {
      throw new Error('Failed to get the current resolver.');
    }

    const fileExists = async (filePath) => {
      try {
        const stats = await stat(filePath);
        return stats.isFile();
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
        return false;
      }
    };

    const directoryExists = async (directoryPath) => {
      try {
        const stats = await stat(directoryPath);
        return stats.isDirectory();
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
        return false;
      }
    };

    const tryResolveModule = async (packagePath) => {
      try {
        return await pathResolver(packagePath);
      } catch (error) {
        if (error.code !== 'MODULE_NOT_FOUND') {
          throw error;
        }

        // Attempt to resolve paths like 'yargs@18.0.0/helpers' to 'yargs-v-18.0.0/helpers/helpers.mjs'
        if (await directoryExists(packagePath)) {
          const directoryName = path.basename(packagePath);
          const resolvedPath = await tryResolveModule(path.join(packagePath, directoryName));
          if (resolvedPath) {
            return resolvedPath;
          }

          // Attempt to resolve paths like 'octokit/core@latest' to 'octokit-core-v-latest/dist-src/index.js' (as it written in package.json)
          const packageJsonPath = path.join(packagePath, 'package.json');
          if (await fileExists(packageJsonPath)) {
            const packageJson = await readFile(packageJsonPath, 'utf8');
            const parsed = JSON.parse(packageJson);
            const exp = parsed.exports;
            if (exp) {
              let target = null;
              if (typeof exp === 'string') {
                target = exp;
              } else {
                const root = exp['.'] ?? exp;
                if (typeof root === 'string') {
                  target = root;
                } else if (root && typeof root === 'object') {
                  target = root.import || root.default || root.require || root.module || root.browser || null;
                }
              }
              if (typeof target === 'string') {
                const updatedPath = path.join(packagePath, target);
                return await tryResolveModule(updatedPath);
              }
            }
          }

          return null;
        }

        return null;
      }
    };

    const getLatestVersion = async (packageName) => {
      const { stdout: version } = await execAsync(`npm show ${packageName} version`);
      return version.trim();
    };

    const getInstalledPackageVersion = async (packagePath) => {
      try {
        const packageJsonPath = path.join(packagePath, 'package.json');
        const data = await readFile(packageJsonPath, 'utf8');
        const { version } = JSON.parse(data);
        return version;
      } catch {
        return null;
      }
    };

    const ensurePackageInstalled = async ({ packageName, version }) => {
      const alias = `${packageName.replace('@', '').replace('/', '-')}-v-${version}`;
      const { stdout: globalModulesPath } = await execAsync('npm root -g');
      const packagePath = path.join(globalModulesPath.trim(), alias);
      if (version !== 'latest' && await directoryExists(packagePath)) {
        return packagePath;
      }
      if (version === 'latest') {
        const latestVersion = await getLatestVersion(packageName);
        const installedVersion = await getInstalledPackageVersion(packagePath);
        if (installedVersion === latestVersion) {
          return packagePath;
        }
      }
      try {
        await execAsync(`npm install -g ${alias}@npm:${packageName}@${version}`, { stdio: 'ignore' });
      } catch (error) {
        throw new Error(`Failed to install ${packageName}@${version} globally.`, { cause: error });
      }
      return packagePath;
    };

    const { packageName, version, modulePath } = parseModuleSpecifier(moduleSpecifier);
    const packagePath = await ensurePackageInstalled({ packageName, version });
    const packageModulePath = modulePath ? path.join(packagePath, modulePath) : packagePath;
    const resolvedPath = await tryResolveModule(packageModulePath);
    if (!resolvedPath) {
      throw new Error(`Failed to resolve the path to '${moduleSpecifier}' from '${packageModulePath}'.`);
    }
    return resolvedPath;
  },
  bun: async (moduleSpecifier, pathResolver) => {
    const path = await import('node:path');
    const { exec } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { stat, readFile } = await import('node:fs/promises');
    const execAsync = promisify(exec);

    if (!pathResolver) {
      throw new Error('Failed to get the current resolver.');
    }

    const fileExists = async (filePath) => {
      try {
        const stats = await stat(filePath);
        return stats.isFile();
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
        return false;
      }
    };

    const directoryExists = async (directoryPath) => {
      try {
        const stats = await stat(directoryPath);
        return stats.isDirectory();
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
        return false;
      }
    };

    const tryResolveModule = async (packagePath) => {
      try {
        return await pathResolver(packagePath);
      } catch (error) {
        if (error.code !== 'MODULE_NOT_FOUND') {
          throw error;
        }

        if (await directoryExists(packagePath)) {
          const directoryName = path.basename(packagePath);
          const resolvedPath = await tryResolveModule(path.join(packagePath, directoryName));
          if (resolvedPath) {
            return resolvedPath;
          }

          const packageJsonPath = path.join(packagePath, 'package.json');
          if (await fileExists(packageJsonPath)) {
            const packageJson = await readFile(packageJsonPath, 'utf8');
            const parsed = JSON.parse(packageJson);
            const exp = parsed.exports;
            if (exp) {
              let target = null;
              if (typeof exp === 'string') {
                target = exp;
              } else {
                const root = exp['.'] ?? exp;
                if (typeof root === 'string') {
                  target = root;
                } else if (root && typeof root === 'object') {
                  target = root.import || root.default || root.require || root.module || root.browser || null;
                }
              }
              if (typeof target === 'string') {
                const updatedPath = path.join(packagePath, target);
                return await tryResolveModule(updatedPath);
              }
            }
          }

          return null;
        }

        return null;
      }
    };

    const ensurePackageInstalled = async ({ packageName, version }) => {
      const alias = `${packageName.replace('@', '').replace('/', '-')}-v-${version}`;

      let binDir = '';
      try {
        const { stdout } = await execAsync('bun pm bin -g');
        binDir = stdout.trim();
      } catch (error) {
        // In CI or fresh environments, the global directory might not exist
        // Try to get the default Bun install path
        const home = process.env.HOME || process.env.USERPROFILE;
        if (home) {
          binDir = path.join(home, '.bun', 'bin');
        } else {
          throw new Error('Unable to determine Bun global directory.', { cause: error });
        }
      }

      const bunInstallRoot = path.resolve(binDir, '..');
      const globalModulesPath = path.join(bunInstallRoot, 'install', 'global', 'node_modules');
      const packagePath = path.join(globalModulesPath, alias);

      if (version !== 'latest' && await directoryExists(packagePath)) {
        return packagePath;
      }

      try {
        await execAsync(`bun add -g ${alias}@npm:${packageName}@${version} --silent`, { stdio: 'ignore' });
      } catch (error) {
        throw new Error(`Failed to install ${packageName}@${version} globally with Bun.`, { cause: error });
      }

      return packagePath;
    };

    const { packageName, version, modulePath } = parseModuleSpecifier(moduleSpecifier);
    const packagePath = await ensurePackageInstalled({ packageName, version });
    const packageModulePath = modulePath ? path.join(packagePath, modulePath) : packagePath;
    const resolvedPath = await tryResolveModule(packageModulePath);
    if (!resolvedPath) {
      throw new Error(`Failed to resolve the path to '${moduleSpecifier}' from '${packageModulePath}'.`);
    }
    return resolvedPath;
  },
  deno: async (moduleSpecifier, pathResolver) => {
    const { packageName, version, modulePath } = parseModuleSpecifier(moduleSpecifier);

    // Use esm.sh as the default CDN for Deno, which provides good Deno compatibility
    const resolvedPath = `https://esm.sh/${packageName}@${version}${modulePath}`;
    return resolvedPath;
  },
  skypack: async (moduleSpecifier, pathResolver) => {
    const resolvedPath = `https://cdn.skypack.dev/${moduleSpecifier}`;
    return resolvedPath;
  },
  jsdelivr: async (moduleSpecifier, pathResolver) => {
    const { packageName, version, modulePath } = parseModuleSpecifier(moduleSpecifier);
    // If no modulePath is provided, append /{packageName}.js
    let path = modulePath ? modulePath : `/${packageName}`;
    if (/\.(mc)?js$/.test(path) === false) {
      path += '.js';
    }
    const resolvedPath = `https://cdn.jsdelivr.net/npm/${packageName}-es@${version}${path}`;
    return resolvedPath;
  },
  unpkg: async (moduleSpecifier, pathResolver) => {
    const { packageName, version, modulePath } = parseModuleSpecifier(moduleSpecifier);
    // If no modulePath is provided, append /{packageName}.js
    let path = modulePath ? modulePath : `/${packageName}`;
    if (/\.(mc)?js$/.test(path) === false) {
      path += '.js';
    }
    const resolvedPath = `https://unpkg.com/${packageName}-es@${version}${path}`;
    return resolvedPath;
  },
  esm: async (moduleSpecifier, pathResolver) => {
    const resolvedPath = `https://esm.sh/${moduleSpecifier}`;
    return resolvedPath;
  },
  jspm: async (moduleSpecifier, pathResolver) => {
    let { packageName, version, modulePath } = parseModuleSpecifier(moduleSpecifier);
    if (version === 'latest') {
      version = '';
    }
    const resolvedPath = `https://jspm.dev/${packageName}${version ? `@${version}` : ''}${modulePath}`;
    return resolvedPath;
  },
}

const baseUse = async (modulePath) => {
  // Dynamically import the module
  try {
    const module = await import(modulePath);

    // More robust default export handling for cross-environment compatibility
    const keys = Object.keys(module);

    // If it's a Module object with a default property, unwrap it
    if (module.default !== undefined) {
      // Check if this is likely a CommonJS module with only default export
      if (keys.length === 1 && keys[0] === 'default') {
        return module.default;
      }

      // Check if default is the main export and other keys are just function/module metadata
      const metadataKeys = new Set([
        'default', '__esModule', 'Symbol(Symbol.toStringTag)',
        'length', 'name', 'prototype', 'constructor',
        'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable'
      ]);

      const nonMetadataKeys = keys.filter(key => !metadataKeys.has(key));

      // If there are no significant non-metadata keys, return the default
      if (nonMetadataKeys.length === 0) {
        return module.default;
      }
    }

    // Return the whole module if it has multiple meaningful exports or no default
    return module;
  } catch (error) {
    throw new Error(`Failed to import module from '${modulePath}'.`, { cause: error });
  }
}

const getScriptUrl = async () => {
  const error = new Error();
  const stack = error.stack || '';
  const regex = /at[^:\\/]+(file:\/\/)?(?<path>(\/|(?<=\W)\w:)[^):]+):\d+:\d+/;
  const match = stack.match(regex);
  if (!match?.groups?.path) {
    return null;
  }
  const { pathToFileURL } = await import('node:url');
  return pathToFileURL(match.groups.path).href;
}

const makeUse = async (options) => {
  let scriptPath = options?.scriptPath;
  if (!scriptPath && typeof global !== 'undefined' && typeof global['__filename'] !== 'undefined') {
    scriptPath = global['__filename'];
  }
  const metaUrl = options?.meta?.url;
  if (!scriptPath && metaUrl) {
    scriptPath = metaUrl;
  }
  if (!scriptPath && typeof window === 'undefined' && typeof require === 'undefined') {
    scriptPath = await getScriptUrl();
  }
  let protocol;
  if (scriptPath) {
    try {
      protocol = new URL(scriptPath).protocol;
    } catch {
      // If scriptPath is a local file path, convert it to file:// URL
      if (scriptPath.startsWith('/') || scriptPath.includes('\\')) {
        protocol = 'file:';
      }
    }
  }
  let specifierResolver = options?.specifierResolver;
  if (typeof specifierResolver !== 'function') {
    if (typeof window !== 'undefined' || (protocol && (protocol === 'http:' || protocol === 'https:'))) {
      specifierResolver = resolvers[specifierResolver || 'esm'];
    } else if (typeof Deno !== 'undefined') {
      specifierResolver = resolvers[specifierResolver || 'deno'];
    } else if (typeof Bun !== 'undefined') {
      specifierResolver = resolvers[specifierResolver || 'bun'];
    } else {
      specifierResolver = resolvers[specifierResolver || 'npm'];
    }
  }
  let pathResolver = options?.pathResolver;
  if (!pathResolver) {
    const isCJS = typeof module !== "undefined" && !!module.exports;
    const hasRequire = typeof require !== 'undefined';
    const hasScriptPath = scriptPath && (!protocol || protocol === 'file:');
    if (hasRequire && hasScriptPath) {
      if (isCJS) {
        pathResolver = require.resolve;
      } else {
        pathResolver = await import('node:module')
        .then(module => module.createRequire(scriptPath))
        .then(require => require.resolve);
      }
    } else if (hasRequire) {
      pathResolver = require.resolve;
    } else if (hasScriptPath) {
      pathResolver = await import('node:module')
        .then(module => module.createRequire(scriptPath))
        .then(require => require.resolve);
    } else {
      pathResolver = (path) => path;
    }
  }
  return async (moduleSpecifier, providedCallerContext) => {
    const stack = new Error().stack;

    // Use provided caller context or try to capture it from stack trace
    const callerContext = providedCallerContext || extractCallerContext(stack);

    // Always try built-in resolver first
    const builtinModule = await resolvers.builtin(moduleSpecifier, pathResolver);
    if (builtinModule) {
      return builtinModule;
    }

    // Try relative path resolver second (for ./, ../, ../../, etc.)
    const relativeModule = await resolvers.relative(moduleSpecifier, pathResolver, callerContext);
    if (relativeModule) {
      return relativeModule;
    }

    // If not a built-in or relative module, use the configured resolver
    const modulePath = await specifierResolver(moduleSpecifier, pathResolver);
    return baseUse(modulePath);
  };
}

let __use = null;
const use = async (moduleSpecifier) => {
  const stack = new Error().stack;

  // For Bun, we need to capture the stack trace before any other calls
  let bunCallerContext = null;
  if (typeof Bun !== 'undefined') {
    if (stack) {
      const lines = stack.split('\n');
      // Look for any .mjs file that's not use.mjs
      for (const line of lines) {
        const match = line.match(/[(]?(\/[^\s:)]+\.m?js)/);
        if (match && !match[1].endsWith('/use.mjs')) {
          bunCallerContext = 'file://' + match[1];
          break;
        }
      }
    }
  }

  // Capture the caller context here, before entering makeUse
  const callerContext = bunCallerContext || extractCallerContext(stack);

  if (!__use) {
    __use = await makeUse();
  }
  return __use(moduleSpecifier, callerContext);
}
use.all = async (...moduleSpecifiers) => {
  if (!__use) {
    __use = await makeUse();
  }
  return Promise.all(moduleSpecifiers.map(__use));
}

makeUse.parseModuleSpecifier = parseModuleSpecifier;
makeUse.resolvers = resolvers;
makeUse.makeUse = makeUse;
makeUse.baseUse = baseUse;
makeUse.use = use;

makeUse