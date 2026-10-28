import { promptText, localizePromptConstant } from './prompt-text.lib.mjs';
/**
 * Claude prompts module
 * Handles building prompts for Claude commands
 */

import { getArchitectureCareSubPrompt } from './architecture-care.prompts.lib.mjs';
import { getUpdateAllDependenciesSubPrompt } from './update-dependencies.prompts.lib.mjs';
import { getReportDependenciesIssuesSubPrompt } from './report-dependencies-issues.prompts.lib.mjs';
import { getHandoffSubPrompt } from './handoff.prompts.lib.mjs';
import { RESOURCE_AWARE_SOLVER_IDENTITY, getResourceAwareTestingSubPrompt } from './resource-aware-testing.prompts.lib.mjs';
import { getExperimentsExamplesSubPrompt } from './experiments-examples.prompts.lib.mjs';
import { primaryModelNames } from './models/index.mjs';
import { getThinkingPromptInstruction } from './thinking-prompt.lib.mjs';
import { buildWorkLanguageDirective } from './work-language.prompts.lib.mjs';
import { getIssueCompletionSubPrompt, ISSUE_COMPLETION_GOAL } from './issue-completion.prompts.lib.mjs';
import { buildRequestedBaseBranchDirective } from './solve-option-contract.prompts.lib.mjs';
import { buildIssueResearchPrompt } from './deep-analysis.lib.mjs';

/**
 * Build the user prompt for Claude
 * @param {Object} params - Parameters for building the user prompt
 * @returns {string} The formatted user prompt
 */
export const buildUserPrompt = params => {
  const { issueUrl, issueNumber, prNumber, prUrl, branchName, tempDir, workspaceTmpDir, isContinueMode, forkedRepo, feedbackLines, owner, repo, argv, contributingGuidelines, claudeVersion } = params;

  if (argv?.minimalRestartContext && argv.resume) {
    const lines = feedbackLines && feedbackLines.length > 0 ? feedbackLines : [promptText('prompt.templates.claude-prompts.buildUserPrompt.text1')];
    return `${lines.join('\n')}\n${localizePromptConstant(ISSUE_COMPLETION_GOAL)}\n`;
  }

  const promptLines = [];

  // Issue or PR reference
  if (isContinueMode) {
    promptLines.push(promptText('prompt.templates.claude-prompts.buildUserPrompt.text3', { value1: String(issueNumber ? `https://github.com/${owner}/${repo}/issues/${issueNumber}` : promptText('prompt.templates.claude-prompts.buildUserPrompt.text2', { prNumber: String(prNumber) })) }));
  } else {
    promptLines.push(promptText('prompt.user.issue.to_solve', { issueUrl: String(issueUrl) }));
  }

  // Basic info
  promptLines.push(promptText('prompt.user.prepared_branch', { branchName: String(branchName) }));
  promptLines.push(promptText('prompt.user.prepared.working_directory', { tempDir: String(tempDir) }));

  // Workspace tmp directory for logs and temp files (when --enable-workspaces is used)
  if (workspaceTmpDir) {
    promptLines.push(promptText('prompt.user.prepared.tmp_directory', { workspaceTmpDir: String(workspaceTmpDir) }));
  }

  // PR info if available
  if (prUrl) {
    promptLines.push(promptText('prompt.user.prepared.pull_request', { prUrl: String(prUrl) }));
  }

  // Fork info if applicable
  if (argv && argv.fork && forkedRepo) {
    promptLines.push(promptText('prompt.user.forked_repository', { forkedRepo: String(forkedRepo) }));
    promptLines.push(promptText('prompt.user.original_repository', { owner: String(owner), repo: String(repo) }));

    // Check for GitHub Actions on fork and add link if workflows exist
    if (branchName && params.forkActionsUrl) {
      promptLines.push(promptText('prompt.templates.claude-prompts.buildUserPrompt.text4', { value1: String(params.forkActionsUrl) }));
    }
  }

  const requestedBaseBranchDirective = buildRequestedBaseBranchDirective(argv);
  if (requestedBaseBranchDirective) {
    promptLines.push(requestedBaseBranchDirective);
  }

  // Add contributing guidelines if available
  if (contributingGuidelines) {
    promptLines.push('');
    promptLines.push(contributingGuidelines);
  }

  // Add blank line
  promptLines.push('');

  // Add feedback info if in continue mode and there are feedback items
  if (isContinueMode && feedbackLines && feedbackLines.length > 0) {
    // Add each feedback line directly
    feedbackLines.forEach(line => promptLines.push(line));
    promptLines.push('');
  }

  const issueResearchPrompt = buildIssueResearchPrompt({ argv, issueNumber, prNumber }).trim();
  if (issueResearchPrompt) {
    promptLines.push(issueResearchPrompt, '');
  }

  const thinkingPromptInstruction = getThinkingPromptInstruction({ tool: 'claude', argv, claudeVersion });
  if (thinkingPromptInstruction) {
    promptLines.push(thinkingPromptInstruction);
  }

  // Final instruction
  // Issue #2406: every initial and continuation prompt restates the complete-delivery goal.
  promptLines.push(localizePromptConstant(ISSUE_COMPLETION_GOAL), isContinueMode ? promptText('prompt.user_continue') : promptText('prompt.user_proceed'));

  // Build the final prompt with trailing newline for POSIX compliance
  return promptLines.join('\n') + '\n';
};

