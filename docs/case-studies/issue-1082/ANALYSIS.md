# Case Study: "PDF too large" Error in Claude Code CLI

**Issue ID**: [#1082](https://github.com/link-assistant/hive-mind/issues/1082)
**Date of Incident**: 2026-01-08
**Status**: Analysis Complete

## Executive Summary

This case study documents an incident where an AI issue solver using Claude Code CLI encountered a "PDF too large" error when attempting to read a 4.4MB PDF file. The error caused the entire session to fail and blocked any further processing.

## Incident Overview

### Task Description

The AI solver was assigned to solve [issue #21](https://github.com/bpmbpm/draw-vad/issues/21) in the `bpmbpm/draw-vad` repository, which requested:
- Full translation of a PDF document (`10-0sr6_Method_Manual.pdf`)
- Split into 17 separate PDF files (one per chapter)
- Upload translated files to the repository

### What Happened

The AI solver attempted to read the source PDF file (4.4MB, 372+ pages) using Claude Code's built-in Read tool, which triggered the "PDF too large" error and terminated the session.

## Timeline of Events

| Timestamp (UTC) | Event |
|-----------------|-------|
| 18:28:37 | Solve v0.54.4 started for issue #21 |
| 18:28:49 | Repository cloned successfully |
| 18:28:55 | Issue details fetched - task requires translating a PDF |
| 18:29:08 | Claude Code execution started (Opus model) |
| 18:29:19 | AI reviewed issue and identified source PDF |
| 18:30:03 | AI downloaded PDF (4.4MB) via curl |
| 18:30:09 | AI attempted to read PDF using Read tool |
| 18:30:10 | **Error**: "PDF too large. Please double press esc to edit your message and try again." |
| 18:30:11 | Session terminated with error |

**Total session duration**: ~1 minute 34 seconds
**API turns**: 16

## Root Cause Analysis

### Primary Cause

Claude Code CLI has a hard limit on PDF file processing. The limits include:
- **Token limit**: 25,000 tokens maximum for file reading
- **Page limit**: 100 pages maximum for standard vision analysis
- **Size limit**: Files exceeding ~32MB trigger immediate errors

The 4.4MB PDF file with 372+ pages exceeded multiple thresholds.

### Secondary Issues

1. **Lack of graceful degradation**: Instead of offering alternative approaches (chunking, text extraction), the error terminated the session completely.

2. **Known persistent bug**: This is a well-documented bug in Claude Code CLI where after the "PDF too large" error occurs, the session enters an infinite error loop where ALL subsequent inputs receive the same error message, regardless of content.

3. **No warning before failure**: The system did not warn about the PDF size before attempting to read it, wasting API calls and context.

## Error Evidence

From the log file:

```json
{
  "content": [
    {
      "type": "text",
      "text": "PDF too large. Please double press esc to edit your message and try again."
    }
  ],
  "error": "invalid_request"
}
```

```
PDF file read: /tmp/gh-issue-solver-1767896925304/experiments/10-0sr6_Method_Manual.pdf (4.4MB)
```

## Related GitHub Issues

This error is a known, persistent bug in Claude Code CLI with multiple reports:

| Issue | Title | Status | Date |
|-------|-------|--------|------|
| [#13518](https://github.com/anthropics/claude-code/issues/13518) | "PDF too large" error persists and blocks all PDF reading | OPEN | Dec 2025 |
| [#11527](https://github.com/anthropics/claude-code/issues/11527) | Oversized PDF kills the REPL | OPEN | Nov 2025 |
| [#9789](https://github.com/anthropics/claude-code/issues/9789) | PDF too large | Closed (Duplicate) | Oct 2025 |
| [#15054](https://github.com/anthropics/claude-code/issues/15054) | PDF file size limit prevents processing of large documents | Closed (Duplicate) | Dec 2025 |
| [#8077](https://github.com/anthropics/claude-code/issues/8077) | Claude Code crashes when reading large PDF files | OPEN | Sep 2025 |

### Bug Characteristics

1. **Infinite error loop**: After the error occurs once, ALL subsequent requests return the same "PDF too large" error
2. **REPL becomes unresponsive**: Even commands like `version` or text messages receive the error
3. **Session termination required**: Users must kill the session and restart to recover
4. **Context loss**: All progress and context are lost when the session terminates

## Proposed Solutions

### Immediate Workarounds

#### 1. Pre-emptive PDF Conversion to Text

Add to `.claude/CLAUDE.md` or system prompts:

```markdown
## PDF Processing

# NEVER use the Read tool to open PDF files directly
# ALWAYS extract PDFs to text first using pdftotext via Bash
# Reading large PDFs can cause crashes and loss of work

### Workflow:
1. Check PDF file size and page count before processing
2. Use pdftotext or similar tools to extract text first
3. Process the text file instead of the PDF
4. Keep extracted .txt files alongside PDFs for future reference
```

**Example command:**
```bash
pdftotext document.pdf document.txt
# Then read document.txt instead
```

#### 2. PDF Chunking Before Processing

For large PDFs, split into smaller chunks first:

```python
from pypdf import PdfReader, PdfWriter

def split_pdf(input_path, pages_per_chunk=25):
    reader = PdfReader(input_path)
    total_pages = len(reader.pages)

    for start in range(0, total_pages, pages_per_chunk):
        writer = PdfWriter()
        end = min(start + pages_per_chunk, total_pages)

        for page_num in range(start, end):
            writer.add_page(reader.pages[page_num])

        output_path = f"{input_path.stem}_part{start//pages_per_chunk + 1}.pdf"
        with open(output_path, 'wb') as output_file:
            writer.write(output_file)
```

#### 3. Size Check Before Read Attempt

Add pre-check logic:

```bash
# Check file size before attempting to read
PDF_SIZE=$(stat -c%s "$PDF_FILE" 2>/dev/null || stat -f%z "$PDF_FILE")
PDF_SIZE_MB=$((PDF_SIZE / 1024 / 1024))

if [ "$PDF_SIZE_MB" -gt 4 ]; then
    echo "Warning: PDF is ${PDF_SIZE_MB}MB - extracting text instead"
    pdftotext "$PDF_FILE" "${PDF_FILE%.pdf}.txt"
fi
```

#### 4. Use `/rewind` Command

If the error occurs in interactive mode:
```
/rewind
```
This reverts to the state before the failed PDF read.

### Suggested Fix for Claude Code CLI

**For Anthropic developers** - The following improvements would address this issue:

1. **Pre-flight size check**: Check PDF size/pages before attempting to process and warn/offer alternatives

2. **Graceful error handling**: Don't enter infinite error loop - return to normal operation after error

3. **Chunked reading**: Implement automatic chunking for large PDFs with `offset` and `limit` parameters

4. **Alternative suggestions**: When PDF is too large, suggest:
   - Using `pdftotext` extraction
   - Splitting the PDF
   - Reading specific page ranges

5. **Clear limits documentation**: Document the exact limits (tokens, pages, file size) in the CLI help

## Lessons Learned

1. **Always pre-check file sizes** before attempting to read large files in Claude Code
2. **Prefer text extraction** over direct PDF reading for documents > 10MB or > 50 pages
3. **Use defensive prompts** that instruct AI not to directly read large PDFs
4. **Monitor known issues** in the Claude Code repository for workarounds
5. **Save progress frequently** when working with large documents to minimize context loss

## Files in This Case Study

- `README.md` - This analysis document
- `solution-draft-log.txt` - Full log file from the failed session
- `workarounds.md` - Detailed workaround implementations

## References

- [Claude Code CLI GitHub Repository](https://github.com/anthropics/claude-code)
- [Issue #13518: PDF too large error persists](https://github.com/anthropics/claude-code/issues/13518)
- [Issue #11527: Oversized PDF kills the REPL](https://github.com/anthropics/claude-code/issues/11527)
- [Issue #8077: tool_use/tool_result block mismatch](https://github.com/anthropics/claude-code/issues/8077)
- [Original incident issue](https://github.com/link-assistant/hive-mind/issues/1082)
- [Original PR that failed](https://github.com/bpmbpm/draw-vad/pull/22)

## Conclusion

The "PDF too large" error is a known, persistent bug in Claude Code CLI that has affected multiple users throughout late 2025 and into 2026. While Anthropic has not yet provided an official fix, several workarounds are available. The most effective approach is to never attempt to read large PDFs directly, instead extracting text first using tools like `pdftotext` or splitting large PDFs into smaller chunks.

Until this bug is fixed, AI automation systems using Claude Code should implement pre-emptive checks and defensive coding practices to avoid triggering this error and losing session progress.
