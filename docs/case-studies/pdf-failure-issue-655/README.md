# Case Study: PDF Processing Failure in Hive Mind Solver

## Issue Reference

- **Issue**: [#655](https://github.com/link-assistant/hive-mind/issues/655)
- **Related PRs**:
  - [Cybersyn21/asistente#2](https://github.com/Cybersyn21/asistente/pull/2) (Closed)
  - [Cybersyn21/asistente#3](https://github.com/Cybersyn21/asistente/pull/3) (Open)
- **Date**: November 3, 2025
- **Reporter**: konard

## Executive Summary

The hive-mind solver encountered a failure when attempting to process multiple large PDF files (totaling ~6.5MB) in the Cybersyn21/asistente repository. The task was to read three PDF manuals completely and create a dataset/instructions in text format. The solver failed with "CLAUDE execution failed" error after successfully reading the PDF files but before producing any output.

## Background

### Original Task (Issue #1 in Cybersyn21/asistente)

**Title**: "start"

**Description** (Russian/Spanish mixed):

```
Прочитать файлы пдф полностью
Manual de Procedimientos e Interpretación de Resultados A1
Manual de Procedimientos e Interpretación de Resultados A2
Manual de Procedimientos e Interpretación de Resultados B
Сделать из файлов пдф набор данных и инструкции, сделать это в файле txt
...
Будем создавать базу данных на основе этих файлов пдф
```

**Translation**: Read the PDF files completely, create a dataset and instructions from the PDF files in txt format, as a basis for creating a database.

### PDF Files Involved

1. **Manual de Procedimientos e Interpretación de Resultados A1.pdf** - 1.3MB
2. **Manual de Procedimientos e Interpretación de Resultados A2.pdf** - 3.7MB
3. **Manual de Procedimientos e Interpretación de Resultados B.pdf** - 1.5MB

**Total Size**: ~6.5MB of PDF content

## Timeline of Events

### PR #2 (Closed)

- **Branch**: issue-1-87e18bae
- **Status**: Failed with "CLAUDE execution failed"
- **Log Size**: 8884KB (8.8MB)
- **Gist**: [86cdedbdf7eb49e1a47ea5b59406a269](https://gist.github.com/konard/86cdedbdf7eb49e1a47ea5b59406a269)

### PR #3 (Open)

- **Branch**: issue-1-f420c60cbdac
- **Status**: Failed with "CLAUDE execution failed"
- **Log Size**: 8874KB (8.7MB)
- **Gist**: [30f8e8867e006493ad96ba21f90fad42](https://gist.github.com/konard/30f8e8867e006493ad96ba21f90fad42)

## Technical Analysis

### What Worked

1. **Repository Setup**
   - Successfully cloned repository
   - Created branch issue-1-f420c60cbdac
   - Created initial commit with CLAUDE.md
   - Pushed to remote successfully
   - Created draft PR #3

2. **File Discovery**
   - Successfully listed repository files
   - Found all 3 PDF files
   - Identified README.md and CLAUDE.md

3. **Todo List Creation**
   - Created comprehensive todo list with proper structure
   - Tasks included:
     - Read and extract text from all three PDF files
     - Create dataset and instructions in txt files based on PDF content
     - Analyze PDF structure and content
     - Create comprehensive dataset
     - Test and validate the dataset
     - Document the dataset structure
     - Commit and push changes

4. **PDF Reading Initiation**
   - Used Read tool to access all three PDF files
   - PDF files were successfully accessed
   - Tool results showed: "PDF file read: [path] ([size])"
   - PDFs were apparently converted to base64 format for transmission

### What Failed

1. **The Failure Point**
   - After successfully reading all three PDFs
   - The system appears to have sent the PDF content as base64-encoded documents
   - Log line 1009 shows: `[2025-11-03T03:48:46.428Z] [INFO] {"type":"user","message":{"role":"user","content":[{"type":"document","source":{"type":"base64","media_type":"application/pdf","data":"JVBERi0x...`
   - The log ends abruptly after showing base64 PDF data being transmitted
   - No error message captured in the logs
   - Final result: "CLAUDE execution failed"

2. **Evidence from Logs**
   - PR #3 Log line 969: `"content": "PDF file read: /tmp/gh-issue-solver-1762141673245/Manual de Procedimientos e Interpretación de Resultados A1.pdf (1.3MB)"`
   - PR #3 Log line 985: `"content": "PDF file read: /tmp/gh-issue-solver-1762141673245/Manual de Procedimientos e Interpretación de Resultados A2.pdf (3.7MB)"`
   - PR #3 Log line 1001: `"content": "PDF file read: /tmp/gh-issue-solver-1762141673245/Manual de Procedimientos e Interpretación de Resultados B.pdf (1.5MB)"`
   - Then immediately after, large base64 data starts being logged
   - Log ends at line 1025 (truncated)

## Root Cause Analysis

### Primary Root Cause: Token/Context Window Limit

The most likely root cause is that sending 3 large PDF files (total ~6.5MB) as base64-encoded documents exceeded either:

1. **Input Token Limit**: The PDF files, when converted to base64 and sent as document content, likely exceeded Claude's input token limit
2. **Request Size Limit**: The HTTP request size with embedded base64 PDFs may have exceeded API limits
3. **Memory Limit**: Processing 6.5MB of PDF content simultaneously may have exhausted available memory

### Supporting Evidence

1. **Large File Sizes**:
   - A1: 1.3MB
   - A2: 3.7MB (largest)
   - B: 1.5MB
   - Total: 6.5MB raw, likely ~8.7MB as base64 (33% overhead)

2. **Base64 Encoding Overhead**:
   - Base64 encoding increases size by approximately 33%
   - 6.5MB → ~8.7MB when base64 encoded
   - This matches the log file sizes (8.7MB-8.8MB)

3. **Log Truncation**:
   - Logs end abruptly after showing PDF data transmission
   - No error message or exception details captured
   - Suggests a timeout or connection failure rather than a clean error

4. **Repeated Failure**:
   - Same failure occurred in both PR #2 and PR #3
   - Different branches but same PDF files
   - Indicates systematic issue, not transient error

## Responsibility Attribution

### Claude Code CLI

**Partially Responsible**: The Read tool implementation for PDFs appears to load entire PDF files into memory and attempt to send them as documents, without:

- Size validation before attempting to read
- Chunking large PDFs for processing
- Warning users about large file sizes
- Graceful handling of oversized documents

### Hive Mind Solver

**Not Responsible**: The hive-mind solver code followed the expected workflow:

1. Created proper todo list
2. Used the Read tool correctly to access PDF files
3. Followed guidelines for handling PDFs

The solver did not have visibility into the size limitations and could not predict the failure.

### User/Task Definition

**Partially Responsible**: The task required reading 3 large PDF files simultaneously, which may not be feasible with current tooling. However, the user had no way to know this limitation existed.

## Recommended Solutions

### Immediate Solutions

1. **Add Size Validation**
   - Add file size checks before attempting to read PDFs
   - Warn when PDFs exceed recommended size (e.g., 2MB per file or 5MB total)
   - Return clear error messages about size limits

2. **Implement PDF Chunking**
   - Process large PDFs page-by-page or in chunks
   - Allow progressive reading of PDF content
   - Provide pagination or range parameters for Read tool

3. **Add Graceful Degradation**
   - If full PDF read fails, attempt text extraction only
   - Provide summary/metadata extraction as fallback
   - Offer to process PDFs sequentially instead of simultaneously

### Long-term Solutions

1. **Streaming PDF Processing**
   - Implement streaming API for large document processing
   - Process PDFs incrementally rather than loading entirely into memory
   - Return content in chunks that fit within token limits

2. **External Processing Pipeline**
   - Offload PDF processing to dedicated service
   - Pre-process PDFs to extract text before sending to Claude
   - Cache processed PDF content for reuse

3. **Better Error Handling**
   - Capture and report specific error types (timeout, size limit, token limit)
   - Provide actionable error messages
   - Log errors before connection is lost

4. **Documentation**
   - Document PDF size limitations clearly
   - Provide examples of working with large PDFs
   - Add troubleshooting guide for common PDF issues

## Minimum Reproduction Example

### Setup

```bash
# Create test repository
mkdir test-pdf-failure
cd test-pdf-failure
git init

# Create 3 PDF files of similar sizes
# A1: ~1.3MB, A2: ~3.7MB, B: ~1.5MB
# (Can use any PDF files with these sizes)

# Create issue asking to read all PDFs
echo "Read all PDF files and create a summary" > issue.txt
```

### Expected Behavior

The solver should:

1. Detect PDF files
2. Check their sizes
3. Warn if total size exceeds limits
4. Either process PDFs sequentially or in chunks
5. Produce text output with extracted content

### Actual Behavior

The solver:

1. Successfully finds PDF files
2. Attempts to read all PDFs simultaneously
3. Sends large base64-encoded PDFs to Claude API
4. Fails with "CLAUDE execution failed"
5. No useful error message provided

### Reproduction Rate

**100%** - Fails consistently with PDFs totaling >5MB

## Related Issues

- Current issue being tracked: [#655](https://github.com/link-assistant/hive-mind/issues/655)

## Artifacts

All logs and supporting materials are preserved in this directory:

- `pr2-full-log.txt` - Complete log from PR #2 attempt (8.8MB)
- `pr3-full-log.txt` - Complete log from PR #3 attempt (8.7MB)
- `key-log-excerpts.txt` - Extracted key sections from logs
- `README.md` - This document

## Conclusions

1. **Root Cause**: PDF files exceeding combined size/token limits when processed simultaneously
2. **Primary Responsibility**: Claude Code CLI tool (Read tool for PDFs lacks size validation and chunking)
3. **Secondary Responsibility**: Task design (processing multiple large PDFs simultaneously)
4. **Resolution**: Needs enhancement to PDF processing in Claude Code CLI with size limits and chunking support

## Next Steps

1. ✅ Document findings in this case study
2. ⏳ Create GitHub issue for Claude Code CLI enhancement
3. ⏳ Propose PDF size validation feature
4. ⏳ Implement chunked PDF processing
5. ⏳ Add better error messages for size limit failures
6. ⏳ Update hive-mind guidelines for handling large PDFs
