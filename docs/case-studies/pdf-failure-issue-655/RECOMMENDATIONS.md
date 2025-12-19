# Recommendations for PDF Processing Improvements

## Executive Summary

This document provides actionable recommendations for preventing PDF processing failures in both Claude Code CLI and the hive-mind solver, based on the analysis of issue #655.

## Short-term Recommendations (Can be implemented immediately)

### 1. Add Size Validation to hive-mind Guidelines

**For**: hive-mind solver system prompt

**Action**: Add explicit guidelines for handling large files:

```markdown
When working with PDF files:
- Before using the Read tool on PDFs, check file sizes using ls -lh or stat
- If a single PDF exceeds 2MB, or total PDFs exceed 5MB, process them sequentially or in chunks
- Consider extracting specific pages or sections instead of reading entire large PDFs
- Warn the user if PDFs are too large and suggest alternatives
```

**Priority**: HIGH
**Effort**: LOW (1-2 hours)
**Impact**: Prevents similar failures immediately

### 2. Create PDF Processing Helper Script

**For**: hive-mind solver repository

**Action**: Add a helper script for safe PDF processing:

```bash
#!/bin/bash
# scripts/safe-pdf-read.sh
# Checks PDF size before attempting to read

PDF_FILE="$1"
MAX_SIZE_MB=2

if [ ! -f "$PDF_FILE" ]; then
    echo "Error: File not found: $PDF_FILE"
    exit 1
fi

SIZE_BYTES=$(stat -f%z "$PDF_FILE" 2>/dev/null || stat -c%s "$PDF_FILE" 2>/dev/null)
SIZE_MB=$((SIZE_BYTES / 1024 / 1024))

if [ $SIZE_MB -gt $MAX_SIZE_MB ]; then
    echo "Warning: PDF is ${SIZE_MB}MB, which exceeds recommended ${MAX_SIZE_MB}MB limit"
    echo "Recommend: Process page-by-page or extract text first"
    exit 2
fi

echo "OK: PDF size ${SIZE_MB}MB is within limits"
exit 0
```

**Usage in solver**:
```bash
# Before reading PDF
./scripts/safe-pdf-read.sh "Manual.pdf"
if [ $? -eq 0 ]; then
    # Safe to read
    claude --read "Manual.pdf"
else
    # Too large, use alternative approach
    pdftotext "Manual.pdf" "Manual.txt"
fi
```

**Priority**: MEDIUM
**Effort**: LOW (2-3 hours)
**Impact**: Provides immediate workaround

### 3. Document Known Limitations

**For**: hive-mind README and documentation

**Action**: Add a "Known Limitations" section:

```markdown
## Known Limitations

### PDF Processing
- **Maximum single PDF size**: 2MB (recommended)
- **Maximum total PDFs per request**: 5MB (recommended)
- **Workaround**: For larger PDFs, extract text first using `pdftotext` or process page-by-page

### Large File Handling
- Files exceeding context window limits cannot be processed in a single request
- Use chunking or streaming approaches for files >1MB
```

**Priority**: HIGH
**Effort**: LOW (1 hour)
**Impact**: Sets proper user expectations

## Medium-term Recommendations (1-2 weeks)

### 4. Implement Text Extraction Fallback

**For**: hive-mind solver

**Action**: Add automatic fallback to text extraction for large PDFs:

```javascript
// In solve.mjs or similar
async function safePdfRead(pdfPath) {
    const stats = await fs.stat(pdfPath);
    const sizeMB = stats.size / (1024 * 1024);

    if (sizeMB > 2) {
        console.log(`PDF is ${sizeMB.toFixed(1)}MB, using text extraction instead`);
        // Use pdftotext or similar
        const textPath = pdfPath.replace('.pdf', '.txt');
        await exec(`pdftotext "${pdfPath}" "${textPath}"`);
        return await fs.readFile(textPath, 'utf-8');
    }

    // Use normal Read tool
    return await claudeRead(pdfPath);
}
```

**Priority**: HIGH
**Effort**: MEDIUM (1-2 days)
**Impact**: Automatically handles large PDFs

### 5. Add Pre-flight Checks to Solver

**For**: hive-mind solve.mjs

**Action**: Add validation before starting Claude execution:

```javascript
// Before executing Claude
async function validateWorkingDirectory(dir) {
    const issues = [];

    // Find all PDFs
    const pdfs = await glob('**/*.pdf', { cwd: dir });

    let totalSize = 0;
    for (const pdf of pdfs) {
        const stats = await fs.stat(path.join(dir, pdf));
        totalSize += stats.size;

        if (stats.size > 2 * 1024 * 1024) {
            issues.push({
                type: 'large_pdf',
                file: pdf,
                size: stats.size,
                recommendation: 'Extract text first using pdftotext'
            });
        }
    }

    if (totalSize > 5 * 1024 * 1024) {
        issues.push({
            type: 'total_pdf_size',
            totalSize,
            recommendation: 'Process PDFs sequentially instead of simultaneously'
        });
    }

    return issues;
}
```

**Priority**: MEDIUM
**Effort**: MEDIUM (2-3 days)
**Impact**: Prevents failures before they occur

### 6. Create PDF Processing Agent

**For**: hive-mind solver

**Action**: Create a specialized agent for PDF processing:

```markdown
## PDF Processing Agent

Specialized agent for handling PDF files safely:
- Checks file sizes before processing
- Automatically chunks large PDFs
- Extracts text when full PDF reading isn't possible
- Processes multiple PDFs sequentially
- Provides progress updates
```

