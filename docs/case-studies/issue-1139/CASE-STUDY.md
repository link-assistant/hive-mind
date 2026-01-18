# Case Study: Session Resume Failure (Issue #1139)

## Overview

**Issue Title**: No conversation found with session ID: 7b651dee-663f-49a1-9363-e7f4b82d9444

**Date of Incident**: 2026-01-18

**Session ID**: `7b651dee-663f-49a1-9363-e7f4b82d9444`

**Affected System**: AI Issue Solver (`solve.mjs`) using Claude Code CLI

---

## Timeline of Events

### Phase 1: Initial Session Start (14:12:21 - 14:15:26 UTC)

| Timestamp | Event |
|-----------|-------|
| 14:12:21 | `solve.mjs` v1.4.0 started for issue #20 in link-foundation/links-queue |
| 14:12:30 | Working directory created: `/tmp/gh-issue-solver-1768745550255` |
| 14:12:31 | Branch `issue-20-4c729ba06b71` created |
| 14:12:40 | PR #42 created |
| 14:12:51 | Claude Code CLI v2.1.9 started |
| 14:12:52 | Session `7b651dee-663f-49a1-9363-e7f4b82d9444` initialized |
| 14:12:52 | Session file created at: `~/.claude/projects/-tmp-gh-issue-solver-1768745550255/7b651dee-663f-49a1-9363-e7f4b82d9444.jsonl` |
| 14:13:56 | AI started implementing cluster coordinator |
| 14:15:25 | **Streaming stall detected**: 85.9s gap between events |
| 14:15:26 | File `coordinator.js` written to disk |
| 14:15:26 | **Rate limit error (429)**: "This request would exceed your account's rate limit" |
| 14:15:26 | Session ended with usage limit |

### Phase 2: Usage Limit Notification (14:15:33 UTC)

The system posted a GitHub comment with:
- Session ID: `7b651dee-663f-49a1-9363-e7f4b82d9444`
- Reset Time: 4:00 PM
- Resume command: `claude --resume 7b651dee-663f-49a1-9363-e7f4b82d9444`

### Phase 3: Resume Attempt (15:00:15 - 15:01:01 UTC)

| Timestamp | Event |
|-----------|-------|
| 15:00:15 | `solve.mjs` restarted with `--resume 7b651dee-663f-49a1-9363-e7f4b82d9444` |
| 15:00:37 | **WARNING**: "Session log for 7b651dee-663f-49a1-9363-e7f4b82d9444 not found, but continuing with resume attempt" |
| 15:00:37 | **New directory created**: `/tmp/gh-issue-solver-resume-7b651dee-663f-49a1-9363-e7f4b82d9444-1768748437272` |
| 15:00:52 | Claude Code CLI executed with `--resume` from new directory |
| 15:00:56 | **ERROR**: "No conversation found with session ID: 7b651dee-663f-49a1-9363-e7f4b82d9444" |
| 15:00:56 | New session ID assigned: `95724704-4f9a-4e34-8dcb-6217258e91c6` |
| 15:01:01 | Session finished with errors, cost: $0.00 |

---

## Root Cause Analysis

### Primary Root Cause: Directory-Based Session Storage

Claude Code stores sessions in **directory-specific paths** derived from the working directory:

```
~/.claude/projects/{encoded-path}/{session-id}.jsonl
```

Where `{encoded-path}` is the working directory with `/` replaced by `-`.

**Original Session Location:**
```
~/.claude/projects/-tmp-gh-issue-solver-1768745550255/7b651dee-663f-49a1-9363-e7f4b82d9444.jsonl
```

**Resume Attempt Directory:**
```
/tmp/gh-issue-solver-resume-7b651dee-663f-49a1-9363-e7f4b82d9444-1768748437272
```

**Where Claude Looked:**
```
~/.claude/projects/-tmp-gh-issue-solver-resume-7b651dee-663f-49a1-9363-e7f4b82d9444-1768748437272/
```

Since no session file existed at the new path, Claude Code returned "No conversation found".

### Contributing Factors

1. **solve.mjs creates new directory for resume**: The solver script creates a fresh temporary directory (`/tmp/gh-issue-solver-resume-...`) instead of reusing the original directory.

2. **Original directory may be cleaned up**: The `/tmp/gh-issue-solver-1768745550255` directory from the original session might have been deleted between sessions.

