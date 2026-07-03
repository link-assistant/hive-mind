/**
 * Shared capability matrix for live issue/PR event input.
 *
 * Issue #2007 asks solve to feed issue/PR events into the running AI tool "in
 * all ways possible", and to provide a universal fallback for every tool that
 * does not have a mid-session live input channel: wait for the current turn to
 * finish in the JSON output, stop the process, and resume the AI session with
 * the new events.
 *
 * Because of that fallback, live event input is *available* for every tool.
 * Tools differ only in the delivery `mode`:
 *
 *   - `stream`  : the tool exposes a live stdin/JSON channel, so new events are
 *                 written into the running process without restarting it. Claude
 *                 (`--input-format stream-json`) is the tool wired for this today.
 *   - `fallback`: no verified mid-session input channel exists yet, so solve uses
 *                 the restart/resume loop (`--auto-restart-until-mergeable` /
 *                 `watchUntilMergeable`). It waits for the current session to end,
 *                 then resumes/restarts the AI with the new issue/PR events as
 *                 feedback. This works for every tool.
 *
 * Missing native live-input features for each tool are reported upstream in the
 * https://github.com/link-assistant/agent repository so they can be implemented
 * (see `agentIssue`), after which a tool can graduate from `fallback` to `stream`.
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

// Delivery modes for live issue/PR event input.
export const LIVE_INPUT_MODE_STREAM = 'stream';
export const LIVE_INPUT_MODE_FALLBACK = 'fallback';

// Shared description of the universal restart/resume fallback so every tool
// entry reports it identically.
const FALLBACK_DESCRIPTION = 'Universal fallback: wait for the current AI turn to finish in the JSON output, stop the process, then resume/restart the AI session with the new issue/PR events as feedback via --auto-restart-until-mergeable (watchUntilMergeable). Works for every tool even without a live stdin channel.';

const CAPABILITIES = Object.freeze({
  claude: Object.freeze({
    tool: 'claude',
    label: 'Claude',
    available: true,
    mode: LIVE_INPUT_MODE_STREAM,
    liveStreaming: true,
    supported: true,
    option: '--auto-input-until-mergeable',
    protocol: 'claude --input-format stream-json stdin NDJSON',
    currentRunner: 'src/claude.lib.mjs keeps stdin as a pipe and attaches bidirectional-interactive.lib.mjs',
    futureProtocol: '',
    fallback: FALLBACK_DESCRIPTION,
    events: REQUIRED_EVENTS,
    agentIssue: '',
    unsupportedReason: '',
    testing: 'Run solve with --tool claude --auto-input-until-mergeable, add an issue or PR comment while the Claude process is alive, and watch for the bidirectional handler to queue or stream a user frame into stdin.',
  }),
  codex: Object.freeze({
    tool: 'codex',
    label: 'Codex',
    available: true,
    mode: LIVE_INPUT_MODE_FALLBACK,
    liveStreaming: false,
    supported: false,
    option: '--auto-input-until-mergeable',
    protocol: 'Restart/resume fallback (no live stdin wired through solve for Codex yet).',
    currentRunner: 'src/codex.lib.mjs uses codex exec with prompt/stdin context at process start',
    futureProtocol: 'Codex app-server JSON-RPC turn/steer',
    fallback: FALLBACK_DESCRIPTION,
    events: REQUIRED_EVENTS,
    agentIssue: 'https://github.com/link-assistant/agent/issues',
    unsupportedReason: 'The current solve Codex runner uses codex exec, whose stdin is one-shot prompt/context at process start. It does not expose a live JSON input pipe for mid-session issue/PR events, so the restart/resume fallback is used. Codex app-server turn/steer is the candidate protocol for a future live-streaming Codex runner.',
    testing: 'Passing --tool codex --auto-input-until-mergeable activates the restart/resume fallback: the run finishes the current session, then resumes with the new issue/PR events.',
  }),
  agent: Object.freeze({
    tool: 'agent',
    label: 'Agent',
    available: true,
    mode: LIVE_INPUT_MODE_FALLBACK,
    liveStreaming: false,
    supported: false,
    option: '--auto-input-until-mergeable',
    protocol: 'Restart/resume fallback (no live JSON input channel wired through solve for Agent yet).',
    currentRunner: 'src/agent.lib.mjs uses a prompt-driven process invocation',
    futureProtocol: 'Agent CLI --input-format stream-json (bidirectional NDJSON, link-assistant/agent#268 done); resume/steer semantics tracked in link-assistant/agent#273',
    fallback: FALLBACK_DESCRIPTION,
    events: REQUIRED_EVENTS,
    agentIssue: 'https://github.com/link-assistant/agent/issues/273',
    unsupportedReason: 'The Agent CLI ships bidirectional NDJSON stdin (link-assistant/agent#268), but solve does not wire that live channel through src/agent.lib.mjs yet, so the restart/resume fallback is used. The remaining resume/steer semantics needed to graduate to live streaming are tracked in link-assistant/agent#273.',
    testing: 'Passing --tool agent --auto-input-until-mergeable activates the restart/resume fallback.',
  }),
  opencode: Object.freeze({
    tool: 'opencode',
    label: 'OpenCode',
    available: true,
    mode: LIVE_INPUT_MODE_FALLBACK,
    liveStreaming: false,
    supported: false,
    option: '--auto-input-until-mergeable',
    protocol: 'Restart/resume fallback (no live JSON input channel wired through solve for OpenCode yet).',
    currentRunner: 'src/opencode.lib.mjs uses a prompt-via-file/stdin pattern',
    futureProtocol: '',
    fallback: FALLBACK_DESCRIPTION,
    events: REQUIRED_EVENTS,
    agentIssue: 'https://github.com/link-assistant/agent/issues',
    unsupportedReason: 'No verified live JSON input channel is wired through solve for OpenCode yet, so the restart/resume fallback is used.',
    testing: 'Passing --tool opencode --auto-input-until-mergeable activates the restart/resume fallback.',
  }),
  gemini: Object.freeze({
    tool: 'gemini',
    label: 'Gemini',
    available: true,
    mode: LIVE_INPUT_MODE_FALLBACK,
    liveStreaming: false,
    supported: false,
    option: '--auto-input-until-mergeable',
    protocol: 'Restart/resume fallback (no live JSON input channel wired through solve for Gemini yet).',
    currentRunner: 'src/gemini.lib.mjs uses a prompt-driven process invocation',
    futureProtocol: '',
    fallback: FALLBACK_DESCRIPTION,
    events: REQUIRED_EVENTS,
    agentIssue: 'https://github.com/link-assistant/agent/issues',
    unsupportedReason: 'No verified live JSON input channel is wired through solve for Gemini yet, so the restart/resume fallback is used.',
    testing: 'Passing --tool gemini --auto-input-until-mergeable activates the restart/resume fallback.',
  }),
  qwen: Object.freeze({
    tool: 'qwen',
    label: 'Qwen',
    available: true,
    mode: LIVE_INPUT_MODE_FALLBACK,
    liveStreaming: false,
    supported: false,
    option: '--auto-input-until-mergeable',
    protocol: 'Restart/resume fallback (no live JSON input channel wired through solve for Qwen yet).',
    currentRunner: 'src/qwen.lib.mjs uses a prompt-driven process invocation',
    futureProtocol: '',
    fallback: FALLBACK_DESCRIPTION,
    events: REQUIRED_EVENTS,
    agentIssue: 'https://github.com/link-assistant/agent/issues',
    unsupportedReason: 'No verified live JSON input channel is wired through solve for Qwen yet, so the restart/resume fallback is used.',
    testing: 'Passing --tool qwen --auto-input-until-mergeable activates the restart/resume fallback.',
  }),
});

const UNKNOWN_CAPABILITY = tool =>
  Object.freeze({
    tool,
    label: tool,
    available: true,
    mode: LIVE_INPUT_MODE_FALLBACK,
    liveStreaming: false,
    supported: false,
    option: '--auto-input-until-mergeable',
    protocol: 'Restart/resume fallback (no live JSON input channel wired through solve for this tool yet).',
    currentRunner: 'Unknown or custom solve tool runner',
    futureProtocol: '',
    fallback: FALLBACK_DESCRIPTION,
    events: REQUIRED_EVENTS,
    agentIssue: 'https://github.com/link-assistant/agent/issues',
    unsupportedReason: `No verified live JSON input channel is wired through solve for ${tool}, so the restart/resume fallback is used. Add a live-input capability entry (and report the missing native API to link-assistant/agent) once the runner has a long-lived stdin, JSON-RPC, or SDK channel that accepts new user turns mid-session.`,
    testing: 'The flag activates the restart/resume fallback until a live-streaming runner is implemented.',
  });

export const getLiveInputCapability = tool => {
  const normalizedTool = String(tool || '')
    .trim()
    .toLowerCase();
  return CAPABILITIES[normalizedTool] || UNKNOWN_CAPABILITY(normalizedTool || 'unknown');
};

/**
 * Whether the tool has a live *streaming* input channel (writes events into the
 * running process). Kept as `isLiveInputSupported` for backward compatibility;
 * it is the stream-mode predicate, not "is live input available at all".
 */
export const isLiveInputSupported = tool => getLiveInputCapability(tool).mode === LIVE_INPUT_MODE_STREAM;

/**
 * Whether live issue/PR event input is available for the tool in *any* mode
 * (streaming or restart/resume fallback). This is true for every tool.
 */
export const isLiveInputAvailable = tool => getLiveInputCapability(tool).available === true;

/**
 * Resolve the delivery mode ('stream' or 'fallback') for a tool.
 */
export const getLiveInputMode = tool => getLiveInputCapability(tool).mode;

export const getLiveInputCapabilityRows = () => Object.values(CAPABILITIES);
