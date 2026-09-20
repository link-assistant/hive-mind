## Bug: Gist upload fails for ~50MB+ files with HTTP 502, but tool reports success

### Description

When using `gh-upload-log` in auto mode (default) to upload files around 50-70MB, the GitHub Gist API returns HTTP 502 Server Error. However, the tool incorrectly reports "Gist created successfully" without a URL.

### Steps to Reproduce

1. Create a ~50MB test file:

   ```bash
   dd if=/dev/urandom bs=1M count=50 | base64 > test-50mb.log
   # Actual file size after base64: ~67.54 MB
   ```

2. Upload with gh-upload-log:
   ```bash
   gh-upload-log test-50mb.log --private --verbose
   ```

### Expected Behavior

- Either successfully upload as a gist, or
- Detect the failure and fallback to repository mode automatically, or
- Show an error without claiming success

### Actual Behavior

```
File size: 67.54 MB
Strategy: File fits within GitHub Gist limit (100MB)
...
- Creating gist test-50mb.log
X Failed to create gist: HTTP 502: Server Error (https://api.github.com/gists)
Gist created successfully:
✅ Gist created (🔒 private)
```

Note: The tool shows the failure (`X Failed to create gist`) but then says "Gist created successfully" with empty URL.

### Workaround

Force repository mode for files >50MB:

```bash
gh-upload-log test-50mb.log --only-repository --private
```

This works correctly and creates a repository with the file.

### Test Results

| File Size (original) | Encoded Size | Mode | Result                                    |
| -------------------- | ------------ | ---- | ----------------------------------------- |
| 10 MB                | 13.51 MB     | gist | ✅ Success                                |
| 50 MB                | 67.54 MB     | gist | ❌ HTTP 502 (incorrectly reports success) |
| 99 MB                | 133.74 MB    | repo | ✅ Success (2 chunks)                     |
| 101 MB               | 136.44 MB    | repo | ✅ Success (2 chunks)                     |
| 200 MB               | 270.18 MB    | repo | ✅ Success (3 chunks)                     |
| 300 MB               | 405.26 MB    | repo | ✅ Success (5 chunks)                     |
| 500 MB               | 675.44 MB    | repo | ✅ Success (7 chunks)                     |

### Suggested Fix

1. **Fix success detection**: Don't report success when gist creation fails
2. **Lower gist threshold**: Consider lowering the automatic gist threshold from 100MB to ~25-50MB since GitHub Gist API seems unreliable for large files
3. **Add fallback**: When gist upload fails, automatically fall back to repository mode

### Environment

- gh-upload-log version: (latest from npm)
- OS: Linux (Ubuntu)
- gh version: (latest)
