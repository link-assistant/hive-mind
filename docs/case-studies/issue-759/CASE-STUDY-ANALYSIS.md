# Case Study: Log Truncation in GitHub Gist Display

## Issue Reference
- **Issue URL**: https://github.com/deep-assistant/hive-mind/issues/759
- **Related PR**: https://github.com/konard/hh-job-application-automation/pull/88
- **Uploaded Log Gist**: https://gist.github.com/konard/d5059763df5684ad9e436673a8af0bc3
- **PR Comment**: https://github.com/konard/hh-job-application-automation/pull/88#issuecomment-3592731009
- **Date**: 2025-11-30

## Executive Summary

The issue reported that the uploaded log was "cut off" when viewing a GitHub Gist. After thorough investigation, the root cause was identified as a **GitHub API/web interface rendering limit**, not an upload failure. The log file was fully uploaded (1.1MB, 6935 lines), but GitHub's web UI truncates display of files larger than ~1MB.

## Timeline of Events

| Timestamp (UTC) | Event |
|-----------------|-------|
| 15:40:27.048Z | solve.mjs starts logging to `/home/hive/solve-2025-11-30T15-40-27-046Z.log` |
| 15:40:47.558Z | Claude Code execution begins with session ID `dde412cc-b9ea-488f-8896-5ed4baa31eed` |
| 15:50:55.821Z | Claude Code execution completes successfully (`"type": "result", "subtype": "success"`) |
| 15:53:04.388Z | Anthropic cost calculated: $0.587388 |
| 15:53:04.999Z | Push changes to GitHub |
| 15:53:05.574Z | Changes pushed successfully |
| 15:53:05.575Z | Start uploading log to Pull Request as Gist |
| 15:53:05.640Z | Cost estimation logged: $1.239405 |
| 15:53:09Z | Gist created with 6933 additions |
| 15:53:11Z | PR comment posted with link to Gist |

## Technical Analysis

### What the User Saw (Screenshot)
The screenshot shows the GitHub Gist web page ending at **line 4310** with:
```json
"num_turns": 45,
```
This is clearly mid-JSON, suggesting the file was truncated.

### What Was Actually Uploaded
Using `gh gist view d5059763df5684ad9e436673a8af0bc3 --raw`:
- **Total lines**: 6935
- **File size**: 1,138,724 bytes (~1.1MB)
- **Gist creation status**: 6933 additions (complete upload)

### Root Cause: GitHub API/Web Display Limits

According to GitHub documentation and community discussions:

1. **GitHub Gist API returns up to 1MB** of content per file. Files larger than this have a `truncated: true` flag set.
2. **Web interface has rendering limits** for performance reasons - large files may not be fully displayed.
3. The `gh gist edit` CLI command is known to truncate files at approximately 900KB-1MB.

**Evidence supporting this conclusion:**
- Gist history shows a single commit with 6933 additions at creation time
- `gh gist view --raw` returns the complete file (6935 lines)
- The truncation occurs exactly at the ~1MB boundary
- No errors were logged during the upload process

### Code Path Analysis

The log upload flow in hive-mind:

1. `solve.results.lib.mjs:365` calls `attachLogToGitHub()`
2. `github.lib.mjs:446-778` handles the upload:
   - Line 476-478: Checks if file exceeds 100MB hard limit
   - Line 615-616: Checks if comment exceeds 65536 chars GitHub limit
   - Line 642-651: Creates gist via `gh gist create`
3. No checks exist for the 1MB web display limit

## Data Files Preserved

| File | Description | Size |
|------|-------------|------|
| `uploaded-log.txt` | Complete log downloaded from Gist | 1,138,724 bytes |
| `screenshot.png` | Screenshot showing truncated display | 1,046,528 bytes |
| `pr-comment-with-log.txt` | The PR comment JSON | ~300 bytes |

## Proposed Solutions

### Solution 1: Split Large Logs into Multiple Gist Files (Recommended)
Split logs larger than 900KB into multiple parts:
```javascript
const MAX_GIST_FILE_SIZE = 900 * 1024; // 900KB safe limit
if (logContent.length > MAX_GIST_FILE_SIZE) {
  // Split into multiple files: solution-draft-log-part1.txt, part2.txt, etc.
}
```
**Pros**: Works within GitHub's limits, all content viewable in browser
**Cons**: Slightly more complex viewing experience

### Solution 2: Add Warning When Log Exceeds Display Limit
Add a warning in the PR comment when the log exceeds ~1MB:
```markdown
## Solution Draft Log
...
**Note**: This log file is large (1.1MB). GitHub's web viewer may not display all content.
To view the complete log, use: `gh gist view <gist-id> --raw` or download the raw file.
```
**Pros**: Simple to implement, educates users
**Cons**: Doesn't solve the display issue

### Solution 3: Use External Logging Service
Upload large logs to an external service (e.g., S3, Pastebin) that doesn't have display limits.
**Pros**: No truncation issues
**Cons**: External dependency, potential privacy concerns, link rot

### Solution 4: Compress and Base64 Encode (Not Recommended)
Compress logs before upload.
**Pros**: Smaller file size
**Cons**: Not human-readable, defeats the purpose of logs

## Recommended Implementation

Implement **Solution 2** immediately (low effort, immediate value) and **Solution 1** in a follow-up PR:

```javascript
// In github.lib.mjs attachLogToGitHub function
const GIST_WEB_DISPLAY_LIMIT = 1024 * 1024; // 1MB

if (logStats.size > GIST_WEB_DISPLAY_LIMIT) {
  gistComment += `\n\n**Note**: This log file is large (${Math.round(logStats.size / 1024)}KB). GitHub's web viewer may truncate the display. To view the complete log, use:\n\`\`\`bash\ngh gist view ${gistId} --raw\n\`\`\``;
}
```

## Lessons Learned

1. **GitHub has multiple size limits** - file upload limit (100MB), API content limit (1MB), comment limit (65536 chars), and web display limits are all different.
2. **Silent truncation is dangerous** - the upload succeeded but the display was truncated without warning.
3. **Always verify end-to-end** - checking upload success is not enough; must verify display/retrieval too.

## References

- [GitHub Gist API Documentation](https://docs.github.com/en/rest/gists/gists)
- [Stack Overflow: Limits in GitHub gists](https://stackoverflow.com/questions/69078164/limits-in-github-gists)
- [GitHub CLI Issue #11739: gh gist edit truncates large files](https://github.com/cli/cli/issues/11739)
- [GitHub Community Discussion #46179: Large file display issues](https://github.com/orgs/community/discussions/46179)
