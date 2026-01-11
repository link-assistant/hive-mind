#!/usr/bin/env node
// GitHub-related utility functions
// Check if use is already defined (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
// Use command-stream for consistent $ behavior
const { $ } = await use('command-stream');
// Import log and maskToken from general lib
import { log, maskToken, cleanErrorMessage } from './lib.mjs';
import { reportError } from './sentry.lib.mjs';
import { githubLimits, timeouts } from './config.lib.mjs';
// Import batch operations from separate module
import { batchCheckPullRequestsForIssues as batchCheckPRs, batchCheckArchivedRepositories as batchCheckArchived } from './github.batch.lib.mjs';
// Import token sanitization from dedicated module (Issue #1037 fix)
import { isSafeToken, isHexInSafeContext, getGitHubTokensFromFiles, getGitHubTokensFromCommand, sanitizeLogContent } from './token-sanitization.lib.mjs';
// Re-export token sanitization functions for backward compatibility
export { isSafeToken, isHexInSafeContext, getGitHubTokensFromFiles, getGitHubTokensFromCommand, sanitizeLogContent };
// Import log upload function from separate module
import { uploadLogWithGhUploadLog } from './log-upload.lib.mjs';

/**
 * Build cost estimation string for log comments
 * @param {number|null} totalCostUSD - Public pricing estimate
 * @param {number|null} anthropicTotalCostUSD - Cost calculated by Anthropic (Claude-specific)
 * @param {Object|null} pricingInfo - Pricing info from agent tool
 * @returns {string} Formatted cost info string for markdown (empty if no data available)
 */
const buildCostInfoString = (totalCostUSD, anthropicTotalCostUSD, pricingInfo) => {
  // Issue #1015: Don't show cost section when all values are unknown (clutters output)
  const hasPublic = totalCostUSD !== null && totalCostUSD !== undefined;
  const hasAnthropic = anthropicTotalCostUSD !== null && anthropicTotalCostUSD !== undefined;
  const hasPricing = pricingInfo && (pricingInfo.modelName || pricingInfo.tokenUsage || pricingInfo.isFreeModel);
  if (!hasPublic && !hasAnthropic && !hasPricing) return '';
  let costInfo = '\n\n💰 **Cost estimation:**';
  if (pricingInfo?.modelName) {
    costInfo += `\n- Model: ${pricingInfo.modelName}`;
    if (pricingInfo.provider) costInfo += `\n- Provider: ${pricingInfo.provider}`;
  }
  if (hasPublic) {
    costInfo += pricingInfo?.isFreeModel ? '\n- Public pricing estimate: $0.00 (Free model)' : `\n- Public pricing estimate: $${totalCostUSD.toFixed(6)} USD`;
  } else if (hasPricing) costInfo += '\n- Public pricing estimate: unknown';
  if (pricingInfo?.tokenUsage) {
    const u = pricingInfo.tokenUsage;
    let tokenInfo = `\n- Token usage: ${u.inputTokens?.toLocaleString() || 0} input, ${u.outputTokens?.toLocaleString() || 0} output`;
    if (u.reasoningTokens > 0) tokenInfo += `, ${u.reasoningTokens.toLocaleString()} reasoning`;
    if (u.cacheReadTokens > 0 || u.cacheWriteTokens > 0) tokenInfo += `, ${u.cacheReadTokens?.toLocaleString() || 0} cache read, ${u.cacheWriteTokens?.toLocaleString() || 0} cache write`;
    costInfo += tokenInfo;
  }
  if (hasAnthropic) {
    costInfo += `\n- Calculated by Anthropic: $${anthropicTotalCostUSD.toFixed(6)} USD`;
    if (hasPublic) {
      const diff = anthropicTotalCostUSD - totalCostUSD;
      const pct = totalCostUSD > 0 ? (diff / totalCostUSD) * 100 : 0;
      costInfo += `\n- Difference: $${diff.toFixed(6)} (${pct > 0 ? '+' : ''}${pct.toFixed(2)}%)`;
    }
  }
  return costInfo;
};

// Helper function to mask GitHub tokens (alias for backward compatibility)
export const maskGitHubToken = maskToken;
// Escape ``` in logs for safe markdown embedding (replaces with \`\`\` to prevent code block closure)
export const escapeCodeBlocksInLog = logContent => logContent.replace(/```/g, '\\`\\`\\`');
// Helper function to check if a file exists in a GitHub branch
export const checkFileInBranch = async (owner, repo, fileName, branchName) => {
  const { $ } = await use('command-stream');

  try {
    // Use GitHub CLI to check if file exists in the branch
    const result = await $`gh api repos/${owner}/${repo}/contents/${fileName}?ref=${branchName}`;
    return result.code === 0;
  } catch (error) {
    // File doesn't exist or access error - this is expected behavior
    if (global.verboseMode) {
      reportError(error, {
        context: 'check_file_in_branch',
        level: 'debug',
        owner,
        repo,
        fileName,
        branchName,
      });
    }
    return false;
  }
};
// Helper function to check GitHub permissions and warn about missing scopes
export const checkGitHubPermissions = async () => {
  const { $ } = await use('command-stream');
  try {
    await log('\n🔐 Checking GitHub authentication and permissions...');
    // Get auth status including token scopes
    const authStatusResult = await $`gh auth status 2>&1`;
    const authOutput = authStatusResult.stdout.toString() + authStatusResult.stderr.toString();
    if (authStatusResult.code !== 0 || authOutput.includes('not logged into any GitHub hosts')) {
      await log('❌ GitHub authentication error: Not logged in', { level: 'error' });
      await log('   To fix this, run: gh auth login', { level: 'error' });
      return false;
    }
    await log('✅ GitHub authentication: OK');
    // Parse the auth status output to extract token scopes
    const scopeMatch = authOutput.match(/Token scopes:\s*(.+)/);
    if (!scopeMatch) {
      await log('⚠️  Warning: Could not determine token scopes from auth status', { level: 'warning' });
      return true; // Continue despite not being able to check scopes
    }
    // Extract individual scopes from the format: 'scope1', 'scope2', 'scope3'
    const scopeString = scopeMatch[1];
    const scopes = scopeString.match(/'([^']+)'/g)?.map(s => s.replace(/'/g, '')) || [];
    await log(`📋 Token scopes: ${scopes.join(', ')}`);
    // Check for important scopes and warn if missing
    const warnings = [];
    if (!scopes.includes('workflow')) {
      warnings.push({
        scope: 'workflow',
        issue: 'Cannot push changes to .github/workflows/ directory',
        solution: 'Run: gh auth refresh -h github.com -s workflow',
      });
    }
    if (!scopes.includes('repo')) {
      warnings.push({
        scope: 'repo',
        issue: 'Limited repository access (may not be able to create PRs or push to private repos)',
        solution: 'Run: gh auth refresh -h github.com -s repo',
      });
    }
    // Display warnings
    if (warnings.length > 0) {
      await log('\n⚠️  Permission warnings detected:', { level: 'warning' });
      for (const warning of warnings) {
        await log(`\n   Missing scope: '${warning.scope}'`, { level: 'warning' });
        await log(`   Impact: ${warning.issue}`, { level: 'warning' });
        await log(`   Solution: ${warning.solution}`, { level: 'warning' });
      }
      await log('\n   💡 You can continue, but some operations may fail due to insufficient permissions.', {
        level: 'warning',
      });
      await log("   💡 To avoid issues, it's recommended to refresh your authentication with the missing scopes.", {
        level: 'warning',
      });
    } else {
      await log('✅ All required permissions: Available');
    }
    return true;
  } catch (error) {
    await log(`⚠️  Warning: Could not check GitHub permissions: ${maskToken(error.message || error.toString())}`, {
      level: 'warning',
    });
    await log('   Continuing anyway, but some operations may fail if permissions are insufficient', {
      level: 'warning',
    });
    return true; // Continue despite permission check failure
  }
};
/**
 * Check if the current user has write (push) permissions to a specific repository
 * This helps fail early before wasting AI tokens when --fork option is not used
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {Object} options - Configuration options
 * @param {boolean} options.useFork - Whether --fork flag is enabled
 * @param {string} options.issueUrl - Original issue URL for error messages
 * @returns {Promise<boolean>} True if has write access OR fork mode is enabled, false otherwise
 */
