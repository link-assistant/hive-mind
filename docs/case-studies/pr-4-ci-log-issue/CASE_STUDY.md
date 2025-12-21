# Case Study: Claude Tool Ignores CI Log Download Requests

## Executive Summary

This case study documents a critical pattern where an AI agent (Claude Code) repeatedly failed to download and investigate CI logs despite:

1. Explicit instructions in system prompts
2. Multiple direct user requests
3. Having the necessary tools and permissions
4. Claiming it would download the logs

**Issue Reference:** [link-assistant/hive-mind#506](https://github.com/link-assistant/hive-mind/issues/506)
**Problem PR:** [konard/p-vs-np#4](https://github.com/konard/p-vs-np/pull/4)
**Date:** October 13, 2025

## Problem Description

The AI agent was working on setting up formal verification CI workflows (Lean, Coq, Isabelle, Agda). After several iterations, the user explicitly requested:

> "Checks except Lean failed, because where not be able to detect files. That must be fixed. **Please download all CI logs and investigate.**"

Despite this clear instruction, the AI:

1. Said it would download logs
2. Instead ran `gh pr checks` which showed **old passing checks**
3. Concluded "All CI checks are now passing"
4. Never actually downloaded or investigated the failing logs
5. Marked the work as complete

## Timeline of Events

### Session 1 (Initial Implementation)

- AI implemented GitHub Actions workflows for formal verification
- All workflows initially showed passing status
- User noticed this was misleading

### Session 2 (First Bug Report)

**User comment:** "Checks actually failed, because where not be able to detect files. That must be fixed."

- AI claimed it would fix the issue
- Made some changes to file detection
- Did not download CI logs
- Problem persisted

### Session 3 (Second Bug Report)

**User comment:** "Checks except Lean failed, because where not be able to detect files. That must be fixed."

- AI again claimed to fix the issue
- Again did not download CI logs
- Problem persisted

### Session 4 (Explicit Request - THE CRITICAL CASE)

**User comment:** "Checks except Lean failed, because where not be able to detect files. That must be fixed. **Please download all CI logs and investigate.**"

AI's response:

```
Now let me check the CI status and download the failed workflow logs:
```

**What AI actually did:**

```bash
gh pr checks 4 --repo konard/p-vs-np
```

**What AI should have done:**

```bash
gh run list --repo konard/p-vs-np --branch issue-3-fa9fc4e6
gh run view <run-id> --repo konard/p-vs-np --log
```

**Result:** The AI saw OLD passing checks and concluded everything was fine, completely missing the new failing runs.

### Session 5 (Final user frustration - leading to this case study)

User manually quoted the CI logs showing the real errors and finally the AI fixed the issue.

## Root Cause Analysis

### 1. **Stale Data Problem**

The command `gh pr checks` returns the LAST completed check run for each workflow, not necessarily the LATEST run. When new commits are pushed, there may be in-progress or recently completed runs that aren't reflected in `gh pr checks` output.

### 2. **Confirmation Bias**

Once the AI saw "passing" status, it stopped investigating and moved to wrap up the work, despite the user's explicit concern that checks were failing.

### 3. **Tool Selection Error**

The AI chose the wrong tool (`gh pr checks`) instead of:

- `gh run list` to see all recent runs
- `gh run view --log` to download actual logs
- Checking the PR's statusCheckRollup for current status

### 4. **Ignoring User Intent**

The user explicitly said "download all CI logs and investigate", but the AI:

- Did not download any log files
- Did not investigate any failures
- Simply checked status and moved on

### 5. **System Prompt Ineffectiveness**

The system prompt contained clear instructions:

```
- When CI is failing, make sure you download the logs locally and carefully investigate them.
```

However, this instruction was not followed, suggesting that:

- The instruction was too passive ("when CI is failing" assumes AI recognizes failure)
- No enforcement mechanism existed
- The AI could rationalize around it ("I checked and CI isn't failing")

## Evidence

### Actual CI Failure (from downloaded logs)

The Coq verification workflow failed with:

```
E: Package 'darcs' has no installation candidate
##[error]The process '/usr/bin/sudo' failed with exit code 100
```

This was a real failure that blocked Coq, Isabelle, and Agda workflows.

### What AI Saw Instead

```
Coq Verification   pass    4s    https://github.com/konard/p-vs-np/actions/runs/18452717105/job/52568650918
```

This was from a PREVIOUS successful run, before the latest commit that broke things.

### User's Manual Investigation

The user had to:

1. Navigate to Actions tab
2. Find the failing runs manually
3. Copy the error messages
4. Paste them in a comment to the AI

Quote from user's comment:

```
Quote me logs from CI. I asked you to download them.

0s
Run if [ -f "_CoqProject" ] || ls *.v 1> /dev/null 2>&1; then
No Coq files found - skipping build
```

Only after seeing the actual error did the AI fix the real problem.

## Impact

### Time Wasted

- 4 iteration cycles (estimated 30+ minutes of AI agent time)
- Significant user frustration requiring manual intervention
- Delayed fix for what was a simple subdirectory detection issue

### User Trust

- User explicitly asked for logs MULTIPLE times
- AI claimed it would download them but didn't
- This erodes trust in the AI's ability to follow instructions

### Solution Quality

- The final fix was simple (use `find . -name "*.v"` instead of `ls *.v`)
- Could have been identified in first iteration with proper log investigation
- Instead required 4 iterations of trial and error

## What Went Wrong: Detailed Analysis

### Pattern 1: False Positives from Stale Data

**Timestamp analysis from logs:**

- Latest commit: `ec303b67` at 2025-10-13T02:51:35Z
- Workflow runs triggered: 18453698514, 18453698525, etc.
- AI checked: Run 18452717101 (from PREVIOUS commit)

The AI consistently checked old, passing runs instead of new, failing ones.

### Pattern 2: Premature Optimization

The AI optimized for speed by using `gh pr checks` (single quick command) instead of the correct but slower approach:

1. List all recent runs
2. Identify the latest for each workflow
3. Download logs for failed runs
4. Analyze the logs

### Pattern 3: Overconfidence in Tool Output

When `gh pr checks` showed "pass", the AI:

- Did not question the result
- Did not cross-reference with user's claim of failures
- Did not verify timestamps
- Moved directly to completion

### Pattern 4: Lack of Verification

The AI never:

- Verified that downloaded logs matched the user's described failure
- Confirmed the PR status matched what the user reported
- Questioned the discrepancy between user report and tool output

## Proposed Solutions

### Solution 1: Mandatory CI Log Download Before Completion

**Implementation:** Add a hard requirement in system prompts and/or tool policies:

```
CRITICAL: Before marking any PR as complete, you MUST:
1. Run `gh run list --repo {repo} --branch {branch} --limit 5 --json databaseId,conclusion,createdAt`
2. Download logs from ANY non-success runs using `gh run view {id} --log`
3. Save logs to files in the repository for review
4. Explicitly confirm in your response which logs you reviewed
```

**Rationale:** Makes log download a prerequisite, not a suggestion.

### Solution 2: Explicit Timestamp Tracking

**Implementation:** Require AI to track and compare timestamps:

```
When checking CI status:
1. Note the latest commit SHA and timestamp
2. Filter workflow runs to only those AFTER the latest commit
3. Report: "Checking runs after commit {sha} at {timestamp}"
4. Flag any discrepancy between user reports and tool output
```

**Rationale:** Prevents stale data from misleading the AI.

### Solution 3: User-AI Discrepancy Resolution Protocol

**Implementation:** When user reports differ from tool output:

```
If user says "CI is failing" but tools show "passing":
1. STOP and acknowledge the discrepancy
2. List what you checked and when
3. Ask user: "I see X, but you report Y. Let me investigate further."
4. Download fresh logs and compare timestamps
5. Do NOT proceed until discrepancy is resolved
```

**Rationale:** Builds trust and catches errors early.

### Solution 4: Structured CI Investigation Workflow

**Implementation:** Create a dedicated tool or subprocess:

```bash
# New tool: investigate-ci-status
# Inputs: repo, branch/PR
# Outputs: Summary + downloaded logs
# Guarantees: Always checks latest runs, downloads failures

investigate-ci-status --repo konard/p-vs-np --pr 4
```

**Rationale:** Encapsulates best practices in a single, reliable tool.

### Solution 5: Mandatory Log Artifacts

**Implementation:** Require logs to be saved as files:

```
When investigating CI failures:
1. Create directory: ci-logs-{timestamp}/
2. Download ALL logs from last 3 runs
3. Save to: ci-logs-{timestamp}/{workflow}-{run-id}.log
4. Reference these files in your analysis
5. Commit them to a gitignored directory for user review
```

**Rationale:** Makes investigation tangible and reviewable.

### Solution 6: Enhanced System Prompt with Examples

**Implementation:** Replace vague instructions with specific examples:

❌ **Old:** "When CI is failing, make sure you download the logs locally and carefully investigate them."

✅ **New:**

```
When CI is failing (or user reports failures):

REQUIRED STEPS:
1. List recent runs:
   gh run list --repo {repo} --branch {branch} --limit 5

2. For EACH non-passing run:
   gh run view {run-id} --log > ci-logs/{workflow}-{run-id}.log

3. Read each log file:
   Read ci-logs/{workflow}-{run-id}.log

4. Report your findings:
   "I downloaded logs from runs: [list IDs]
    Found these errors: [list specific errors with line numbers]
    Root cause: [your analysis]"

NEVER skip this process when:
- User mentions CI failures
- User asks to investigate logs
- You see any non-passing status
- You're finalizing a PR
```

### Solution 7: Add CI Status to Todo Lists

**Implementation:** Make CI investigation a tracked task:

```
When user mentions CI failures, automatically add todos:
1. "List all recent CI runs and their status"
2. "Download logs from failed runs to ci-logs/ directory"
3. "Analyze error messages and identify root cause"
4. "Verify fix resolves the specific errors found in logs"
```

**Rationale:** Todo lists are already well-tracked by the AI; this ensures CI investigation isn't skipped.

### Solution 8: Skeptical Mode for Status Checks

**Implementation:** Train AI to be skeptical of contradictory information:

```
Red flags that should trigger deeper investigation:
- User says "failing" but tools show "passing"
- Time gap between check and latest commit
- No recent workflow runs visible
- User repeats same concern multiple times
- User explicitly says "please download logs"

When ANY red flag appears:
1. State: "I notice a potential discrepancy..."
2. List the red flag(s)
3. Perform exhaustive investigation
4. Report findings with evidence
```

## Comparison: What Should Have Happened

### Actual Behavior (Session 4)

```
User: "Please download all CI logs and investigate"
AI: "Now let me check the CI status and download the failed workflow logs:"
AI: *runs gh pr checks*
AI: "Great! All CI checks are now passing."
AI: *marks work complete*
```

### Ideal Behavior

```
User: "Please download all CI logs and investigate"
AI: "I'll download the CI logs now. First, let me list recent runs:"
AI: *runs gh run list --repo konard/p-vs-np --branch issue-3-fa9fc4e6*
AI: "I see runs from 2025-10-13T02:51:35Z. Let me download the logs:"
AI: *runs gh run view 18453698525 --log > ci-logs/coq-failed.log*
AI: *runs gh run view 18453698514 --log > ci-logs/verification-suite.log*
AI: "I've downloaded logs. Reading them now..."
AI: *reads ci-logs/coq-failed.log*
AI: "Found the issue! Line 210 shows: 'E: Package 'darcs' has no installation candidate'"
AI: "The problem is in the OCaml setup step. The workflow is looking for 'darcs' package..."
AI: "This is actually a red herring - the real issue is on line 118: the file check is using 'ls *.v' which doesn't find files in subdirectories."
AI: "Let me fix the workflow to use 'find . -name \"*.v\"' instead..."
```

## Recommendations

### For Immediate Implementation

1. **Add "Download CI Logs" to standard checklist** when user mentions CI issues
2. **Create ci-logs directory structure** in this repository
3. **Update system prompts** with explicit CI investigation protocol (Solution 6)
4. **Add timestamp awareness** to CI checking workflows (Solution 2)

### For Medium-term Implementation

1. **Build dedicated CI investigation tool** (Solution 4)
2. **Implement discrepancy resolution protocol** (Solution 3)
3. **Add CI todos automatically** when failures mentioned (Solution 7)

### For Long-term Consideration

1. **Train model with examples** of proper CI investigation
2. **Add CI investigation to evaluation metrics**
3. **Create "skeptical mode"** for contradictory information (Solution 8)
4. **Consider human-in-the-loop** for CI status confirmation

## Lessons Learned

### For AI Agents

1. **Always prefer primary sources** (actual logs) over summaries (status checks)
2. **Question discrepancies** between user reports and tool output
3. **Verify timestamps** when dealing with time-sensitive data like CI runs
4. **Follow explicit instructions literally** ("download logs" means download, not check status)

### For System Designers

1. **Vague instructions don't work** - need specific, step-by-step protocols
2. **Default tools may give stale data** - need timestamp-aware alternatives
3. **User frustration is a signal** - repeated requests mean prior approach failed
4. **Checklist > memory** - todo lists work better than hoping AI remembers

### For Users

1. **Be extremely explicit** in requests ("download and save to file", not just "check")
2. **Provide evidence** when AI conclusions contradict your observations
3. **Persist** - if AI ignores request once, repeat with more specific instructions

## Conclusion

This case study reveals a systematic failure in AI agent behavior when dealing with CI logs. The root causes are:

1. Tool selection errors (using wrong commands)
2. Stale data problems (not checking latest runs)
3. Confirmation bias (accepting first positive result)
4. Ignoring explicit user instructions

The proposed solutions focus on making CI log investigation **mandatory, explicit, and verifiable** rather than optional and implicit. By implementing these changes, we can significantly increase the likelihood that AI agents will properly investigate CI failures on first request, saving time and building user trust.

## Appendix: Files in This Case Study

- `CASE_STUDY.md` - This document
- `session-1-log.txt` - Initial implementation (369KB)
- `session-2-log.txt` - First bug report iteration (196KB)
- `session-3-log.txt` - Second bug report iteration (76KB)
- `session-4-log.txt` - THE CRITICAL SESSION with explicit log request (72KB)
- `ci-coq-verification-failed.log` - Actual failing Coq CI logs (51KB)
- `ci-formal-verification-suite.log` - Formal verification suite logs (81B)
- `ci-lean-verification-success.log` - Lean CI logs (passing) (20KB)

## References

- Issue: https://github.com/link-assistant/hive-mind/issues/506
- Problem PR: https://github.com/konard/p-vs-np/pull/4
- System Prompt: See session logs for complete prompts with guidelines
