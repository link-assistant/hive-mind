export type HiveManagerErrorCode = 'INVALID_INPUT' | 'TASK_NOT_FOUND' | 'ATTEMPT_NOT_FOUND' | 'TASK_WINDOW_UNAVAILABLE' | 'START_COMMAND_UNAVAILABLE' | 'TASK_RECORDS_UNAVAILABLE' | 'DOCKER_INSPECTION_FAILED';

export class HiveManagerError extends Error {
  constructor(code: HiveManagerErrorCode, message: string);
  readonly code: HiveManagerErrorCode;
}

export interface TaskAttemptRecord {
  status?: string;
  exitCode?: number | null;
  startedAt?: string | null;
  endTime?: string | null;
  finishedAt?: string | null;
  logOffset?: number | null;
  command?: string;
  oomKilled?: boolean;
  memoryExhausted?: boolean;
}

export interface TaskRecord extends TaskAttemptRecord {
  uuid: string;
  startTime?: string | null;
  paused?: boolean;
  exitReason?: string | null;
  logPath?: string | null;
  options?: { isolated?: string; resumeCount?: number | string; recoveryAttempts?: number | string };
  attempt?: { number?: number; startedAt?: string | null; logOffset?: number | null };
  attemptHistory?: readonly (TaskAttemptRecord & { number: number })[];
}

export interface TaskReportOptions {
  limit?: number;
}

export interface TaskReport {
  counts: { running: number; paused: number; succeeded: number; failed: number; unknown: number };
  failures: { id: string; exitCode: number | null; finishedAt: string | null; memoryExhausted: boolean; reason: string | null }[];
}

export interface TaskFailureGroups {
  groups: {
    backend: 'docker' | 'screen' | 'tmux' | 'ssh' | 'local';
    kind: string;
    exitCode: number;
    signature?: TaskFailureSignature;
    count: number;
    latest: { id: string; attempt: number; finishedAt: string } | null;
  }[];
}

export type TaskFailureSignature = 'alias-127' | 'codex-no-rollout' | 'stream-close-timeout' | 'codex-oom' | 'repository-empty' | 'repository-permission' | 'checkout-dirty' | 'auto-restart-limit' | 'no-progress' | 'same-ci-failure' | 'authentication' | 'codex-max-output-tokens' | 'tool-content-policy' | 'tool-failure';

export interface TaskSelection {
  uuid: string;
  attempt?: number;
}

export interface TaskWindow {
  startedAt: string;
  /** Null while the selected attempt is running. */
  finishedAt: string | null;
}

export interface TaskEvidence {
  id: string;
  attempt: number;
  status?: string;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string;
  evidence: {
    available: boolean;
    signature?: TaskFailureSignature;
    bounded?: boolean;
    turns?: number;
    noChanges?: boolean;
    possibleFalseSuccess?: boolean;
    retries?: number;
    reconnects?: number;
    repeatedCommands?: number[];
    repeatedToolCalls?: number[];
    repeatedMessages?: number[];
  };
}

export interface TaskRecordRepairOptions {
  /** Complete execution UUIDs. An empty list considers every record. */
  uuids?: readonly string[];
  /** Defaults to START_APP_FOLDER or ~/.start-command. */
  appFolder?: string;
}

export interface TaskRecordRepairPreview {
  mode: 'preview';
  outcomes: ({ uuid: string; state: 'eligible'; container: string } | { uuid: string; state: 'ambiguous' })[];
}

export function inspectTasks(tasks: readonly TaskRecord[], options?: TaskReportOptions): TaskReport;
export function groupTaskFailures(tasks: readonly TaskRecord[], options?: TaskReportOptions): TaskFailureGroups;
export function groupTaskFailuresBySignature(tasks: readonly TaskRecord[], options?: TaskReportOptions): Promise<TaskFailureGroups>;
export function classifyTaskFailure(attempt: TaskAttemptRecord, text?: string): TaskFailureSignature | undefined;
export function inspectTaskWindow(tasks: readonly TaskRecord[], selection: TaskSelection): TaskWindow;
export function collectTaskEvidence(tasks: readonly TaskRecord[], selection: TaskSelection): Promise<TaskEvidence>;
export function previewTaskRecordRepair(options?: TaskRecordRepairOptions): Promise<TaskRecordRepairPreview>;