export const checkRepositoryWritePermission = async (owner, repo, options = {}) => {
  const { useFork = false, issueUrl = '' } = options;
  // Skip check if fork mode is enabled - user will work in their own fork
  if (useFork) {
    await log('✅ Repository access check: Skipped (fork mode enabled)', { verbose: true });
    return true;
  }
  try {
    await log('🔍 Checking repository write permissions...');
    // Use GitHub API to check repository permissions
    const permResult = await $`gh api repos/${owner}/${repo} --jq .permissions`;
    if (permResult.code !== 0) {
      // API call failed - might be a private repo or network issue
      const errorOutput = (permResult.stderr ? permResult.stderr.toString() : '') + (permResult.stdout ? permResult.stdout.toString() : '');
      // If it's a 404, the repo doesn't exist or we don't have read access
      if (errorOutput.includes('404') || errorOutput.includes('Not Found')) {
        await log('❌ Repository not found or no access', { level: 'error' });
        await log(`   Repository: ${owner}/${repo}`, { level: 'error' });
        return false;
      }
      // For other errors, warn but continue (repo might still be accessible)
      await log(`⚠️  Warning: Could not check repository permissions: ${cleanErrorMessage(errorOutput)}`, {
        level: 'warning',
      });
      return true;
    }
    // Parse permissions
    const permissions = JSON.parse(permResult.stdout.toString().trim());
    // Check if user has push (write) access
    if (permissions.push === true || permissions.admin === true || permissions.maintain === true) {
      await log('✅ Repository write access: Confirmed');
      return true;
    }
    // No write access - provide helpful error message
    await log('');
    await log('❌ NO WRITE ACCESS TO REPOSITORY', { level: 'error' });
    await log('');
    await log(`   Repository: ${owner}/${repo}`, { level: 'error' });
    await log(`   Your permissions: ${JSON.stringify(permissions)}`, { level: 'error' });
    await log('');
    await log('   ⚠️  You cannot push changes to this repository.', { level: 'error' });
    await log('   This would waste AI tokens processing a solution that cannot be uploaded.', { level: 'error' });
    await log('');
    await log('   📋 SOLUTIONS:', { level: 'error' });
    await log('');
    await log('   ✅ RECOMMENDED: Use the --fork option', { level: 'error' });
    await log('      This will automatically:', { level: 'error' });
    await log('      • Create or use your existing fork', { level: 'error' });
    await log('      • Push changes to your fork', { level: 'error' });
    await log('      • Create a PR from your fork to the original repository', { level: 'error' });
    await log('');
    // Get current user to suggest their fork
    try {
      const userResult = await $`gh api user --jq .login`;
      if (userResult.code === 0) {
        const currentUser = userResult.stdout.toString().trim();
        await log('      Run this command:', { level: 'error' });
        await log(`      solve ${issueUrl} --fork`, { level: 'error' });
        await log('');
        await log(`      Your fork will be: ${currentUser}/${repo}`, { level: 'error' });
      }
    } catch {
      // Ignore user lookup errors
    }
    await log('');
    await log('   Alternative: Request collaborator access', { level: 'error' });
    await log('      Ask the repository owner to add you as a collaborator:', { level: 'error' });
    await log(`      https://github.com/${owner}/${repo}/settings/access`, { level: 'error' });
    await log('');
    return false;
  } catch (error) {
    reportError(error, {
      context: 'check_repository_write_permission',
      owner,
      repo,
      operation: 'verify_write_access',
    });
    // On unexpected errors, warn but allow to continue (better than blocking)
    await log(`⚠️  Warning: Error checking repository permissions: ${cleanErrorMessage(error)}`, { level: 'warning' });
    await log('   Continuing anyway - will fail later if permissions are insufficient', { level: 'warning' });
    return true;
  }
};
/**
 * Check if maintainer can modify (push to) a pull request from a fork
 * This checks the 'maintainer_can_modify' field which indicates if the PR author
 * has enabled "Allow edits by maintainers" checkbox
 * @param {string} owner - Repository owner (upstream repo)
 * @param {string} repo - Repository name
 * @param {number} prNumber - Pull request number
 * @returns {Promise<{canModify: boolean, forkOwner: string|null, forkRepo: string|null}>}
 */
