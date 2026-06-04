#!/usr/bin/env node
/**
 * `cleanup` — free disk space by removing stale hive-mind temporary
 * directories/files while preserving folders that belong to currently-running
 * (active) tasks, protected system paths and any work that is not yet pushed.
 *
 * This is the standalone command requested in issue #1848. It reproduces, in a
 * safe and automated way, the manual workflow the maintainer used to reclaim
 * space without restarting the server:
 *   - list temp entries (like `du -sh /tmp/*`),
 *   - figure out which clones belong to active solve tasks (by branch name, the
 *     same way solve.mjs derives branches), keeping those,
 *   - keep protected paths such as `/tmp/start-command/`,
 *   - delete the rest.
 *
 * Modes:
 *   --dry-run                     show kept + deleted lists, delete nothing
 *   --keep-active-tasks-folders   keep folders of running tasks (default: on)
 *   --force / -f                  skip the confirmation prompt
 *   --all                         also consider non-hive-mind temp entries
 *   --force-start-command         allow deleting /tmp/start-command
 *   --include-system              also consider system-owned temp entries
 *   --no-keep-dirty               allow deleting clones with unpushed changes
 *   --processes                   map claude/codex/etc. PIDs to task sessions
 *   --kill-orphaned-agents        signal orphaned terminal-session agents
 *   --apt --journal --docker --npm   Ubuntu/system cleanup (opt-in)
 *   --system                      shorthand for --apt --journal --npm
 *   --sudo                        prefix package-manager commands with sudo
 *   --verbose / -v
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1848
 */

import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { execSync } from 'node:child_process';

import { classifyEntries, summarize, formatBytes, describeReason, buildActiveMatchers, DEFAULT_PROTECTED_NAMES } from './cleanup.lib.mjs';
import { getTempRoot, listTempEntries, getPathSize, readFolderGitInfo, listProcessHeldPaths, getActiveTasks, removePath, runSystemCleanup, collectProcessDebugReport, signalOrphanedAgentTrees } from './cleanup.os.lib.mjs';
import { formatProcessDebugReport } from './process-debug.lib.mjs';

const args = process.argv.slice(2);

function hasFlag(...names) {
  return names.some(n => args.includes(n));
}

function getFlagValue(name) {
  const exact = args.indexOf(name);
  if (exact >= 0 && args[exact + 1] && !args[exact + 1].startsWith('-')) return args[exact + 1];
  const prefix = `${name}=`;
  const withEquals = args.find(arg => arg.startsWith(prefix));
  return withEquals ? withEquals.slice(prefix.length) : null;
}

function getFlagValues(name) {
  const values = [];
  const prefix = `${name}=`;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === name && args[i + 1] && !args[i + 1].startsWith('-')) values.push(args[i + 1]);
    else if (arg.startsWith(prefix)) values.push(arg.slice(prefix.length));
  }
  return values;
}

function parsePidList(values) {
  return values
    .flatMap(value => String(value || '').split(','))
    .map(value => Number(value.trim()))
    .filter(value => Number.isInteger(value) && value > 0);
}

// ---------------------------------------------------------------------------
// Early --version / --help handling (no heavy imports).
// ---------------------------------------------------------------------------
if (hasFlag('--version')) {
  const { getVersion } = await import('./version.lib.mjs');
  try {
    console.log(await getVersion());
  } catch {
    console.error('Error: Unable to determine version');
    process.exit(1);
  }
  process.exit(0);
}