/**
 * Build the system prompt for Claude - simplified to avoid shell escaping issues
 * @param {Object} params - Parameters for building the prompt
 * @returns {string} The formatted system prompt
 */
export const buildSystemPrompt = params => {
  const { owner, repo, issueNumber, prNumber, branchName, workspaceTmpDir, argv, modelSupportsVision, forkedRepo } = params;

  if (argv?.minimalRestartContext && argv.resume) {
    return '';
  }

  // When in fork mode, screenshots are pushed to the fork, not the original repo
  const screenshotRepoPath = argv?.fork && forkedRepo ? forkedRepo : `${owner}/${repo}`;

  // Build workspace-specific instructions and examples
  let workspaceInstructions = '';
  if (workspaceTmpDir) {
    workspaceInstructions = promptText('prompt.system.templates.claude-prompts.buildSystemPrompt.text5', { workspaceTmpDir: String(workspaceTmpDir) });
  }

  // Build CI command examples with workspace tmp paths
  let ciExamples = '';
  if (workspaceTmpDir) {
    ciExamples = promptText('prompt.system.templates.claude-prompts.buildSystemPrompt.text6', { owner: String(owner), repo: String(repo), workspaceTmpDir: String(workspaceTmpDir), branchName: String(branchName), prNumber: String(prNumber), issueNumber: String(issueNumber) });
  }

  // Use backticks for jq commands to avoid quote escaping issues
  return promptText('prompt.system.templates.claude-prompts.buildSystemPrompt.text17', {
    RESOURCE_AWARE_SOLVER_IDENTITY: String(localizePromptConstant(RESOURCE_AWARE_SOLVER_IDENTITY)),
    workspaceInstructions: String(workspaceInstructions),
    value3: String(argv && argv.promptIssueReporting ? promptText('prompt.system.templates.claude-prompts.buildSystemPrompt.text7', { owner: String(owner), repo: String(repo) }) : ''),
    owner: String(owner),
    repo: String(repo),
    branchName: String(branchName),
    value9: String(getExperimentsExamplesSubPrompt(argv)),
    issueNumber: String(issueNumber),
    value14: String(argv && argv.promptExploreSubAgent ? promptText('prompt.system.templates.claude-prompts.buildSystemPrompt.text8') : ''),
    value15: String(argv?.promptCheckSiblingPullRequests !== false ? promptText('prompt.system.templates.claude-prompts.buildSystemPrompt.text9') : ''),
    prNumber: String(prNumber),
    value28: String(argv && argv.promptGeneralPurposeSubAgent ? promptText('prompt.system.templates.claude-prompts.buildSystemPrompt.text10') : ''),
    value29: String(argv && argv.promptCaseStudies ? promptText('prompt.system.templates.claude-prompts.buildSystemPrompt.text11', { issueNumber: String(issueNumber) }) : ''),
    value30: String(getResourceAwareTestingSubPrompt()),
    value39: String(argv && argv.promptEnsureAllRequirementsAreMet ? promptText('prompt.system.templates.claude-prompts.buildSystemPrompt.text12') : ''),
    value40: String(argv && argv.promptPlaywrightMcp ? promptText('prompt.system.templates.claude-prompts.buildSystemPrompt.text13') : ''),
    value41: String(argv && argv.promptPlanSubAgent ? promptText('prompt.system.templates.claude-prompts.buildSystemPrompt.text14') : ''),
    value42: String(argv && argv.promptSubagentsViaAgentCommander && argv.agentCommanderInstalled ? promptText('prompt.system.templates.claude-prompts.buildSystemPrompt.text15', { value1: String([...new Set(Object.values(primaryModelNames).flat())].slice(0, 5).join(', ')) }) : ''),
    value43: String(modelSupportsVision ? promptText('prompt.system.templates.claude-prompts.buildSystemPrompt.text16', { screenshotRepoPath: String(screenshotRepoPath), branchName: String(branchName) }) : ''),
    ciExamples: String(ciExamples),
    value45: String(getArchitectureCareSubPrompt(argv)),
    value46: String(getUpdateAllDependenciesSubPrompt(argv)),
    value47: String(getReportDependenciesIssuesSubPrompt(argv)),
    value48: String(getHandoffSubPrompt(argv)),
    value49: String(getIssueCompletionSubPrompt(params)),
    value50: String(buildWorkLanguageDirective()),
  });
};

// Export all functions as default object too
export default {
  buildUserPrompt,
  buildSystemPrompt,
};