export const checkMaintainerCanModifyPR = async (owner, repo, prNumber) => {
  try {
    await log('🔍 Checking if maintainer can modify PR...', { verbose: true });
    // Use GitHub API to check PR details including maintainer_can_modify
    const prResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber} --jq '{maintainer_can_modify: .maintainer_can_modify, head: .head}'`;
    if (prResult.code !== 0) {
      const errorOutput = (prResult.stderr ? prResult.stderr.toString() : '') + (prResult.stdout ? prResult.stdout.toString() : '');
      await log(`⚠️  Warning: Could not check maintainer_can_modify: ${cleanErrorMessage(errorOutput)}`, {
        level: 'warning',
      });
      return { canModify: false, forkOwner: null, forkRepo: null };
    }
    // Parse PR data
    const prData = JSON.parse(prResult.stdout.toString().trim());
    const canModify = prData.maintainer_can_modify === true;
    const forkOwner = prData.head?.user?.login || prData.head?.repo?.owner?.login || null;
    const forkRepo = prData.head?.repo?.name || null;
    if (canModify) {
      await log('✅ Maintainer can modify: YES (contributor enabled "Allow edits by maintainers")', { verbose: true });
      if (forkOwner && forkRepo) {
        await log(`   Fork: ${forkOwner}/${forkRepo}`, { verbose: true });
      }
    } else {
      await log('ℹ️  Maintainer can modify: NO (contributor has not enabled "Allow edits by maintainers")', {
        verbose: true,
      });
    }
    return { canModify, forkOwner, forkRepo };
  } catch (error) {
    reportError(error, {
      context: 'check_maintainer_can_modify_pr',
      owner,
      repo,
      prNumber,
      operation: 'check_maintainer_modify_permission',
    });
    await log(`⚠️  Warning: Error checking maintainer_can_modify: ${cleanErrorMessage(error)}`, { level: 'warning' });
    return { canModify: false, forkOwner: null, forkRepo: null };
  }
};
/**
 * Post a comment on a PR asking the contributor to enable "Allow edits by maintainers"
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - Pull request number
 * @returns {Promise<boolean>} True if comment was posted successfully
 */
export const requestMaintainerAccess = async (owner, repo, prNumber) => {
  try {
    await log('📝 Posting comment to request maintainer access...', { verbose: true });
    const commentBody = `Hello! 👋
I'm a maintainer trying to help with this PR, but I need access to push changes directly to your fork.
Could you please enable the **"Allow edits by maintainers"** checkbox? This will let me push updates directly to this PR.
**How to enable it:**
1. Go to the bottom of this PR page
2. Find the "Allow edits by maintainers" checkbox in the sidebar (on the right side)
3. Check the box ✅
Alternatively, you can enable it when creating/editing the PR. See: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/allowing-changes-to-a-pull-request-branch-created-from-a-fork
Thank you! 🙏`;
    const commentResult = await $`gh pr comment ${prNumber} --repo ${owner}/${repo} --body ${commentBody}`;
    if (commentResult.code === 0) {
      await log('✅ Comment posted successfully', { verbose: true });
      return true;
    } else {
      const errorOutput = (commentResult.stderr ? commentResult.stderr.toString() : '') + (commentResult.stdout ? commentResult.stdout.toString() : '');
      await log(`⚠️  Warning: Failed to post comment: ${cleanErrorMessage(errorOutput)}`, { level: 'warning' });
      return false;
    }
  } catch (error) {
    reportError(error, {
      context: 'request_maintainer_access',
      owner,
      repo,
      prNumber,
      operation: 'post_comment_request_access',
    });
    await log(`⚠️  Warning: Error posting comment: ${cleanErrorMessage(error)}`, { level: 'warning' });
    return false;
  }
};
/**
 * Attaches a log file to a GitHub PR or issue as a comment
 * @param {Object} options - Configuration options
 * @param {string} options.logFile - Path to the log file
 * @param {string} options.targetType - 'pr' or 'issue'
 * @param {number} options.targetNumber - PR or issue number
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @param {Function} options.$ - Command execution function
 * @param {Function} options.log - Logging function
 * @param {Function} options.sanitizeLogContent - Function to sanitize log content
 * @param {boolean} [options.verbose=false] - Enable verbose logging
 * @param {string} [options.errorMessage] - Error message to include in comment (for failure logs)
 * @param {string} [options.customTitle] - Custom title for the comment (defaults to "🤖 Solution Draft Log")
 * @param {boolean} [options.isUsageLimit] - Whether this is a usage limit error
 * @param {string} [options.limitResetTime] - Time when usage limit resets
 * @param {string} [options.toolName] - Name of the tool (claude, codex, opencode)
 * @param {string} [options.resumeCommand] - Command to resume the session
 * @returns {Promise<boolean>} - True if upload succeeded
 */
export async function attachLogToGitHub(options) {
  const fs = (await use('fs')).promises;
  const {
    logFile,
    targetType,
    targetNumber,
    owner,
    repo,
    $,
    log,
    sanitizeLogContent,
    verbose = false,
    errorMessage,
    customTitle = '🤖 Solution Draft Log',
    sessionId = null,
    tempDir = null,
    anthropicTotalCostUSD = null,
    isUsageLimit = false,
    limitResetTime = null,
    toolName = 'AI tool',
    resumeCommand = null,
    // New parameters for agent tool pricing support
    publicPricingEstimate = null,
    pricingInfo = null,
    // Issue #1088: Track error_during_execution for "Finished with errors" state
    errorDuringExecution = false,
  } = options;
  const targetName = targetType === 'pr' ? 'Pull Request' : 'Issue';
  const ghCommand = targetType === 'pr' ? 'pr' : 'issue';
  try {
    // Check if log file exists and is not empty
    const logStats = await fs.stat(logFile);
    if (logStats.size === 0) {
      await log('  ⚠️  Log file is empty, skipping upload');
      return false;
    } else if (logStats.size > githubLimits.fileMaxSize) {
      await log(`  ⚠️  Log file too large (${Math.round(logStats.size / 1024 / 1024)}MB), GitHub limit is ${Math.round(githubLimits.fileMaxSize / 1024 / 1024)}MB`);
      return false;
    }
    // Calculate token usage if sessionId and tempDir are provided
    // For agent tool, publicPricingEstimate is already provided, so we skip Claude-specific calculation
    let totalCostUSD = publicPricingEstimate;
    if (totalCostUSD === null && sessionId && tempDir && !errorMessage) {
      try {
        const { calculateSessionTokens } = await import('./claude.lib.mjs');
        const tokenUsage = await calculateSessionTokens(sessionId, tempDir);
        if (tokenUsage) {
          if (tokenUsage.totalCostUSD !== null && tokenUsage.totalCostUSD !== undefined) {
            totalCostUSD = tokenUsage.totalCostUSD;
            if (verbose) {
              await log(`  💰 Calculated cost: $${totalCostUSD.toFixed(6)}`, { verbose: true });
            }
          }
        }
      } catch (tokenError) {
        // Don't fail the entire upload if token calculation fails
        if (verbose) {
          await log(`  ⚠️  Could not calculate token cost: ${tokenError.message}`, { verbose: true });
        }
      }
    }
    // Read and sanitize log content
    const rawLogContent = await fs.readFile(logFile, 'utf8');
    if (verbose) {
      await log('  🔍 Sanitizing log content to mask GitHub tokens...', { verbose: true });
    }
    let logContent = await sanitizeLogContent(rawLogContent);

    // Escape code blocks in the log content to prevent them from breaking markdown formatting
    if (verbose) {
      await log('  🔧 Escaping code blocks in log content for safe embedding...', { verbose: true });
    }
    logContent = escapeCodeBlocksInLog(logContent);
    // Create formatted comment
    let logComment;
    // Usage limit comments should be shown whenever isUsageLimit is true,
    // regardless of whether a generic errorMessage is provided.
    if (isUsageLimit) {
      // Usage limit error format - separate from general failures
      logComment = `## ⏳ Usage Limit Reached

The automated solution draft was interrupted because the ${toolName} usage limit was reached.

### 📊 Limit Information
- **Tool**: ${toolName}
- **Limit Type**: Usage limit exceeded`;

      if (limitResetTime) {
        logComment += `\n- **Reset Time**: ${limitResetTime}`;
      }

      if (sessionId) {
        logComment += `\n- **Session ID**: ${sessionId}`;
      }

      logComment += '\n\n### 🔄 How to Continue\n';

      if (limitResetTime) {
        logComment += `Once the limit resets at **${limitResetTime}**, you can use the \`--auto-continue-on-limit-reset\` option to automatically resume when the limit resets.`;
      } else {
        logComment += 'You can use the `--auto-continue-on-limit-reset` option to automatically resume when the limit resets.';
      }

      // Note: The Claude CLI resume command is available in the logs below for manual resumption
      if (sessionId) {
        logComment += `\n\nSee the logs below for the resume command if you need to continue manually.`;
      }

      logComment += `

<details>
<summary>Click to expand execution log (${Math.round(logStats.size / 1024)}KB)</summary>

\`\`\`
${logContent}
\`\`\`

</details>

---
*This session was interrupted due to usage limits. You can resume once the limit resets.*`;
    } else if (errorMessage) {
      // Failure log format (non-usage-limit errors)
      logComment = `## 🚨 Solution Draft Failed
The automated solution draft encountered an error:
\`\`\`
${errorMessage}
\`\`\`

<details>
<summary>Click to expand failure log (${Math.round(logStats.size / 1024)}KB)</summary>

\`\`\`
${logContent}
\`\`\`

</details>

---
*Now working session is ended, feel free to review and add any feedback on the solution draft.*`;
    } else if (errorDuringExecution) {
      // Issue #1088: "Finished with errors" format - work may have been completed but errors occurred
      const costInfo = buildCostInfoString(totalCostUSD, anthropicTotalCostUSD, pricingInfo);
      logComment = `## ⚠️ Solution Draft Finished with Errors
This log file contains the complete execution trace of the AI ${targetType === 'pr' ? 'solution draft' : 'analysis'} process.${costInfo}

**Note**: The session encountered errors during execution, but some work may have been completed. Please review the changes carefully.

<details>
<summary>Click to expand solution draft log (${Math.round(logStats.size / 1024)}KB)</summary>

\`\`\`
${logContent}
\`\`\`

</details>

---
*Now working session is ended, feel free to review and add any feedback on the solution draft.*`;
    } else {
      // Success log format - use helper function for cost info
      const costInfo = buildCostInfoString(totalCostUSD, anthropicTotalCostUSD, pricingInfo);
      logComment = `## ${customTitle}
This log file contains the complete execution trace of the AI ${targetType === 'pr' ? 'solution draft' : 'analysis'} process.${costInfo}

<details>
<summary>Click to expand solution draft log (${Math.round(logStats.size / 1024)}KB)</summary>

\`\`\`
${logContent}
\`\`\`

</details>

---
*Now working session is ended, feel free to review and add any feedback on the solution draft.*`;
    }
    // Check GitHub comment size limit
    let commentResult;
    if (logComment.length > githubLimits.commentMaxSize) {
      await log(`  ⚠️  Log comment too long (${logComment.length} chars), GitHub limit is ${githubLimits.commentMaxSize} chars`);
      await log('  📎 Uploading log using gh-upload-log...');
      try {
        // Check if repository is public or private
        let isPublicRepo = true;
        try {
          const repoVisibilityResult = await $`gh api repos/${owner}/${repo} --jq .visibility`;
          if (repoVisibilityResult.code === 0) {
            const visibility = repoVisibilityResult.stdout.toString().trim();
            isPublicRepo = visibility === 'public';
            if (verbose) {
              await log(`  🔍 Repository visibility: ${visibility}`, { verbose: true });
            }
          }
        } catch (visibilityError) {
          reportError(visibilityError, {
            context: 'check_repo_visibility',
            level: 'warning',
            owner,
            repo,
          });
          // Default to public if we can't determine visibility
          await log('  ⚠️  Could not determine repository visibility, defaulting to public', { verbose: true });
        }
        // Create temp log file with sanitized content (no compression, just gh-upload-log)
        const tempLogFile = `/tmp/solution-draft-log-${targetType}-${Date.now()}.txt`;
        // Use the original sanitized content for upload since it's a plain text file
        await fs.writeFile(tempLogFile, await sanitizeLogContent(rawLogContent));

        // Use gh-upload-log to upload the log file
        const uploadDescription = `Solution draft log for https://github.com/${owner}/${repo}/${targetType === 'pr' ? 'pull' : 'issues'}/${targetNumber}`;
        const uploadResult = await uploadLogWithGhUploadLog({
          logFile: tempLogFile,
          isPublic: isPublicRepo,
          description: uploadDescription,
          verbose,
        });
        await fs.unlink(tempLogFile).catch(() => {});

        if (uploadResult.success) {
          // Use rawUrl for direct file access (single chunk) or url for repository (multiple chunks)
          // Requirements: 1 chunk = direct raw link, >1 chunks = repo link
          const logUrl = uploadResult.chunks === 1 ? uploadResult.rawUrl : uploadResult.url;
          const uploadTypeLabel = uploadResult.type === 'gist' ? 'Gist' : 'Repository';
          const chunkInfo = uploadResult.chunks > 1 ? ` (${uploadResult.chunks} chunks)` : '';

          // Create comment with log link
          let logUploadComment;
          // For usage limit cases, always use the dedicated format regardless of errorMessage
          if (isUsageLimit) {
            // Usage limit error format
            logUploadComment = `## ⏳ Usage Limit Reached

The automated solution draft was interrupted because the ${toolName} usage limit was reached.

### 📊 Limit Information
- **Tool**: ${toolName}
- **Limit Type**: Usage limit exceeded`;

            if (limitResetTime) {
              logUploadComment += `\n- **Reset Time**: ${limitResetTime}`;
            }

            if (sessionId) {
              logUploadComment += `\n- **Session ID**: ${sessionId}`;
            }

            logUploadComment += '\n\n### 🔄 How to Continue\n';

            if (limitResetTime) {
              logUploadComment += `Once the limit resets at **${limitResetTime}**, `;
            } else {
              logUploadComment += 'Once the limit resets, ';
            }

            if (resumeCommand) {
              logUploadComment += `you can resume this session by running:
\`\`\`bash
${resumeCommand}
\`\`\``;
            } else if (sessionId) {
              logUploadComment += `you can resume this session using session ID: \`${sessionId}\``;
            } else {
              logUploadComment += 'you can retry the operation.';
            }

            logUploadComment += `

📎 **Execution log uploaded as ${uploadTypeLabel}${chunkInfo}** (${Math.round(logStats.size / 1024)}KB)
🔗 [View complete execution log](${logUrl})

---
*This session was interrupted due to usage limits. You can resume once the limit resets.*`;
          } else if (errorMessage) {
            // Failure log format (non-usage-limit errors)
            logUploadComment = `## 🚨 Solution Draft Failed
The automated solution draft encountered an error:
\`\`\`
${errorMessage}
\`\`\`
📎 **Failure log uploaded as ${uploadTypeLabel}${chunkInfo}** (${Math.round(logStats.size / 1024)}KB)
🔗 [View complete failure log](${logUrl})
---
*Now working session is ended, feel free to review and add any feedback on the solution draft.*`;
          } else if (errorDuringExecution) {
            // Issue #1088: "Finished with errors" format - work may have been completed but errors occurred
            const costInfo = buildCostInfoString(totalCostUSD, anthropicTotalCostUSD, pricingInfo);
            logUploadComment = `## ⚠️ Solution Draft Finished with Errors
This log file contains the complete execution trace of the AI ${targetType === 'pr' ? 'solution draft' : 'analysis'} process.${costInfo}

**Note**: The session encountered errors during execution, but some work may have been completed. Please review the changes carefully.

📎 **Log file uploaded as ${uploadTypeLabel}${chunkInfo}** (${Math.round(logStats.size / 1024)}KB)
🔗 [View complete solution draft log](${logUrl})
---
*Now working session is ended, feel free to review and add any feedback on the solution draft.*`;
          } else {
            // Success log format - use helper function for cost info
            const costInfo = buildCostInfoString(totalCostUSD, anthropicTotalCostUSD, pricingInfo);
            logUploadComment = `## ${customTitle}
This log file contains the complete execution trace of the AI ${targetType === 'pr' ? 'solution draft' : 'analysis'} process.${costInfo}
📎 **Log file uploaded as ${uploadTypeLabel}${chunkInfo}** (${Math.round(logStats.size / 1024)}KB)
🔗 [View complete solution draft log](${logUrl})
---
*Now working session is ended, feel free to review and add any feedback on the solution draft.*`;
          }
          const tempCommentFile = `/tmp/log-upload-comment-${targetType}-${Date.now()}.md`;
          await fs.writeFile(tempCommentFile, logUploadComment);
          commentResult = await $`gh ${ghCommand} comment ${targetNumber} --repo ${owner}/${repo} --body-file "${tempCommentFile}"`;
          await fs.unlink(tempCommentFile).catch(() => {});
          if (commentResult.code === 0) {
            await log(`  ✅ Solution draft log uploaded to ${targetName} as ${isPublicRepo ? 'public' : 'private'} ${uploadTypeLabel}${chunkInfo}`);
            await log(`  🔗 Log URL: ${logUrl}`);
            await log(`  📊 Log size: ${Math.round(logStats.size / 1024)}KB`);
            return true;
          } else {
            await log(`  ❌ Failed to post comment with log link: ${commentResult.stderr ? commentResult.stderr.toString().trim() : 'unknown error'}`);
            return false;
          }
        } else {
          await log('  ❌ gh-upload-log failed');

          // Fallback to truncated comment
          await log('  🔄 Falling back to truncated comment...');
          return await attachTruncatedLog(options);
        }
      } catch (uploadError) {
        reportError(uploadError, {
          context: 'upload_log_gh_upload_log',
          level: 'error',
        });
        await log(`  ❌ Error uploading log: ${uploadError.message}`);
        // Try regular comment as last resort
        return await attachRegularComment(options, logComment);
      }
    } else {
      // Comment fits within limit
      return await attachRegularComment(options, logComment);
    }
  } catch (uploadError) {
    await log(`  ❌ Error uploading log file: ${uploadError.message}`);
    return false;
  }
}
/**
 * Helper to attach a truncated log when full log is too large
 */
