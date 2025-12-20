#!/usr/bin/env node

/**
 * Local CI Checks Module
 * Detects and runs local CI checks before pushing to avoid CI failures
 */

if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const { $ } = await use('command-stream');
const fs = (await use('fs')).promises;
const path = (await use('path')).default;

/**
 * Detect which CI tools are configured in the project
 * @param {string} workDir - Working directory
 * @returns {Promise<Object>} Detected CI tools and their configs
 */
export async function detectCITools(workDir) {
  const tools = {
    python: {
      ruff: false,
      mypy: false,
      pytest: false,
      nox: false,
      black: false,
      flake8: false
    },
    javascript: {
      eslint: false,
      prettier: false,
      jest: false,
      vitest: false
    },
    rust: {
      rustfmt: false,
      clippy: false,
      cargoTest: false
    },
    general: {
      preCommit: false
    }
  };

  try {
    // Check for Python tools
    const pyprojectPath = path.join(workDir, 'pyproject.toml');
    const ruffConfigPath = path.join(workDir, 'ruff.toml');
    const mypyConfigPath = path.join(workDir, 'mypy.ini');
    const noxfilePath = path.join(workDir, 'noxfile.py');
    const flake8ConfigPath = path.join(workDir, '.flake8');

    // Check ruff
    try {
      await fs.access(ruffConfigPath);
      tools.python.ruff = true;
    } catch {
      // File doesn't exist, ruff not configured
    }

    try {
      const pyproject = await fs.readFile(pyprojectPath, 'utf-8');
      if (pyproject.includes('[tool.ruff]')) tools.python.ruff = true;
      if (pyproject.includes('[tool.mypy]')) tools.python.mypy = true;
      if (pyproject.includes('[tool.black]')) tools.python.black = true;
      if (pyproject.includes('[tool.pytest]')) tools.python.pytest = true;
    } catch {
      // File doesn't exist or can't be read, tools not configured in pyproject.toml
    }

    // Check mypy
    try {
      await fs.access(mypyConfigPath);
      tools.python.mypy = true;
    } catch {
      // File doesn't exist, mypy not configured
    }

    // Check nox
    try {
      await fs.access(noxfilePath);
      tools.python.nox = true;
    } catch {
      // File doesn't exist, nox not configured
    }

    // Check flake8
    try {
      await fs.access(flake8ConfigPath);
      tools.python.flake8 = true;
    } catch {
      // File doesn't exist, flake8 not configured
    }

    // Check for JavaScript tools
    const packageJsonPath = path.join(workDir, 'package.json');
    try {
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));

      if (packageJson.devDependencies?.eslint || packageJson.dependencies?.eslint) {
        tools.javascript.eslint = true;
      }
      if (packageJson.devDependencies?.prettier || packageJson.dependencies?.prettier) {
        tools.javascript.prettier = true;
      }
      if (packageJson.devDependencies?.jest || packageJson.dependencies?.jest) {
        tools.javascript.jest = true;
      }
      if (packageJson.devDependencies?.vitest || packageJson.dependencies?.vitest) {
        tools.javascript.vitest = true;
      }
    } catch {
      // File doesn't exist or can't be parsed, JavaScript tools not configured
    }

    // Check for Rust tools
    const cargoTomlPath = path.join(workDir, 'Cargo.toml');
    try {
      await fs.access(cargoTomlPath);
      tools.rust.rustfmt = true;
      tools.rust.clippy = true;
      tools.rust.cargoTest = true;
    } catch {
      // File doesn't exist, Rust tools not configured
    }

    // Check for pre-commit
    const preCommitPath = path.join(workDir, '.pre-commit-config.yaml');
    try {
      await fs.access(preCommitPath);
      tools.general.preCommit = true;
    } catch {
      // File doesn't exist, pre-commit not configured
    }

  } catch (err) {
    console.error('Error detecting CI tools:', err.message);
  }

  return tools;
}

/**
 * Run local CI checks
 * @param {string} workDir - Working directory
 * @param {Object} tools - Detected CI tools from detectCITools()
 * @param {Object} options - Options for running checks
 * @returns {Promise<Object>} Results of CI checks
 */