3. **Known Claude Code limitation**: This is a [documented bug in Claude Code](https://github.com/anthropics/claude-code/issues/5768) - sessions can only be resumed from the directory where they were started.

4. **No cross-directory session lookup**: Claude Code does not search all `~/.claude/projects/*/` subdirectories when given an explicit session UUID.

---

## Evidence Files

| File | Description |
|------|-------------|
| `raw-data/session-7b651dee-663f-49a1-9363-e7f4b82d9444.jsonl` | Original session conversation data (59 lines) |
| `raw-data/debug-7b651dee-663f-49a1-9363-e7f4b82d9444.txt` | Debug logs showing rate limit error |
| `raw-data/todos-7b651dee-663f-49a1-9363-e7f4b82d9444.json` | Todo list state at time of limit |
| `raw-data/solution-draft-log-pr-1768745728964.txt` | First session log (limit reached) |
| `raw-data/solution-draft-log-pr-1768748407104.txt` | Resume attempt log (failed) |

---

## Session Data Analysis

### Original Session Statistics

- **Session Duration**: ~3 minutes (14:12:52 - 14:15:26)
- **Total Messages**: 59 conversation turns
- **Work Completed**:
  - Created todo list with 12 items
  - Started implementing `src/cluster/coordinator.js`
  - File written to disk (21,332 bytes)
- **Session State at Limit**:
  - 1 task in_progress: "Implement src/cluster/coordinator.js"
  - 11 tasks pending
- **Cost**: Not captured due to limit (estimated ~$2.97 from previous session)

### Resume Session Statistics

- **Session Duration**: 0ms
- **Total Messages**: 0
- **API Calls**: 0
- **Cost**: $0.00 (no API calls made)

---

## Impact Assessment

### Direct Impact
- Work session interrupted at rate limit
- Resume failed, requiring fresh start
- Context and progress lost for the conversation
- Files written to disk preserved, but conversation context lost

### Indirect Impact
- Wasted compute resources on failed resume
- Potential delay in issue resolution
- Manual intervention required to continue work

---

## Proposed Solutions

### Short-Term Mitigations (for solve.mjs)

1. **Use Original Directory for Resume**
   ```javascript
   // Instead of creating new directory:
   // /tmp/gh-issue-solver-resume-{session-id}-{timestamp}

   // Parse session file to get original cwd and reuse it:
   const sessionData = readSessionFile(sessionId);
   const originalCwd = sessionData.cwd;
   ```

2. **Copy Session Files to New Directory**
   ```javascript
   // Before calling claude --resume, copy the session files:
   const encodedOriginalPath = originalCwd.replace(/\//g, '-');
   const sessionFile = `~/.claude/projects/${encodedOriginalPath}/${sessionId}.jsonl`;
   const targetDir = `~/.claude/projects/${encodedNewPath}/`;
   copySync(sessionFile, targetDir);
   ```

3. **Store and Pass Original CWD**
   - Store original working directory in the limit-reached comment
   - Resume from that directory instead of creating new one

### Long-Term Solutions (for Claude Code)

1. **Cross-Directory Session Lookup** (Upstream fix)
   - Claude Code should search all `~/.claude/projects/*/` subdirectories when given explicit session UUID
   - [Issue #5768](https://github.com/anthropics/claude-code/issues/5768) tracks this

2. **Session Metadata API**
   - Claude Code could provide a `--session-info UUID` command to get session metadata including original cwd

3. **Portable Session References**
   - Store session references by UUID in a central index, not just by path

---

## References

### GitHub Issues
- [Issue #5768: Resuming sessions only works from the directory in which they were started](https://github.com/anthropics/claude-code/issues/5768)
- [Issue #1516: Ability to move directories and not break --continue](https://github.com/anthropics/claude-code/issues/1516)
- [Issue #3473: Ability to change working directory during Claude session](https://github.com/anthropics/claude-code/issues/3473)

### Documentation
- [Claude Code Common Workflows](https://code.claude.com/docs/en/common-workflows)
- [Claude Code Session Management - Steve Kinney](https://stevekinney.com/courses/ai-development/claude-code-session-management)
- [Claude Session Migration Guide (GitHub Gist)](https://gist.github.com/gwpl/e0b78a711b4a6b2fc4b594c9b9fa2c4c)
- [DeepWiki: Session & Conversation Management](https://deepwiki.com/anthropics/claude-code/3.3-session-and-conversation-management)
- [Rescuing Claude Conversations When You Rename Projects](https://www.curiouslychase.com/posts/rescuing-your-claude-conversations-when-you-rename-projects)

### Technical References
- Claude Code CLI version: 2.1.9
- Claude Model: claude-opus-4-5-20251101
- solve.mjs version: 1.4.0

---

## Recommendations

1. **Immediate**: Update solve.mjs to preserve and reuse original working directory for resume attempts

2. **Medium-term**: Implement session file migration before resume attempts

3. **Long-term**: Contribute upstream fix to Claude Code for cross-directory session lookup

4. **Process**: Add automated validation that session can be found before attempting resume

---

## Appendix: Directory Structure

```
~/.claude/
├── projects/
│   ├── -tmp-gh-issue-solver-1768745550255/
│   │   └── 7b651dee-663f-49a1-9363-e7f4b82d9444.jsonl  # Original session
│   └── -tmp-gh-issue-solver-resume-7b651dee-663f-49a1-9363-e7f4b82d9444-1768748437272/
│       └── 95724704-4f9a-4e34-8dcb-6217258e91c6.jsonl  # New (empty) session
├── debug/
│   └── 7b651dee-663f-49a1-9363-e7f4b82d9444.txt
├── todos/
│   └── 7b651dee-663f-49a1-9363-e7f4b82d9444-agent-7b651dee-663f-49a1-9363-e7f4b82d9444.json
└── session-env/
    └── 7b651dee-663f-49a1-9363-e7f4b82d9444/  # (empty)
```
