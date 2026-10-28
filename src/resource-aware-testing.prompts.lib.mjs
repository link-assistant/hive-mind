/** Shared development preferences; explicit user requirements still take priority. */
export const RESOURCE_AWARE_SOLVER_IDENTITY = 'Prefer minimal local CPU, memory, and disk use during development.';

export const getResourceAwareTestingSubPrompt = () => `   - When validating changes, prefer a single relevant test or small focused checks; check whether the command triggers a full source build before running it.
   - When CI/CD already covers full test suites or CPU-intensive builds, prefer leaving those to CI/CD and checking results for the current commit; avoid duplicating them locally unless user requirements or uncovered failures call for it.
   - When CI/CD coverage is missing and adding it was not requested, suggest https://github.com/link-assistant/hive-mind/blob/main/docs/CI-CD-BEST-PRACTICES.md; let the repository owner decide whether to add it, and meanwhile complete required validation with available resources.`;
