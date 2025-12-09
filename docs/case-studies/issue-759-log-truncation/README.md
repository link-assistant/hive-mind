# Case Study: Log Upload Truncation Issue (#759)

## Summary

This case study documents the investigation of issue #759 where uploaded logs to GitHub Gists were cut off or resulted in broken links. The investigation identified **three distinct root causes** affecting log uploads.

## Timeline of Events

### Event 1: PR #88 - Log Cut Off Mid-Content (2025-11-30T15:53)

1. **15:40:27** - solve.mjs started processing PR #88
2. **15:53:04** - Claude execution completed
3. **15:53:05** - Log upload process started
4. **15:53:05** - File was uploaded to gist while still being written

**Evidence:** The uploaded gist ends at line 6935 with:
```
[2025-11-30T15:53:05.640Z] [INFO]   💰 Calculated cost: $1.239405
```
The log was captured mid-write, missing the completion entries.

### Event 2: PR #100 - Gist Creation Failed (2025-11-30T17:40)

1. **17:40:07** - Log too long for comment (292,193 chars > 65,536 limit)
2. **17:40:09** - Attempted gist upload
3. **17:40:12** - **ERROR:** `$(...).quiet is not a function`
4. **17:40:14** - Fallback to comment also failed (body too long)

**Evidence:** From gist `7257b11a986a6e712f0e11ba7c56b572`:
```
[2025-11-30T17:40:12.712Z] [INFO]   ❌ Error creating gist: $(...).quiet is not a function
[2025-11-30T17:40:14.926Z] [INFO]   ❌ Failed to upload log to Pull Request: GraphQL: Body is too long (maximum is 65536 characters) (addComment)
```

### Event 3: PR #106 - Broken Gist Link (2025-11-30T19:12)

1. **19:12:35** - solve.mjs started processing issue #105
2. File uploaded with timestamp name: `solution-draft-log-pr-1764530686393.txt`
3. Link constructed with hardcoded name: `solution-draft-log.txt`
4. Result: **404 Not Found** when accessing the link

**Evidence:**
- Actual filename: `solution-draft-log-pr-1764530686393.txt`
- Link points to: `solution-draft-log.txt`
- HTTP response: 404

## Root Causes Identified

### Root Cause 1: Race Condition in Log Upload

**Location:** The log file is uploaded to gist before it finishes being written.

**Impact:** Partial/incomplete logs are uploaded.

**Mechanism:** The upload happens synchronously at line 6934-6935 while additional entries are still being appended to the log file.

### Root Cause 2: Unsupported `.quiet()` Method

**Location:** `src/github.lib.mjs` line 651

**Code:**
```javascript
const gistResult = await $(gistCommand);
```

**Issue:** The code attempts to use `.quiet()` method somewhere in the gist creation flow, but `command-stream`'s `$` function does not support this method.

**Impact:** Gist creation fails entirely, falling back to comment which also fails for large logs.

### Root Cause 3: Hardcoded Filename Mismatch

**Location:** `src/github.lib.mjs` lines 642-666

**Code:**
```javascript
// Line 642: File is created with timestamp
const tempLogFile = `/tmp/solution-draft-log-${targetType}-${Date.now()}.txt`;

// Line 666: URL is constructed with hardcoded name
const fileName = 'solution-draft-log.txt';
```

**Impact:** The constructed raw URL points to a non-existent file, resulting in 404 errors.

### Root Cause 4: GitHub Gist API Truncation (Informational)

**Note:** While investigating, we discovered that GitHub Gist API has a 1MB limit per file. Files larger than 1MB will have `truncated: true` in API responses. However, the raw URL can access the full content.

**API Limits:**
| Limit Type | Size |
|------------|------|
| API content per file | 1 MB (1,048,576 bytes) |
| Raw URL access | Up to 10 MB |
| Files requiring git clone | Over 10 MB |

## Affected Gists

| Gist ID | Size | Truncated | Issue |
|---------|------|-----------|-------|
| `d5059763df5684ad9e436673a8af0bc3` | 1,138,636 bytes | true (API view) | Incomplete at upload time |
| `7257b11a986a6e712f0e11ba7c56b572` | 293,818 bytes | false | Shows `.quiet()` error |
| `fb46027a3af2fa06c39174aa8116bdff` | 730,979 bytes | false | Broken link (filename mismatch) |

## Fixes Applied

### Fix 1: Remove `.quiet()` Usage (Previously Applied)

**Commit:** `7960660` - "Fix gist upload failure: remove .quiet() calls unsupported by command-stream"

The `.quiet()` method was removed from all calls since `command-stream` doesn't support it.

### Fix 2: Use Actual Filename from Gist API (This PR)

**Location:** `src/github.lib.mjs` line 666-668

The hardcoded filename `'solution-draft-log.txt'` was replaced with dynamic retrieval from the gist API response:

```javascript
// Before (broken):
const fileName = 'solution-draft-log.txt';

// After (fixed):
const fileNames = gistDetails.files ? Object.keys(gistDetails.files) : [];
const fileName = fileNames.length > 0 ? fileNames[0] : 'solution-draft-log.txt';
```

**Why the `--filename` flag doesn't work:** The `gh gist create --filename` flag only works when reading from stdin (`-`), not when providing a file path. When a file path is given, the original filename is preserved.

### Fix 3: Log Completeness (Out of Scope)

The log appearing incomplete (missing final entries) is likely a timing issue where the log upload happens before the file is fully flushed. This is a separate issue that may need further investigation but appears to be less critical since the solution process completed successfully.

## Evidence Files

- `screenshot-truncated-gist.png` - Screenshot showing truncated gist in browser
- `gist-d5059763-log.txt` - Full content of first truncated gist
- `gist-7257b11a-log.txt` - Log showing `.quiet()` error

## References

- Issue: https://github.com/deep-assistant/hive-mind/issues/759
- PR #88 Comment: https://github.com/konard/hh-job-application-automation/pull/88#issuecomment-3592731009
- GitHub Gist API Docs: https://docs.github.com/en/rest/gists/gists
- Stack Overflow - Gist Limits: https://stackoverflow.com/questions/69078164/limits-in-github-gists