async function attachTruncatedLog(options) {
  const fs = (await use('fs')).promises;
  const { logFile, targetType, targetNumber, owner, repo, $, log, sanitizeLogContent } = options;

  const targetName = targetType === 'pr' ? 'Pull Request' : 'Issue';
  const ghCommand = targetType === 'pr' ? 'pr' : 'issue';

  const rawLogContent = await fs.readFile(logFile, 'utf8');
  let logContent = await sanitizeLogContent(rawLogContent);
  // Escape code blocks to prevent markdown breaking
  logContent = escapeCodeBlocksInLog(logContent);
  const logStats = await fs.stat(logFile);

  const GITHUB_COMMENT_LIMIT = 65536;
  const maxContentLength = GITHUB_COMMENT_LIMIT - 500;
  const truncatedContent = logContent.substring(0, maxContentLength) + '\n\n[... Log truncated due to length ...]';

  const truncatedComment = `## 🤖 Solution Draft Log (Truncated)
This log file contains the complete execution trace of the AI ${targetType === 'pr' ? 'solution draft' : 'analysis'} process.
⚠️ **Log was truncated** due to GitHub comment size limits.

<details>
<summary>Click to expand solution draft log (${Math.round(logStats.size / 1024)}KB, truncated)</summary>

\`\`\`
${truncatedContent}
\`\`\`

</details>

---
*Now working session is ended, feel free to review and add any feedback on the solution draft.*`;
  const tempFile = `/tmp/log-truncated-comment-${targetType}-${Date.now()}.md`;
  await fs.writeFile(tempFile, truncatedComment);

  const result = await $`gh ${ghCommand} comment ${targetNumber} --repo ${owner}/${repo} --body-file "${tempFile}"`;

  await fs.unlink(tempFile).catch(() => {});

  if (result.code === 0) {
    await log(`  ✅ Truncated solution draft log uploaded to ${targetName}`);
    await log(`  📊 Log size: ${Math.round(logStats.size / 1024)}KB (truncated)`);
    return true;
  } else {
    await log(`  ❌ Failed to upload truncated log: ${result.stderr ? result.stderr.toString().trim() : 'unknown error'}`);
    return false;
  }
}
/**
 * Helper to attach a regular comment when it fits within limits
 */
