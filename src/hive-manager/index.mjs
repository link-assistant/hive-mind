export { HiveManagerError } from './lib/error.mjs';
export { collectTaskEvidence, groupTaskFailures, groupTaskFailuresBySignature, inspectTaskWindow, inspectTasks } from './task/lib/inspection.mjs';
export { classifyTaskFailure } from '../task-failure-signature.lib.mjs';
export { previewTaskRecordRepair } from './task/lib/record-repair.mjs';
export { applyAutoFix, getAutoFixStatus, previewAutoFix } from './auto-fix/index.mjs';
export { applyIncidentBatch, planIncidentBatch } from './task/lib/incident-batch.mjs';
