# Issue #587: Research Alternatives to GitHub Gist for Transferring Large Logs

## Problem Statement

The current implementation uses `gh gist create` to upload large log files when they exceed GitHub comment size limits (65KB). However, this approach fails for very large log files (e.g., 200MB) with the error:

```
X Failed to create gist: HTTP 422: Validation Failed (https://api.github.com/gists)
contents are too large and cannot be saved
```

## Current Implementation Analysis

### File Size Limits in Codebase

From `src/config.lib.mjs`:

- `commentMaxSize`: 65,536 bytes (64KB) - GitHub comment size limit
- `fileMaxSize`: 26,214,400 bytes (25MB) - Current gist size limit
- `issueBodyMaxSize`: 60,000 bytes (60KB)
- `attachmentMaxSize`: 10,485,760 bytes (10MB)

### Current Workflow (from `src/github.lib.mjs`)

1. If log fits in comment (< 64KB): Post inline in comment
2. If log > 64KB but < 25MB: Create GitHub Gist and link to it
3. If gist creation fails: Fall back to truncated comment

### GitHub Gist Actual Limits (from research)

- **Web Interface**: 25MB per file (current limit in config)
- **Git Push**: 100MB per file
- **API (gh gist create)**: Unclear, but appears to have stricter limits
- **Total Gist Size**: Recommended < 5GB

## Alternative Solutions

### Option 1: GitHub Releases Assets ✅ RECOMMENDED

**Pros:**

- Can handle very large files (up to 2GB per file)
- Native GitHub integration
- Permanent storage
- Can be referenced in issues/PRs
- Works with `gh` CLI

**Cons:**

- Requires creating a release or draft release
- May clutter releases page if not using draft releases

**Implementation:**

```bash
# Create a draft release with log file as asset
gh release create temp-log-$(date +%s) --draft --repo owner/repo --notes "Temporary log storage"
gh release upload temp-log-$(date +%s) logfile.txt --repo owner/repo
```

### Option 2: GitHub Actions Artifacts

**Pros:**

- Designed for log storage
- Automatic cleanup after 90 days
- Part of GitHub ecosystem

**Cons:**

- Requires a workflow run
- More complex to set up
- Not as directly accessible

### Option 3: Split Large Files

**Pros:**

- Works within existing gist infrastructure
- No new dependencies

**Cons:**

- Complex to implement
- Poor user experience (multiple links)
- Still hits overall gist size limits

### Option 4: External Services (Pastebin, PrivateBin, etc.)

**Pros:**

- Designed for large text files
- Simple API

**Cons:**

- External dependency
- Security concerns (data leaves GitHub ecosystem)
- Requires additional authentication

### Option 5: Git LFS in Temporary Branch

**Pros:**

- Native Git solution
- Can handle any file size

**Cons:**

- Requires Git LFS setup
- Complex implementation
- Storage costs for repository owner

### Option 6: Chunked Upload to Multiple Gists

**Pros:**

- Works within current infrastructure
- No new dependencies

**Cons:**

- Complex to implement
- Poor UX (multiple links)
- May hit API rate limits

## Recommended Solution

**Two-Tier Approach:**

1. **For files 25MB - 100MB**: Use git push to create gist instead of `gh gist create`
   - Clone empty gist repo
   - Add log file
   - Push via git (allows up to 100MB)

2. **For files > 100MB**: Compress and chunk the file
   - Compress log with gzip (logs compress well, typically 10:1 ratio)
   - If still > 100MB after compression, split into chunks
   - Upload as multiple gist files or use releases

## Implementation Plan

### Phase 1: Enhanced Gist Upload (25MB - 100MB)

- Detect when gh gist create fails
- Fall back to git-based gist creation
- Test with files up to 100MB

### Phase 2: Compression (All sizes)

- Always compress logs before upload
- Include decompression instructions in comment
- Expected 80-90% size reduction for text logs

### Phase 3: Chunking for Extreme Cases (> 100MB compressed)

- Split compressed logs into 50MB chunks
- Upload each chunk as separate gist file
- Provide reassembly script in comment

### Phase 4: Alternative - GitHub Releases (Optional)

- For repositories where releases are appropriate
- Use draft releases to avoid cluttering release page
- Automatic cleanup after 90 days

## Size Reduction Estimates

For text logs:

- Original: 200MB
- After gzip compression: ~20-30MB (fits in single gist via git push)
- Compression ratio: 10:1 to 7:1 (typical for logs)

## Code Changes Required

1. `src/github.lib.mjs` - Update `attachLogToGitHub()` function
2. `src/config.lib.mjs` - Add new config for compression options
3. Add compression utility functions
4. Add git-based gist upload function
5. Update error handling and fallback logic

## Testing Strategy

1. Create test logs of various sizes: 1MB, 10MB, 50MB, 100MB, 200MB
2. Test compression ratios
3. Test git-based gist upload
4. Test chunking for extreme cases
5. Verify error handling and fallbacks

## Success Criteria

- [ ] Logs up to 100MB (compressed) upload successfully
- [ ] Logs > 100MB are handled gracefully (chunked or alternative method)
- [ ] No breaking changes to existing functionality
- [ ] Clear user feedback during upload process
- [ ] Automatic fallback if upload fails