async function attachRegularComment(options, logComment) {
  const fs = (await use('fs')).promises;
  const { targetType, targetNumber, owner, repo, $, log, logFile } = options;

  const targetName = targetType === 'pr' ? 'Pull Request' : 'Issue';
  const ghCommand = targetType === 'pr' ? 'pr' : 'issue';
  const logStats = await fs.stat(logFile);

  const tempFile = `/tmp/log-comment-${targetType}-${Date.now()}.md`;
  await fs.writeFile(tempFile, logComment);

  const result = await $`gh ${ghCommand} comment ${targetNumber} --repo ${owner}/${repo} --body-file "${tempFile}"`;

  await fs.unlink(tempFile).catch(() => {});

  if (result.code === 0) {
    await log(`  ✅ Solution draft log uploaded to ${targetName} as comment`);
    await log(`  📊 Log size: ${Math.round(logStats.size / 1024)}KB`);
    return true;
  } else {
    await log(`  ❌ Failed to upload log to ${targetName}: ${result.stderr ? result.stderr.toString().trim() : 'unknown error'}`);
    return false;
  }
}
/**
 * Detects if an error is due to GitHub API rate limiting
 * @param {Error|string} error - The error to check
 * @returns {boolean} True if the error indicates rate limiting
 */
export function isRateLimitError(error) {
  const errorMessage = (error.message || error.toString()).toLowerCase();
  // Common rate limit error patterns
  const rateLimitPatterns = ['rate limit', 'secondary rate limit', 'exceeded.*limit', 'too many requests', 'abuse detection', 'wait a few minutes', 'http 403.*rate', 'api rate limit exceeded'];
  return rateLimitPatterns.some(pattern => {
    return new RegExp(pattern).test(errorMessage);
  });
}
/**
 * Helper function to fetch all issues with pagination and rate limiting
 * Note: GitHub Search API has a hard limit of 1000 results total.
 * For user/org queries with >1000 issues, the fetchIssuesFromRepositories fallback should be used.
 * @param {string} baseCommand - The base gh command to execute
 * @returns {Promise<Array>} Array of issues
 */
