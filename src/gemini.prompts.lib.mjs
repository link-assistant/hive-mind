import { promptText, localizePromptConstant } from './prompt-text.lib.mjs';
/**
 * Gemini prompts module
 * Handles building prompts for Google Gemini CLI commands
 */

import { getArchitectureCareSubPrompt } from './architecture-care.prompts.lib.mjs';
import { getUpdateAllDependenciesSubPrompt } from './update-dependencies.prompts.lib.mjs';
import { getReportDependenciesIssuesSubPrompt } from './report-dependencies-issues.prompts.lib.mjs';
import { RESOURCE_AWARE_SOLVER_IDENTITY, getResourceAwareTestingSubPrompt } from './resource-aware-testing.prompts.lib.mjs';
import { getExperimentsExamplesSubPrompt } from './experiments-examples.prompts.lib.mjs';
import { getThinkingPromptInstruction } from './thinking-prompt.lib.mjs';
import { buildWorkLanguageDirective } from './work-language.prompts.lib.mjs';
import { getIssueCompletionSubPrompt, ISSUE_COMPLETION_GOAL } from './issue-completion.prompts.lib.mjs';
import { buildRequestedBaseBranchDirective } from './solve-option-contract.prompts.lib.mjs';
import { buildIssueResearchPrompt } from './deep-analysis.lib.mjs';

/**
 * Build the user prompt for Gemini
 * @param {Object} params - Parameters for building the user prompt
 * @returns {string} The formatted user prompt
 */
export const buildUserPrompt = params => {
  const { issueUrl, issueNumber, prNumber, prUrl, branchName, tempDir, workspaceTmpDir, isContinueMode, forkedRepo, feedbackLines, forkActionsUrl, owner, repo, argv } = params;

  const promptLines = [];

  if (isContinueMode) {
    promptLines.push(promptText('prompt.templates.gemini-prompts.buildUserPrompt.text2', { value1: String(issueNumber ? `https://github.com/${owner}/${repo}/issues/${issueNumber}` : promptText('prompt.templates.gemini-prompts.buildUserPrompt.text1', { prNumber: String(prNumber) })) }));
  } else {
    promptLines.push(promptText('prompt.user.issue.to_solve', { issueUrl: String(issueUrl) }));
  }

  promptLines.push(promptText('prompt.user.prepared_branch', { branchName: String(branchName) }));
  promptLines.push(promptText('prompt.user.prepared.working_directory', { tempDir: String(tempDir) }));

  if (workspaceTmpDir) {
    promptLines.push(promptText('prompt.user.prepared.tmp_directory', { workspaceTmpDir: String(workspaceTmpDir) }));
  }

  if (prUrl) {
    promptLines.push(promptText('prompt.user.prepared.pull_request', { prUrl: String(prUrl) }));
  }

  if (argv && argv.fork && forkedRepo) {
    promptLines.push(promptText('prompt.user.forked_repository', { forkedRepo: String(forkedRepo) }));
    promptLines.push(promptText('prompt.user.original_repository', { owner: String(owner), repo: String(repo) }));

    if (branchName && forkActionsUrl) {
      promptLines.push(promptText('prompt.user.fork.actions_url', { forkActionsUrl: String(forkActionsUrl) }));
    }
  }

  const requestedBaseBranchDirective = buildRequestedBaseBranchDirective(argv);
  if (requestedBaseBranchDirective) {
    promptLines.push(requestedBaseBranchDirective);
  }

  promptLines.push('');

  if (isContinueMode && feedbackLines && feedbackLines.length > 0) {
    feedbackLines.forEach(line => promptLines.push(line));
    promptLines.push('');
  }

  const issueResearchPrompt = buildIssueResearchPrompt({ argv, issueNumber, prNumber }).trim();
  if (issueResearchPrompt) {
    promptLines.push(issueResearchPrompt, '');
  }

  const thinkingPromptInstruction = getThinkingPromptInstruction({ tool: 'gemini', argv });
  if (thinkingPromptInstruction) {
    promptLines.push(thinkingPromptInstruction);
  }

  // Issue #2406: every initial and continuation prompt restates the complete-delivery goal.
  promptLines.push(localizePromptConstant(ISSUE_COMPLETION_GOAL), isContinueMode ? promptText('prompt.user_continue') : promptText('prompt.user_proceed'));

  return promptLines.join('\n') + '\n';
};

/**
 * Build the system prompt for Gemini
 * @param {Object} params - Parameters for building the prompt
 * @returns {string} The formatted system prompt
 */
export const buildSystemPrompt = params => {
  const { owner, repo, issueNumber, prNumber, branchName, workspaceTmpDir, argv, modelSupportsVision, forkedRepo } = params;

  const screenshotRepoPath = argv?.fork && forkedRepo ? forkedRepo : `${owner}/${repo}`;

  let workspaceInstructions = '';
  if (workspaceTmpDir) {
    workspaceInstructions = promptText('prompt.system.templates.gemini-prompts.buildSystemPrompt.text3', { workspaceTmpDir: String(workspaceTmpDir) });
  }

  let ciExamples = '';
  if (workspaceTmpDir) {
    ciExamples = promptText('prompt.system.templates.gemini-prompts.buildSystemPrompt.text4', { owner: String(owner), repo: String(repo), workspaceTmpDir: String(workspaceTmpDir), branchName: String(branchName), prNumber: String(prNumber), issueNumber: String(issueNumber) });
  }

  return promptText('prompt.system.templates.gemini-prompts.buildSystemPrompt.text10', {
    RESOURCE_AWARE_SOLVER_IDENTITY: String(localizePromptConstant(RESOURCE_AWARE_SOLVER_IDENTITY)),
    workspaceInstructions: String(workspaceInstructions),
    owner: String(owner),
    repo: String(repo),
    branchName: String(branchName),
    value8: String(getExperimentsExamplesSubPrompt(argv)),
    issueNumber: String(issueNumber),
    value13: String(argv?.promptCheckSiblingPullRequests !== false ? promptText('prompt.system.templates.gemini-prompts.buildSystemPrompt.text5') : ''),
    value14: String(argv && argv.promptCaseStudies ? promptText('prompt.system.templates.gemini-prompts.buildSystemPrompt.text6', { issueNumber: String(issueNumber) }) : ''),
    prNumber: String(prNumber),
    value27: String(getResourceAwareTestingSubPrompt()),
    value43: String(argv && argv.promptEnsureAllRequirementsAreMet ? promptText('prompt.system.templates.gemini-prompts.buildSystemPrompt.text7') : ''),
    value47: String(argv && argv.promptPlaywrightMcp ? promptText('prompt.system.templates.gemini-prompts.buildSystemPrompt.text8') : ''),
    value48: String(modelSupportsVision ? promptText('prompt.system.templates.gemini-prompts.buildSystemPrompt.text9', { screenshotRepoPath: String(screenshotRepoPath), branchName: String(branchName) }) : ''),
    ciExamples: String(ciExamples),
    value50: String(getArchitectureCareSubPrompt(argv)),
    value51: String(getUpdateAllDependenciesSubPrompt(argv)),
    value52: String(getReportDependenciesIssuesSubPrompt(argv)),
    value53: String(getIssueCompletionSubPrompt(params)),
    value54: String(buildWorkLanguageDirective()),
  });
};

export default {
  buildUserPrompt,
  buildSystemPrompt,
};