export async function runLocalCIChecks(workDir, tools, options = {}) {
  const results = {
    success: true,
    checks: [],
    errors: []
  };

  const verbose = options.verbose || false;

  // Run Python checks
  if (tools.python.ruff) {
    const result = await runCheck(workDir, 'ruff check .', 'Ruff linting', verbose);
    results.checks.push(result);
    if (!result.success) results.success = false;
  }

  if (tools.python.mypy) {
    const result = await runCheck(workDir, 'mypy .', 'MyPy type checking', verbose);
    results.checks.push(result);
    if (!result.success) results.success = false;
  }

  if (tools.python.black) {
    const result = await runCheck(workDir, 'black --check .', 'Black formatting', verbose);
    results.checks.push(result);
    if (!result.success) results.success = false;
  }

  if (tools.python.flake8) {
    const result = await runCheck(workDir, 'flake8 .', 'Flake8 linting', verbose);
    results.checks.push(result);
    if (!result.success) results.success = false;
  }

  // Run JavaScript checks
  if (tools.javascript.eslint) {
    const result = await runCheck(workDir, 'npm run lint', 'ESLint', verbose);
    results.checks.push(result);
    if (!result.success) results.success = false;
  }

  if (tools.javascript.prettier) {
    const result = await runCheck(workDir, 'npm run format:check', 'Prettier', verbose);
    results.checks.push(result);
    if (!result.success) results.success = false;
  }

  // Run Rust checks
  if (tools.rust.rustfmt) {
    const result = await runCheck(workDir, 'cargo fmt -- --check', 'Rustfmt', verbose);
    results.checks.push(result);
    if (!result.success) results.success = false;
  }

  if (tools.rust.clippy) {
    const result = await runCheck(workDir, 'cargo clippy -- -D warnings', 'Clippy', verbose);
    results.checks.push(result);
    if (!result.success) results.success = false;
  }

  // Run tests only if requested
  if (options.runTests) {
    if (tools.python.pytest) {
      const result = await runCheck(workDir, 'pytest', 'Pytest', verbose);
      results.checks.push(result);
      if (!result.success) results.success = false;
    }

    if (tools.python.nox) {
      const result = await runCheck(workDir, 'nox', 'Nox', verbose);
      results.checks.push(result);
      if (!result.success) results.success = false;
    }

    if (tools.javascript.jest) {
      const result = await runCheck(workDir, 'npm test', 'Jest', verbose);
      results.checks.push(result);
      if (!result.success) results.success = false;
    }

    if (tools.rust.cargoTest) {
      const result = await runCheck(workDir, 'cargo test', 'Cargo test', verbose);
      results.checks.push(result);
      if (!result.success) results.success = false;
    }
  }

  return results;
}

/**
 * Run a single check command
 * @param {string} workDir - Working directory
 * @param {string} command - Command to run
 * @param {string} name - Display name for the check
 * @param {boolean} verbose - Whether to show verbose output
 * @returns {Promise<Object>} Check result
 */
async function runCheck(workDir, command, name, verbose) {
  const result = {
    name,
    command,
    success: false,
    output: '',
    error: ''
  };

  try {
    const checkResult = await $`cd ${workDir} && ${command}`.raw().trim();

    result.success = checkResult.exitCode === 0;
    result.output = checkResult.text;

    if (verbose || !result.success) {
      console.log(`\n${result.success ? '✅' : '❌'} ${name}:`);
      if (result.output) {
        console.log(result.output);
      }
    }
  } catch (err) {
    result.success = false;
    result.error = err.message;

    if (verbose) {
      console.log(`\n❌ ${name}:`);
      console.log(result.error);
    }
  }

  return result;
}

/**
 * Generate a summary report of CI check results
 * @param {Object} results - Results from runLocalCIChecks()
 * @returns {string} Formatted summary report
 */
export function generateCICheckReport(results) {
  const lines = [];

  lines.push('\n=== Local CI Checks Summary ===\n');

  if (results.checks.length === 0) {
    lines.push('No CI checks were run.');
    return lines.join('\n');
  }

  const passed = results.checks.filter(c => c.success).length;
  const failed = results.checks.filter(c => !c.success).length;

  lines.push(`Total checks: ${results.checks.length}`);
  lines.push(`Passed: ${passed}`);
  lines.push(`Failed: ${failed}`);
  lines.push('');

  if (failed > 0) {
    lines.push('Failed checks:');
    results.checks.filter(c => !c.success).forEach(check => {
      lines.push(`  ❌ ${check.name}`);
      if (check.output) {
        lines.push(`     ${check.output.split('\n')[0]}`);
      }
    });
  }

  if (results.success) {
    lines.push('\n✅ All CI checks passed! Safe to commit and push.');
  } else {
    lines.push('\n❌ Some CI checks failed. Please fix the issues before committing.');
  }

  return lines.join('\n');
}