if (hasFlag('--help', '-h')) {
  console.log(`Usage: cleanup [options]

Free disk space by removing stale hive-mind temporary directories/files while
keeping folders that belong to active tasks and protected system paths.

Options:
  --dry-run, -n               Show what would be kept and deleted, delete nothing
  --keep-active-tasks-folders Keep folders of currently-running tasks [default: on]
  --no-keep-active-tasks-folders
                              Disable active-task detection (only protected paths kept)
  --force, -f                 Delete without the interactive confirmation prompt
  --all                       Also consider non-hive-mind temp entries for deletion
  --include-system            Also consider system-owned temp entries (.X11-unix, …)
  --force-start-command       Allow deleting /tmp/start-command (kept by default)
  --no-keep-dirty             Allow deleting clones with uncommitted/unpushed changes
  --no-sessions               Do not query '$ --status' for active sessions
  --no-resolve-branches       Do not resolve PR head branches via gh

Process diagnostics:
  --processes, --debug-processes
                              Map claude/codex/gemini/qwen/opencode PIDs to
                              hive-mind task sessions and workspaces
  --pid <pid[,pid...]>        Include specific non-agent PIDs in the report
  --kill-orphaned-agents      Signal orphaned agent processes whose task
                              session has already reached a terminal status
                              (dry-run unless --force is also set)
  --signal <name>             Signal for --kill-orphaned-agents [SIGTERM]

System / Ubuntu cleanup (opt-in):
  --apt                       apt-get clean / autoclean / autoremove
  --journal                   journalctl --vacuum-time=2weeks
  --docker                    docker system prune -f
  --npm                       npm cache clean --force
  --system                    Shorthand for --apt --journal --npm
  --sudo                      Prefix package-manager commands with sudo

  --verbose, -v               Verbose logging
  --version                   Show version number
  --help, -h                  Show this help
`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Options.
// ---------------------------------------------------------------------------
const options = {
  dryRun: hasFlag('--dry-run', '-n'),
  keepActiveTasks: !hasFlag('--no-keep-active-tasks-folders'),
  force: hasFlag('--force', '-f'),
  includeAll: hasFlag('--all'),
  includeSystem: hasFlag('--include-system'),
  forceStartCommand: hasFlag('--force-start-command'),
  keepDirty: !hasFlag('--no-keep-dirty'),
  useSessions: !hasFlag('--no-sessions'),
  resolveBranches: !hasFlag('--no-resolve-branches'),
  debugProcesses: hasFlag('--processes', '--debug-processes'),
  killOrphanedAgents: hasFlag('--kill-orphaned-agents'),
  targetPids: parsePidList(getFlagValues('--pid')),
  signal: getFlagValue('--signal') || 'SIGTERM',
  verbose: hasFlag('--verbose', '-v'),
  apt: hasFlag('--apt', '--system'),
  journal: hasFlag('--journal', '--system'),
  docker: hasFlag('--docker'),
  npm: hasFlag('--npm', '--system'),
  sudo: hasFlag('--sudo'),
};
if (options.targetPids.length > 0) options.debugProcesses = true;

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const scriptDir = path.dirname(process.argv[1]);
const logFile = path.join(scriptDir, `cleanup-${timestamp}.log`);

async function log(message, { level = 'info' } = {}) {
  await fsp.appendFile(logFile, `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}\n`).catch(() => {});
  if (level === 'error') console.error(message);
  else if (level === 'warn' || level === 'warning') console.warn(message);
  else console.log(message);
}

function vlog(message) {
  if (options.verbose) return log(message);
  return fsp.appendFile(logFile, `[${new Date().toISOString()}] [DEBUG] ${message}\n`).catch(() => {});
}

/**
 * Compute the set of absolute top-level tmp entries that the cleanup process
 * itself depends on, so we never delete our own running clone.
 */
function computeSelfPaths(tempRoot) {
  const selfPaths = new Set();
  const normalizedRoot = tempRoot.endsWith(path.sep) ? tempRoot : tempRoot + path.sep;
  const add = candidate => {
    if (candidate && (candidate === tempRoot || candidate.startsWith(normalizedRoot))) {
      const first = candidate.slice(normalizedRoot.length).split(path.sep)[0];
      if (first) selfPaths.add(path.join(tempRoot, first));
    }
  };
  add(process.cwd());
  add(path.resolve(scriptDir));
  add(path.resolve(process.argv[1] || ''));
  return selfPaths;
}

async function main() {
  await fsp.writeFile(logFile, `# Cleanup Log - ${new Date().toISOString()}\n\n`).catch(() => {});

  const tempRoot = getTempRoot();
  await log('🧹 hive-mind cleanup');
  await log('====================\n');
  await log(`📂 Temp root: ${tempRoot}`);
  if (options.dryRun) await log('📝 DRY RUN — nothing will be deleted\n');
  else if (options.force) await log('⚠️  FORCE — deleting without confirmation\n');

  if (options.debugProcesses || options.killOrphanedAgents) {
    const report = await collectProcessDebugReport({ useSessions: options.useSessions, targetPids: options.targetPids });
    await log('');
    await log(formatProcessDebugReport(report));

    if (options.killOrphanedAgents) {
      if (report.orphans.length === 0) {
        await log('\n✅ No orphaned terminal-session agent processes found.');
      } else if (options.dryRun || !options.force) {
        await log(`\n📝 Dry run: would send ${options.signal} to orphaned agent roots: ${report.orphans.map(item => item.pid).join(', ')}`);
        await log('Re-run with --force to signal these process trees.');
      } else {
        await log(`\n🧯 Sending ${options.signal} to orphaned agent process trees...`);
        const killed = signalOrphanedAgentTrees(report, { signal: options.signal, currentPid: process.pid });
        let ok = 0;
        let failed = 0;
        for (const tree of killed) {
          const pids = tree.results.map(result => `${result.pid}${result.ok ? '' : ' (failed)'}`).join(', ') || '(none)';
          await log(`   root ${tree.rootPid}: ${pids}`);
          ok += tree.results.filter(result => result.ok).length;
          failed += tree.results.filter(result => !result.ok).length;
        }
        await log(`\n✅ Signalled ${ok} processes${failed ? `, ${failed} failed` : ''}.`);
      }
    }

    await log(`\n📁 Log file: ${logFile}`);
    return;
  }

  // 1. Enumerate candidate entries.
  const entries = listTempEntries(tempRoot);
  await log(`🔍 Found ${entries.length} entries under ${tempRoot}`);

  // 2. Gather signals for active-task detection.
  const heldPaths = listProcessHeldPaths(tempRoot);
  await vlog(`Process-held paths: ${[...heldPaths].join(', ') || '(none)'}`);

  let matchers = [];
  if (options.keepActiveTasks) {
    const activeTasks = await getActiveTasks({ useSessions: options.useSessions, resolveBranches: options.resolveBranches });
    matchers = buildActiveMatchers(activeTasks);
    if (activeTasks.length > 0) {
      await log(`🏃 Active tasks detected: ${activeTasks.length}`);
      for (const t of activeTasks) {
        await log(`   • ${t.owner}/${t.repo} ${t.type} #${t.number}${t.branch ? ` (branch ${t.branch})` : ''}`);
      }
    } else {
      await log('🏃 No active tasks detected from running processes/sessions');
    }
  } else {
    await log('⚠️  Active-task detection disabled (--no-keep-active-tasks-folders)');
  }

  // 3. Read git info for directory entries (used by branch / dirty matching).
  const gitInfoByPath = new Map();
  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    const info = readFolderGitInfo(entry.path);
    if (info) gitInfoByPath.set(entry.path, info);
  }

  const selfPaths = computeSelfPaths(tempRoot);
  await vlog(`Self paths: ${[...selfPaths].join(', ') || '(none)'}`);

  // 4. Classify.
  const ctx = {
    protectedNames: DEFAULT_PROTECTED_NAMES,
    forceStartCommand: options.forceStartCommand,
    includeSystem: options.includeSystem,
    includeAll: options.includeAll,
    keepDirty: options.keepDirty,
    selfPaths,
    heldPaths,
    matchers,
    gitInfoByPath,
  };
  const classified = classifyEntries(entries, ctx);

  // 5. Compute sizes (only for what we report, to keep it reasonably fast).
  for (const item of [...classified.keep, ...classified.remove]) {
    item.size = getPathSize(item.path);
  }
  const totals = summarize(classified);

  // 6. Report.
  await log('\n🟢 KEPT folders/files:');
  if (classified.keep.length === 0) await log('   (none)');
  for (const item of classified.keep.sort((a, b) => (b.size || 0) - (a.size || 0))) {
    await log(`   ${formatBytes(item.size).padStart(7)}  ${item.path}  — ${describeReason(item.reason)}`);
  }

  await log(`\n🗑️  ${options.dryRun ? 'WOULD DELETE' : 'TO DELETE'} folders/files:`);
  if (classified.remove.length === 0) await log('   (none)');
  for (const item of classified.remove.sort((a, b) => (b.size || 0) - (a.size || 0))) {
    await log(`   ${formatBytes(item.size).padStart(7)}  ${item.path}  — ${describeReason(item.reason)}`);
  }

  await log(`\n📊 Summary: keep ${totals.keepCount} (${formatBytes(totals.keepBytes)}), remove ${totals.removeCount} (${formatBytes(totals.removeBytes)})`);

  // 7. Execute deletion (unless dry-run).
  if (options.dryRun) {
    await log('\n✅ Dry run complete. Re-run without --dry-run to delete.');
  } else if (classified.remove.length === 0) {
    await log('\n✅ Nothing to delete.');
  } else {
    if (!options.force) {
      console.log(`\n⚠️  This will permanently delete ${classified.remove.length} entries (${formatBytes(totals.removeBytes)}).`);
      console.log('Type "yes" to confirm, or Ctrl+C to cancel:');
      process.stdout.write('> ');
      let answer = '';
      try {
        answer = execSync('read answer && echo $answer', { encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'], shell: '/bin/bash' }).trim();
      } catch {
        await log('\n❌ Cancelled');
        return;
      }
      if (answer.toLowerCase() !== 'yes') {
        await log('\n❌ Cancelled');
        return;
      }
    }

    await log('\n🗑️  Deleting...');
    let deleted = 0;
    let failed = 0;
    for (const item of classified.remove) {
      const ok = removePath(item.path);
      if (ok) {
        deleted++;
        await vlog(`   removed ${item.path}`);
      } else {
        failed++;
        await log(`   ⚠️  failed to remove ${item.path}`, { level: 'warn' });
      }
    }
    await log(`\n✅ Deleted ${deleted} entries${failed ? `, ${failed} failed` : ''}.`);
  }

  // 8. System / Ubuntu cleanup (opt-in).
  if (options.apt || options.journal || options.docker || options.npm) {
    await log('\n🧴 System cleanup:');
    runSystemCleanup({
      apt: options.apt,
      journal: options.journal,
      docker: options.docker,
      npm: options.npm,
      dryRun: options.dryRun,
      useSudo: options.sudo,
      logFn: msg => log(msg),
    });
  }

  await log(`\n📁 Log file: ${logFile}`);
}

main().catch(async error => {
  await log(`❌ Error: ${error.message}`, { level: 'error' });
  process.exit(1);
});
