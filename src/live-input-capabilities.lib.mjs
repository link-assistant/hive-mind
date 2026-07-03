/**
 * Shared capability matrix for live issue/PR event input.
 *
 * Issue #2007 asks solve to make the direct JSON-input support boundary
 * explicit for Claude, Codex, and other tool runners. Keep the matrix small
 * and factual: it describes what the current solve runners can do, not every
 * capability the upstream CLIs may expose outside this project.
 */

export const ISSUE_2007_REQUIRED_EVENT_IDS = Object.freeze(['issue-title', 'issue-body', 'issue-comments', 'pull-request-comments']);

export const LIVE_INPUT_EVENT_SOURCES = Object.freeze([
  Object.freeze({
    id: 'issue-title',
    label: 'Issue title updates',
    requiredByIssue2007: true,
    note: 'User-facing issue metadata should be streamed when it changes during a run.',
  }),
  Object.freeze({
    id: 'issue-body',
    label: 'Issue description updates',
    requiredByIssue2007: true,
    note: 'The issue body is treated as user feedback because it can change after the agent starts.',
  }),
  Object.freeze({
    id: 'issue-comments',
    label: 'Issue comments',
    requiredByIssue2007: true,
    note: 'New non-system issue comments are user feedback.',
  }),
  Object.freeze({
    id: 'pull-request-comments',
    label: 'Pull request comments',
    requiredByIssue2007: true,
    note: 'New non-system PR conversation comments and review comments should reach the agent.',
  }),
  Object.freeze({
    id: 'pull-request-description',
    label: 'Pull request description updates',
    requiredByIssue2007: false,
    note: 'Issue #2007 explicitly treats the PR description as AI-owned, so it is not a required user-feedback source.',
  }),
]);

const REQUIRED_EVENTS = ISSUE_2007_REQUIRED_EVENT_IDS;

const CAPABILITIES = Object.freeze({
  claude: Object.freeze({
    tool: 'claude',
    label: 'Claude',
    supported: true,
    option: '--auto-input-until-mergeable',
    protocol: 'claude --input-format stream-json stdin NDJSON',
    currentRunner: 'src/claude.lib.mjs keeps stdin as a pipe and attaches bidirectional-interactive.lib.mjs',
    futureProtocol: '',
    events: REQUIRED_EVENTS,
    unsupportedReason: '',
    testing: 'Run solve with --tool claude --auto-input-until-mergeable, add an issue or PR comment while the Claude process is alive, and watch for the bidirectional handler to queue or stream a user frame into stdin.',
  }),
  codex: Object.freeze({
    tool: 'codex',
    label: 'Codex',
    supported: false,
    option: '--auto-input-until-mergeable',
    protocol: 'No live input protocol is wired through solve for Codex yet.',
    currentRunner: 'src/codex.lib.mjs uses codex exec with prompt/stdin context at process start',
    futureProtocol: 'Codex app-server JSON-RPC turn/steer',
    events: Object.freeze([]),
    unsupportedReason: 'The current solve Codex runner uses codex exec, whose stdin is one-shot prompt/context at process start. It does not expose the live JSON input pipe needed for mid-session issue/PR events. Codex app-server turn/steer is the verified candidate protocol for a future Codex live-input runner.',
    testing: 'Today, passing --tool codex --auto-input-until-mergeable should warn and fall back to the existing restart/resume loop instead of claiming live input support.',
  }),
  agent: Object.freeze({
    tool: 'agent',
    label: 'Agent',
    supported: false,
    option: '--auto-input-until-mergeable',
    protocol: 'No verified live JSON input contract is wired through solve for Agent yet.',
    currentRunner: 'src/agent.lib.mjs uses a prompt-driven process invocation',
    futureProtocol: '',
    events: Object.freeze([]),
    unsupportedReason: 'No verified live JSON input contract is wired through solve for Agent yet.',
    testing: 'The flag should warn and fall back to restart/resume behavior until a live-input runner is implemented.',
  }),
  opencode: Object.freeze({
    tool: 'opencode',
    label: 'OpenCode',
    supported: false,
    option: '--auto-input-until-mergeable',
    protocol: 'No verified live JSON input contract is wired through solve for OpenCode yet.',
    currentRunner: 'src/opencode.lib.mjs uses a prompt-via-file/stdin pattern',
    futureProtocol: '',
    events: Object.freeze([]),
    unsupportedReason: 'No verified live JSON input contract is wired through solve for OpenCode yet.',
    testing: 'The flag should warn and fall back to restart/resume behavior until a live-input runner is implemented.',
  }),
  gemini: Object.freeze({
    tool: 'gemini',
    label: 'Gemini',
    supported: false,
    option: '--auto-input-until-mergeable',
    protocol: 'No verified live JSON input contract is wired through solve for Gemini yet.',
    currentRunner: 'src/gemini.lib.mjs uses a prompt-driven process invocation',
    futureProtocol: '',
    events: Object.freeze([]),
    unsupportedReason: 'No verified live JSON input contract is wired through solve for Gemini yet.',
    testing: 'The flag should warn and fall back to restart/resume behavior until a live-input runner is implemented.',
  }),
  qwen: Object.freeze({
    tool: 'qwen',
    label: 'Qwen',
    supported: false,
    option: '--auto-input-until-mergeable',
    protocol: 'No verified live JSON input contract is wired through solve for Qwen yet.',
    currentRunner: 'src/qwen.lib.mjs uses a prompt-driven process invocation',
    futureProtocol: '',
    events: Object.freeze([]),
    unsupportedReason: 'No verified live JSON input contract is wired through solve for Qwen yet.',
    testing: 'The flag should warn and fall back to restart/resume behavior until a live-input runner is implemented.',
  }),
});

const UNKNOWN_CAPABILITY = tool =>
  Object.freeze({
    tool,
    label: tool,
    supported: false,
    option: '--auto-input-until-mergeable',
    protocol: 'No verified live JSON input contract is wired through solve for this tool yet.',
    currentRunner: 'Unknown or custom solve tool runner',
    futureProtocol: '',
    events: Object.freeze([]),
    unsupportedReason: `No verified live JSON input contract is wired through solve for ${tool}. Add a capability entry after the runner has a long-lived stdin, JSON-RPC, or SDK input channel that accepts new user turns mid-session.`,
    testing: 'The flag should warn and fall back to restart/resume behavior until a live-input runner is implemented.',
  });

export const getLiveInputCapability = tool => {
  const normalizedTool = String(tool || '')
    .trim()
    .toLowerCase();
  return CAPABILITIES[normalizedTool] || UNKNOWN_CAPABILITY(normalizedTool || 'unknown');
};

export const isLiveInputSupported = tool => getLiveInputCapability(tool).supported === true;

export const getLiveInputCapabilityRows = () => Object.values(CAPABILITIES);
