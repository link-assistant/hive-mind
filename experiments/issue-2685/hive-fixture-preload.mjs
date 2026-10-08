// Finite offline collaborators for running the real hive entry point in regressions.
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import * as fs from 'node:fs';
import * as path from 'node:path';

const scenario = process.env.HIVE_FIXTURE_SCENARIO;
const root = new URL('../../src/', import.meta.url);
const url = name => new URL(name, root).href;
const noop = '() => {}';
const stubs = new Map();
const stub = (name, source) => stubs.set(url(name), source);
globalThis.use = async name => {
  if (name === 'fs') return fs;
  if (name === 'path') return { ...path, default: path };
  if (name === 'command-stream') return { $: async () => ({ code: 0, stdout: '', stderr: '' }) };
  if (name.startsWith('getenv')) return (key, fallback) => process.env[key] ?? fallback;
  if (name.startsWith('links-notation')) return import('links-notation');
  throw new Error(`Unexpected dependency: ${name}`);
};
stub('instrument.mjs', '');
stub(
  'lib.mjs',
  `
export const log = async (message, { verbose = false } = {}) => { if (!verbose || global.verboseMode) console.log(message); };
export const cleanErrorMessage = error => error.message || String(error);
export const formatTimestamp = () => 'fixture';
export const getAbsoluteLogPath = async () => '/tmp/hive-fixture.log';
export const setLogFile = ${noop}, cleanupTempDirectories = ${noop}, setupVerboseLogInterceptor = ${noop}, setupStdioLogInterceptor = ${noop};
`
);
stub('sentry.lib.mjs', `export const initializeSentry = ${noop}, addBreadcrumb = ${noop}, reportError = ${noop}; export const withSentry = fn => fn;`);
stub('exit-handler.lib.mjs', `export const initializeExitHandler = ${noop}, installGlobalExitHandlers = ${noop}, delegateSignalHandling = ${noop}; export const safeExit = async (code, reason) => { console.log('EXIT:', code, reason); process.exit(code); };`);
stub('claude.lib.mjs', 'export const validateClaudeConnection = async () => true;');
stub('memory-check.mjs', 'export const checkSystem = async () => ({ success: true });');
stub('tool-connection-validation.lib.mjs', "export const validateToolConnection = async () => { console.log('FIXTURE_TOOL_CHECK'); return true; };");
stub('agent-config-audit.lib.mjs', `export const isAgentConfigAutoRepairEnabled = () => false, runAgentConfigAudit = ${noop};`);
stub('disk-guard.lib.mjs', `export const EXIT_CODE_INSUFFICIENT_DISK_SPACE = 75, ensureDiskSpaceForWorker = async () => ({ ok: ${scenario !== 'disk-halt'}, freeMB: ${scenario === 'disk-halt' ? 0 : 99999} }), extractSolverWorkspacePaths = () => [];`);
stub('reclaimable-space.lib.mjs', `export const logReclaimableSpace = ${noop}, formatReclaimableSpaceLines = () => [];`);
stub('hive.recheck.lib.mjs', `export const recheckIssueConditions = async () => ({ shouldProcess: ${scenario !== 'recheck-skip'}, reason: 'An open pull request appeared', pullRequests: [{ state: 'OPEN', url: 'https://github.com/link-assistant/calculator/pull/228' }] });`);
stub(
  'hive.issue-relations.lib.mjs',
  `
let waiting = [];
export const createGhGraphQLRunner = () => {}, createIssueRelationsFetcher = () => {};
export const createIssueRelationsGate = () => ({
filterReadyIssues: async issues => { waiting = ${scenario === 'blocked' ? 'issues' : scenario === 'partial' ? 'issues.slice(1)' : '[]'}; return issues.filter(issue => !waiting.includes(issue)); },
checkIssueReady: async () => ({ ready: true }),
shouldStartAnotherOnceRound: () => false, getWaitingCount: () => waiting.length, getWaitingIssues: () => waiting.map(issue => issue.url)
});`
);
stub(
  'github.lib.mjs',
  `
import { readFileSync } from 'node:fs';
export { parseGitHubUrl } from ${JSON.stringify(url('github-url-parser.lib.mjs'))};
export const checkGitHubPermissions = async () => true, isRateLimitError = () => false;
const issues = JSON.parse(readFileSync(${JSON.stringify(new URL('../../docs/case-studies/issue-2685/data/calculator-open-issues.json', import.meta.url).pathname)}, 'utf8')).filter(issue => !issue.pull_request).map(issue => ({ ...issue, url: issue.html_url }));
export const fetchAllIssuesWithPagination = async () => {
  ${scenario === 'discovery-error' ? "throw new Error('GitHub discovery unavailable');" : `return ${scenario === 'empty' ? '[]' : ['all-prs', 'blocked', 'partial'].includes(scenario) ? 'issues' : 'issues.slice(0, 1)'};`}
};
export const fetchProjectIssues = fetchAllIssuesWithPagination;
export const batchCheckArchivedRepositories = async () => (${scenario === 'archived' ? "{ 'link-assistant/calculator': true }" : '{}'});
export const batchCheckPullRequestsForIssues = async (owner, repo, numbers) => Object.fromEntries(numbers.map(number => [number, {
openPRCount: ${scenario === 'all-prs' ? 1 : 0}, linkedPRs: ${scenario === 'all-prs' ? "[{ number: 228, state: 'OPEN', url: 'https://github.com/link-assistant/calculator/pull/228' }]" : '[]'}
}]));`
);
stub('list-solution-drafts.lib.mjs', 'export const listSolutionDrafts = async () => {};');
stub('github.graphql.lib.mjs', 'export const tryFetchIssuesWithGraphQL = async () => ({ success: false });');
stub('youtrack/youtrack.lib.mjs', `export const validateYouTrackConfig = ${noop}, testYouTrackConnection = async () => true, createYouTrackConfigFromEnv = () => ({ projectCode: 'TEST', stage: 'Ready' });`);
stub('youtrack/youtrack-sync.mjs', `export const syncYouTrackToGitHub = async () => { ${scenario === 'discovery-error' ? "throw new Error('GitHub discovery unavailable');" : 'return [];'} }, formatIssuesForHive = issues => issues;`);

registerHooks({
  load(moduleUrl, context, nextLoad) {
    if (stubs.has(moduleUrl)) return { format: 'module', source: stubs.get(moduleUrl), shortCircuit: true };
    if (moduleUrl === url('hive.mjs')) {
      // Speed up polling without changing queue or outcome behavior.
      const source = readFileSync(new URL(moduleUrl), 'utf8').replaceAll('setTimeout(resolve, 5000)', 'setTimeout(resolve, 10)');
      return { format: 'module', source, shortCircuit: true };
    }
    return nextLoad(moduleUrl, context);
  },
});