export async function fetchAllIssuesWithPagination(baseCommand) {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);
  // Import log and cleanErrorMessage from lib.mjs
  const { log, cleanErrorMessage } = await import('./lib.mjs');
  try {
    // First, try without pagination to see if we get more than the default limit
    await log('   📊 Fetching issues with improved limits and rate limiting...', { verbose: true });
    // Add a 5-second delay before making the API call to respect rate limits
    await log('   ⏰ Waiting 5 seconds before API call to respect rate limits...', { verbose: true });
    await new Promise(resolve => setTimeout(resolve, timeouts.githubApiDelay));
    const startTime = Date.now();
    // Use appropriate page sizes: 100 for search API (more restrictive), 1000 for regular listing
    const commandWithoutLimit = baseCommand.replace(/--limit\s+\d+/, '');
    const isSearchCommand = commandWithoutLimit.includes('gh search');
    const maxPageSize = isSearchCommand ? 100 : 1000;
    const improvedCommand = `${commandWithoutLimit} --limit ${maxPageSize}`;
    await log(`   🔎 Executing: ${improvedCommand}`, { verbose: true });
    const { stdout } = await execAsync(improvedCommand, { encoding: 'utf8', env: process.env });
    const endTime = Date.now();
    const issues = JSON.parse(stdout || '[]');
    await log(`   ✅ Fetched ${issues.length} issues in ${Math.round((endTime - startTime) / 1000)}s`);
    // If we got exactly the max page size, there might be more - log a warning and throw error to trigger fallback
    if (issues.length === maxPageSize) {
      await log(`   ⚠️  Hit the ${maxPageSize} issue limit - there may be more issues available`, { level: 'warning' });
      if (isSearchCommand) {
        await log('   💡 GitHub Search API is limited to 1000 results max. Triggering repository fallback for complete results.', { level: 'info' });
        // Throw an error to trigger the fallback to fetchIssuesFromRepositories which uses GraphQL pagination
        throw new Error(`Hit search API limit of ${maxPageSize} issues - need repository-by-repository fallback for complete results`);
      } else if (maxPageSize >= 1000) {
        await log(`   💡 Consider filtering by labels or date ranges for repositories with >${maxPageSize} open issues`, { level: 'info' });
      }
    }
    // Add a 5-second delay after the call to be extra safe with rate limits
    await log('   ⏰ Adding 5-second delay after API call to respect rate limits...', { verbose: true });
    await new Promise(resolve => setTimeout(resolve, timeouts.githubApiDelay));
    return issues;
  } catch (error) {
    await log(`   ❌ Enhanced fetch failed: ${cleanErrorMessage(error)}`, { level: 'error' });
    // Check if this is a rate limit error - if so, re-throw immediately
    if (isRateLimitError(error)) {
      await log('   ⚠️  Rate limit detected - re-throwing for caller to handle', { verbose: true });
      throw error;
    }
    // Check if this is the "hit search API limit" error - if so, re-throw to trigger repository fallback
    const errorMsg = error.message || error.toString();
    if (errorMsg.includes('Hit search API limit') || errorMsg.includes('repository-by-repository fallback')) {
      await log('   🔄 Re-throwing error to trigger repository-by-repository fallback...', { verbose: true });
      throw error;
    }
    // For other errors, try a simple fallback with default limit
    try {
      await log('   🔄 Falling back to default behavior...', { verbose: true });
      const fallbackCommand = baseCommand.includes('--limit') ? baseCommand : `${baseCommand} --limit 100`;
      await new Promise(resolve => setTimeout(resolve, timeouts.githubRepoDelay)); // Shorter delay for fallback
      const { stdout } = await execAsync(fallbackCommand, { encoding: 'utf8', env: process.env });
      const issues = JSON.parse(stdout || '[]');
      await log(`   ⚠️  Fallback: fetched ${issues.length} issues (limited to 100)`, { level: 'warning' });
      return issues;
    } catch (fallbackError) {
      await log(`   ❌ Fallback also failed: ${cleanErrorMessage(fallbackError)}`, { level: 'error' });
      // Re-throw the error so the caller can handle it appropriately
      throw fallbackError;
    }
  }
}
// Function to fetch issues from GitHub Projects v2
export async function fetchProjectIssues(projectNumber, owner, statusFilter) {
  try {
    await log(`🔍 Fetching issues from GitHub Project #${projectNumber} (owner: ${owner}, status: ${statusFilter})`);
    // Check for project scope in GitHub CLI authentication
    try {
      const authStatus = await $`gh auth status --show-token`;
      if (!authStatus.stdout.includes('project')) {
        throw new Error('Missing project scope. Run: gh auth refresh -s project');
      }
    } catch (error) {
      reportError(error, {
        context: 'github.lib.mjs - GitHub CLI auth status check',
        level: 'error',
      });
      throw new Error('GitHub CLI authentication failed. Please run: gh auth login');
    }
    // Add delay to respect rate limits
    await log('   ⏰ Waiting 2 seconds before API call to respect rate limits...', { verbose: true });
    await new Promise(resolve => setTimeout(resolve, timeouts.githubRepoDelay));
    const startTime = Date.now();
    // Fetch all project items
    await log(`   🔎 Executing: gh project item-list ${projectNumber} --owner ${owner} --format json --limit 100`, {
      verbose: true,
    });
    const result = await $`gh project item-list ${projectNumber} --owner ${owner} --format json --limit 100`;
    const endTime = Date.now();
    const projectData = JSON.parse(result.stdout || '{"items": []}');
    const allItems = projectData.items || [];
    await log(`   📊 Found ${allItems.length} total project items in ${Math.round((endTime - startTime) / 1000)}s`);
    // Filter by status and item type (only Issues)
    const filteredIssues = allItems.filter(item => {
      // Check if it's an Issue (not PR, Discussion, etc.)
      if (item.content?.type !== 'Issue') {
        return false;
      }
      // Check status field - look for Status field in fieldValueByName
      const statusField = item.fieldValueByName?.Status;
      if (!statusField) {
        // If no status field, skip this item
        return false;
      }
      // Match against configured status value
      return statusField.name === statusFilter;
    });
    // Extract issue information
    const issues = filteredIssues.map(item => ({
      url: item.content.url,
      title: item.content.title,
      number: item.content.number,
      repository: item.content.repository,
      labels: item.content.labels || [],
      state: item.content.state || 'open',
    }));
    await log(`   ✅ Found ${issues.length} issues with status "${statusFilter}"`);
    if (issues.length > 0) {
      await log('   📋 Issues found:', { verbose: true });
      for (const issue of issues) {
        await log(`      • #${issue.number}: ${issue.title}`, { verbose: true });
      }
    }
    // Add delay after API call
    await log('   ⏰ Adding 2-second delay after API call to respect rate limits...', { verbose: true });
    await new Promise(resolve => setTimeout(resolve, timeouts.githubRepoDelay));
    return issues;
  } catch (error) {
    await log(`   ❌ Failed to fetch project issues: ${cleanErrorMessage(error)}`, { level: 'error' });
    // Provide helpful error messages for common issues
    if (error.message.includes('project scope')) {
      await log('   💡 To fix this, run: gh auth refresh -s project', { level: 'info' });
    } else if (error.message.includes('authentication')) {
      await log('   💡 To fix this, run: gh auth login', { level: 'info' });
    } else if (error.message.includes('not found') || error.message.includes('404')) {
      await log('   💡 Check that the project number and owner are correct', { level: 'info' });
      await log('   💡 Make sure you have access to the project', { level: 'info' });
    }
    return [];
  }
}
// Re-export batch operations from separate module
export const batchCheckPullRequestsForIssues = batchCheckPRs;
/**
 * Universal GitHub URL parser that handles various formats
 * @param {string} url - The GitHub URL to parse
 * @returns {Object} Parsed URL information including:
 *   - valid: boolean indicating if the URL is valid
 *   - normalized: the normalized URL (https://github.com/...)
 *   - type: 'user', 'repo', 'issue', 'pull', 'gist', 'actions', etc.
 *   - owner: repository owner/organization
 *   - repo: repository name (if applicable)
 *   - number: issue/PR number (if applicable)
 *   - path: additional path components
 *   - error: error message if invalid
 */