**Priority**: MEDIUM
**Effort**: MEDIUM (3-5 days)
**Impact**: Professional PDF handling capability

## Long-term Recommendations (1-3 months)

### 7. Propose Claude Code CLI Enhancement

**For**: Claude Code CLI (anthropics/claude-code)

**Action**: Create feature request for PDF handling improvements:

**Proposed Features**:
1. **Size validation before reading**:
   - Check file size before attempting to read
   - Return clear error if file exceeds limits
   - Suggest alternatives (chunking, text extraction)

2. **Paginated PDF reading**:
   ```javascript
   Read({
     file_path: "large.pdf",
     pdf_pages: "1-10"  // Read only pages 1-10
   })
   ```

3. **Automatic text extraction option**:
   ```javascript
   Read({
     file_path: "large.pdf",
     extract_text_only: true  // Skip images, formatting
   })
   ```

4. **Size limit documentation**:
   - Clear docs on max PDF size
   - Token count estimation before reading
   - Best practices for large PDFs

**Priority**: HIGH
**Effort**: LOW (for proposal), HIGH (for implementation)
**Impact**: Fixes root cause for all users

### 8. Implement Streaming PDF Processing

**For**: Claude Code CLI or hive-mind

**Action**: Support streaming/chunked PDF processing:

**Concept**:
```javascript
// Process PDF in chunks
async function* streamPdfPages(pdfPath, chunkSize = 5) {
    const pageCount = await getPdfPageCount(pdfPath);

    for (let i = 0; i < pageCount; i += chunkSize) {
        const endPage = Math.min(i + chunkSize, pageCount);
        yield await extractPdfPages(pdfPath, i, endPage);
    }
}

// Usage
for await (const chunk of streamPdfPages('large.pdf')) {
    const analysis = await claude.analyze(chunk);
    results.push(analysis);
}
```

**Priority**: MEDIUM
**Effort**: HIGH (1-2 weeks)
**Impact**: Enables processing of unlimited PDF sizes

### 9. Add PDF Processing to Contributing Guidelines

**For**: link-assistant/hive-mind repository

**Action**: Add section to CONTRIBUTING.md:

```markdown
## Working with PDF Files

### Size Limits
- Single PDF: Max 2MB (recommended)
- Multiple PDFs: Max 5MB total (recommended)
- If exceeded: Process sequentially or extract text

### Best Practices
1. Check PDF size before processing:
   ```bash
   ls -lh *.pdf
   ```

2. For large PDFs, extract text first:
   ```bash
   pdftotext large.pdf large.txt
   ```

3. Process PDFs one at a time:
   ```bash
   for pdf in *.pdf; do
       process_pdf "$pdf"
   done
   ```

4. Use page ranges for very large PDFs:
   ```bash
   pdftk large.pdf cat 1-10 output first10.pdf
   ```

### Tools Available
- `pdftotext`: Extract plain text
- `pdftk`: Split, merge, rotate PDFs
- `pdfinfo`: Get PDF metadata
- `gs` (ghostscript): Compress PDFs

### Examples
See `examples/pdf-processing/` for working examples.
```

**Priority**: MEDIUM
**Effort**: LOW (2-3 hours)
**Impact**: Educates contributors

### 10. Create PDF Processing Examples

**For**: link-assistant/hive-mind repository

**Action**: Add example scripts in `examples/pdf-processing/`:

1. `extract-text-from-large-pdf.sh` - Text extraction example
2. `process-pdfs-sequentially.sh` - Sequential processing
3. `split-large-pdf.sh` - PDF splitting
4. `compress-pdf.sh` - PDF compression
5. `README.md` - Documentation for examples

**Priority**: LOW
**Effort**: MEDIUM (1 week)
**Impact**: Provides ready-to-use solutions

## Implementation Priority

### Phase 1: Immediate (This Week)
1. Add size validation to hive-mind guidelines ✓
2. Document known limitations ✓
3. Create case study (current work) ✓

### Phase 2: Short-term (Next 2 Weeks)
4. Implement text extraction fallback
5. Add pre-flight checks to solver
6. Create PDF processing helper script

### Phase 3: Medium-term (Next Month)
7. Propose Claude Code CLI enhancement
8. Create PDF processing agent
9. Add PDF processing to contributing guidelines

### Phase 4: Long-term (Next Quarter)
10. Implement streaming PDF processing
11. Create comprehensive PDF processing examples
12. Consider external PDF processing service

## Success Metrics

### Immediate Success
- No more "CLAUDE execution failed" errors for large PDFs
- Clear error messages when PDFs are too large
- Users understand limitations

### Long-term Success
- PDFs of any size can be processed (via chunking)
- Automatic fallback mechanisms work seamlessly
- Zero user confusion about PDF handling

## Conclusion

The PDF processing failure can be addressed at multiple levels:
1. **User education**: Document limitations clearly
2. **Defensive coding**: Add size checks and validations
3. **Graceful degradation**: Automatically use text extraction for large files
4. **Tool enhancement**: Improve Claude Code CLI's PDF handling

The recommended approach is to implement solutions at all levels:
- Short-term: Education and defensive coding (this week)
- Medium-term: Automatic fallbacks (next month)
- Long-term: Tool enhancement (next quarter)

This layered approach provides immediate relief while working toward a comprehensive solution.