export function parseGitHubUrl(url) {
  if (!url || typeof url !== 'string') {
    return {
      valid: false,
      error: 'Invalid input: URL must be a non-empty string',
    };
  }
  // Trim whitespace and remove trailing slashes
  let normalizedUrl = url.trim().replace(/\/+$/, '');
  // Check if this looks like a valid GitHub-related input
  // Reject clearly invalid inputs (spaces in the URL, special chars at the start, etc.)
  if (/\s/.test(normalizedUrl) || /^[!@#$%^&*()[\]{}|\\:;"'<>,?`~]/.test(normalizedUrl)) {
    return {
      valid: false,
      error: 'Invalid GitHub URL format',
    };
  }
  // Handle protocol normalization
  if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
    // Check if it starts with github.com
    if (normalizedUrl.startsWith('github.com/')) {
      normalizedUrl = 'https://' + normalizedUrl;
    } else if (!normalizedUrl.includes('github.com')) {
      // Assume it's a shorthand format (owner, owner/repo, owner/repo/issues/123, etc.)
      normalizedUrl = 'https://github.com/' + normalizedUrl;
    } else {
      // Has github.com somewhere but not at the start - likely malformed
      return {
        valid: false,
        error: 'Invalid GitHub URL format',
      };
    }
  }
  // Convert http to https
  if (normalizedUrl.startsWith('http://')) {
    normalizedUrl = normalizedUrl.replace(/^http:\/\//, 'https://');
  }

  // Check for backslashes in the URL path (excluding query params and hash)
  // According to RFC 3986, backslash is not a valid character in URL paths
  const urlBeforeQueryAndHash = normalizedUrl.split('?')[0].split('#')[0];
  if (urlBeforeQueryAndHash.includes('\\')) {
    // Generate suggested URL by replacing backslashes with forward slashes
    const suggestedUrl = urlBeforeQueryAndHash.replace(/\\/g, '/');
    const urlAfterPath = normalizedUrl.substring(urlBeforeQueryAndHash.length);

    return {
      valid: false,
      error: 'Invalid character in URL: backslash (\\) is not allowed in URL paths',
      suggestion: suggestedUrl + urlAfterPath,
    };
  }

  // Parse the URL
  let urlObj;
  try {
    urlObj = new globalThis.URL(normalizedUrl);
  } catch (e) {
    if (global.verboseMode) {
      reportError(e, {
        context: 'github.lib.mjs - URL parsing',
        level: 'debug',
        url: normalizedUrl,
      });
    }
    return {
      valid: false,
      error: 'Invalid URL format',
    };
  }
  // Ensure it's a GitHub URL
  if (urlObj.hostname !== 'github.com' && urlObj.hostname !== 'www.github.com') {
    return {
      valid: false,
      error: 'Not a GitHub URL',
    };
  }
  // Normalize hostname
  if (urlObj.hostname === 'www.github.com') {
    normalizedUrl = normalizedUrl.replace('www.github.com', 'github.com');
    urlObj = new globalThis.URL(normalizedUrl);
  }
  // Parse the pathname
  const pathParts = urlObj.pathname.split('/').filter(p => p);
  // Handle different GitHub URL patterns
  const result = {
    valid: true,
    normalized: normalizedUrl,
    hostname: 'github.com',
    protocol: 'https',
    path: urlObj.pathname,
  };
  // No path - just github.com
  if (pathParts.length === 0) {
    result.type = 'home';
    return result;
  }
  // User/Organization page: /owner
  if (pathParts.length === 1) {
    result.type = 'user';
    result.owner = pathParts[0];
    return result;
  }
  // Set owner for all other cases
  result.owner = pathParts[0];
  // Repository page: /owner/repo
  if (pathParts.length === 2) {
    result.type = 'repo';
    result.repo = pathParts[1];
    return result;
  }
  // Set repo for paths with 3+ parts
  result.repo = pathParts[1];
  // Handle specific GitHub paths
  const thirdPart = pathParts[2];
  switch (thirdPart) {
    case 'issues':
      if (pathParts.length === 3) {
        // /owner/repo/issues - issues list
        result.type = 'issues_list';
      } else if (pathParts.length === 4 && /^\d+$/.test(pathParts[3])) {
        // /owner/repo/issues/123 - specific issue
        result.type = 'issue';
        result.number = parseInt(pathParts[3]);
      } else {
        result.type = 'issues_page';
        result.subpath = pathParts.slice(3).join('/');
      }
      break;
    case 'pull':
      if (pathParts.length === 4 && /^\d+$/.test(pathParts[3])) {
        // /owner/repo/pull/456 - specific PR
        result.type = 'pull';
        result.number = parseInt(pathParts[3]);
      } else {
        result.type = 'pull_page';
        result.subpath = pathParts.slice(3).join('/');
      }
      break;
    case 'pulls':
      // /owner/repo/pulls - PR list
      result.type = 'pulls_list';
      if (pathParts.length > 3) {
        result.subpath = pathParts.slice(3).join('/');
      }
      break;
    case 'actions':
      // /owner/repo/actions - GitHub Actions
      result.type = 'actions';
      if (pathParts.length > 3) {
        result.subpath = pathParts.slice(3).join('/');
        if (pathParts[3] === 'runs' && pathParts[4] && /^\d+$/.test(pathParts[4])) {
          result.type = 'action_run';
          result.runId = parseInt(pathParts[4]);
        }
      }
      break;
    case 'releases':
      // /owner/repo/releases
      result.type = 'releases';
      if (pathParts.length > 3) {
        result.subpath = pathParts.slice(3).join('/');
        if (pathParts[3] === 'tag' && pathParts[4]) {
          result.type = 'release';
          result.tag = pathParts[4];
        }
      }
      break;
    case 'tree':
    case 'blob':
      // /owner/repo/tree/branch or /owner/repo/blob/branch/file
      result.type = thirdPart === 'tree' ? 'tree' : 'file';
      if (pathParts.length > 3) {
        result.branch = pathParts[3];
        if (pathParts.length > 4) {
          result.filepath = pathParts.slice(4).join('/');
        }
      }
      break;
    case 'commit':
    case 'commits':
      // /owner/repo/commit/sha or /owner/repo/commits/branch
      result.type = thirdPart === 'commit' ? 'commit' : 'commits';
      if (pathParts.length > 3) {
        result.ref = pathParts[3]; // Could be SHA or branch
      }
      break;
    case 'compare':
      // /owner/repo/compare/base...head
      result.type = 'compare';
      if (pathParts.length > 3) {
        result.comparison = pathParts[3];
      }
      break;
    case 'wiki':
      // /owner/repo/wiki
      result.type = 'wiki';
      if (pathParts.length > 3) {
        result.subpath = pathParts.slice(3).join('/');
      }
      break;
    case 'settings':
      // /owner/repo/settings
      result.type = 'settings';
      if (pathParts.length > 3) {
        result.subpath = pathParts.slice(3).join('/');
      }
      break;
    case 'projects':
      // /owner/repo/projects or /owner/repo/projects/1
      result.type = 'projects';
      if (pathParts.length > 3 && /^\d+$/.test(pathParts[3])) {
        result.type = 'project';
        result.projectNumber = parseInt(pathParts[3]);
      }
      break;
    default:
      // Unknown path structure but still valid GitHub URL
      result.type = 'other';
      result.subpath = pathParts.slice(2).join('/');
  }
  return result;
}
/**
 * Normalize a GitHub URL to standard https://github.com format
 * This is a convenience function that uses parseGitHubUrl
 * @param {string} url - The URL to normalize
 * @returns {string|null} The normalized URL or null if invalid
 */
export function normalizeGitHubUrl(url) {
  const parsed = parseGitHubUrl(url);
  return parsed.valid ? parsed.normalized : null;
}
/**
 * Check if a URL is a valid GitHub URL of a specific type
 * @param {string} url - The URL to check
 * @param {string|Array} types - The type(s) to check for ('issue', 'pull', 'repo', etc.)
 * @returns {boolean} True if the URL matches the specified type(s)
 */
export function isGitHubUrlType(url, types) {
  const parsed = parseGitHubUrl(url);
  if (!parsed.valid) return false;
  const typeArray = Array.isArray(types) ? types : [types];
  return typeArray.includes(parsed.type);
}
/**
 * Universal function to view a pull request using gh pr view
 * @param {Object} options - Configuration options
 * @param {number|string} options.prNumber - PR number to view
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @param {string} [options.jsonFields='headRefName,body,number,mergeStateStatus,state,headRepositoryOwner'] - JSON fields to return
 * @returns {Promise<{code: number, stdout: string, stderr: string, data: Object|null}>}
 */
export async function ghPrView({ prNumber, owner, repo, jsonFields = 'headRefName,body,number,mergeStateStatus,state,headRepositoryOwner' }) {
  try {
    const prResult = await $`gh pr view ${prNumber} --repo ${owner}/${repo} --json ${jsonFields}`;
    const stdout = prResult.stdout.toString();
    const stderr = prResult.stderr ? prResult.stderr.toString() : '';
    const code = prResult.code || 0;
    let data = null;
    if (code === 0 && stdout && !stdout.includes('Could not resolve')) {
      try {
        data = JSON.parse(stdout);
      } catch {
        // If JSON parsing fails, data remains null
      }
    }
    return {
      code,
      stdout,
      stderr,
      data,
      output: stdout + stderr,
    };
  } catch (error) {
    return {
      code: error.code || 1,
      stdout: error.stdout?.toString() || '',
      stderr: error.stderr?.toString() || error.message || '',
      data: null,
      output: (error.stdout?.toString() || '') + (error.stderr?.toString() || error.message || ''),
    };
  }
}
/**
 * Universal function to view an issue using gh issue view
 * @param {Object} options - Configuration options
 * @param {number|string} options.issueNumber - Issue number to view
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @param {string} [options.jsonFields='number,title'] - JSON fields to return
 * @returns {Promise<{code: number, stdout: string, stderr: string, data: Object|null}>}
 */
export async function ghIssueView({ issueNumber, owner, repo, jsonFields = 'number,title' }) {
  try {
    const issueResult = await $`gh issue view ${issueNumber} --repo ${owner}/${repo} --json ${jsonFields}`;
    const stdout = issueResult.stdout.toString();
    const stderr = issueResult.stderr ? issueResult.stderr.toString() : '';
    const code = issueResult.code || 0;
    let data = null;
    if (code === 0 && stdout && !stdout.includes('Could not resolve')) {
      try {
        data = JSON.parse(stdout);
      } catch {
        // If JSON parsing fails, data remains null
      }
    }
    return {
      code,
      stdout,
      stderr,
      data,
      output: stdout + stderr,
    };
  } catch (error) {
    return {
      code: error.code || 1,
      stdout: error.stdout?.toString() || '',
      stderr: error.stderr?.toString() || error.message || '',
      data: null,
      output: (error.stdout?.toString() || '') + (error.stderr?.toString() || error.message || ''),
    };
  }
}
/**
 * Handle PR not found error and check if an issue exists with the same number
 * Provides user-friendly error messages and command suggestions
 * @param {Object} options - Configuration options
 * @param {number} options.prNumber - PR number that doesn't exist
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @param {Object} options.argv - Command line arguments object (for reconstructing command)
 * @param {boolean} [options.shouldAttachLogs] - Whether --attach-logs was used
 * @returns {Promise<void>}
 */
export async function handlePRNotFoundError({ prNumber, owner, repo, argv, shouldAttachLogs }) {
  await log(`Error: PR #${prNumber} does not exist in ${owner}/${repo}`, { level: 'error' });
  await log('', { level: 'error' });
  try {
    const issueCheckResult = await ghIssueView({ issueNumber: prNumber, owner, repo, jsonFields: 'number,title' });
    if (issueCheckResult.code === 0 && issueCheckResult.data) {
      await log(`💡 However, Issue #${prNumber} exists with the same number:`, { level: 'error' });
      await log(`   Title: "${issueCheckResult.data.title}"`, { level: 'error' });
      await log('', { level: 'error' });
      await log('🔧 Did you mean to work on the issue instead?', { level: 'error' });
      await log('   Try this corrected command:', { level: 'error' });
      await log('', { level: 'error' });
      const commandParts = [`solve https://github.com/${owner}/${repo}/issues/${prNumber}`];
      if (argv.autoContinue) commandParts.push('--auto-continue');
      if (shouldAttachLogs || argv.attachLogs || argv['attach-logs']) commandParts.push('--attach-logs');
      if (argv.verbose) commandParts.push('--verbose');
      if (argv.model && argv.model !== 'sonnet') commandParts.push('--model', argv.model);
      if (argv.think) commandParts.push('--think', argv.think);
      await log(`   ${commandParts.join(' ')}`, { level: 'error' });
      await log('', { level: 'error' });
    }
  } catch {
    // Silently ignore if issue check fails
  }
}
/**
 * Detect if a repository is public or private
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @returns {Promise<{isPublic: boolean, visibility: string|null}>} Repository visibility info
 */
export async function detectRepositoryVisibility(owner, repo) {
  try {
    const visibilityResult = await $`gh api repos/${owner}/${repo} --jq .visibility`;
    if (visibilityResult.code === 0) {
      const visibility = visibilityResult.stdout.toString().trim();
      const isPublic = visibility === 'public';
      if (global.verboseMode) {
        await log(`   Repository visibility: ${visibility}`, { verbose: true });
      }
      return { isPublic, visibility };
    }
    // If API call failed, default to assuming public (safer to keep temp directories)
    if (global.verboseMode) {
      await log('   Warning: Could not detect repository visibility, defaulting to public', { verbose: true });
    }
    return { isPublic: true, visibility: null };
  } catch (error) {
    reportError(error, {
      context: 'detect_repository_visibility',
      owner,
      repo,
      operation: 'get_repo_visibility',
    });
    // Default to public (safer to keep temp directories on error)
    if (global.verboseMode) {
      await log(`   Warning: Error detecting visibility: ${cleanErrorMessage(error)}`, { verbose: true });
    }
    return { isPublic: true, visibility: null };
  }
}
// Re-export batch archived check from separate module
export const batchCheckArchivedRepositories = batchCheckArchived;
// Re-export log upload function from separate module
export { uploadLogWithGhUploadLog } from './log-upload.lib.mjs';
// Export all functions as default object too
export default {
  maskGitHubToken,
  getGitHubTokensFromFiles,
  getGitHubTokensFromCommand,
  escapeCodeBlocksInLog,
  isSafeToken,
  isHexInSafeContext,
  sanitizeLogContent,
  checkFileInBranch,
  checkGitHubPermissions,
  checkRepositoryWritePermission,
  attachLogToGitHub,
  uploadLogWithGhUploadLog,
  fetchAllIssuesWithPagination,
  fetchProjectIssues,
  isRateLimitError,
  batchCheckPullRequestsForIssues,
  parseGitHubUrl,
  normalizeGitHubUrl,
  isGitHubUrlType,
  ghPrView,
  ghIssueView,
  handlePRNotFoundError,
  detectRepositoryVisibility,
  batchCheckArchivedRepositories,
};
