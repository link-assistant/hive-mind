# Case Study: Private GitHub Image Download Failure

**Issue:** [#1369 - Make it more clear how to correctly download images from private issues on GitHub in our system messages](https://github.com/link-assistant/hive-mind/issues/1369)

**Related PR:** [#1370](https://github.com/link-assistant/hive-mind/pull/1370)

**Evidence Log:** [solution-draft-log-pr-1772407434391.txt](./solution-draft-log.txt) (from [original Gist](https://gist.githubusercontent.com/konard/2798035d47e7e3686e0e173d28e80823/raw/78a5b650433ce760a7b5b4c1af017aee6edc0a5f/solution-draft-log-pr-1772407434391.txt))

---

## Executive Summary

The AI solver crashed with `API Error: 400 - Could not process image` while trying to analyze a screenshot attached to a private GitHub issue. The root cause was **unauthenticated download of a private GitHub user-attachment image**, which returned "Not Found" (9 bytes of ASCII text). Despite the `file` command correctly identifying this as `ASCII text, with no line terminators`, the AI still attempted to use `Read` to process the file as an image, triggering the Anthropic API error that crashed the session.

**Fix:** Update the system message to explicitly instruct: when downloading images from GitHub issues/PRs (especially private ones), use `curl` with `Authorization: token $(gh auth token)` header to ensure authenticated download.

---

## Problem Statement

When images are attached to private GitHub issues/PRs, their URLs are of the form:

```
https://github.com/user-attachments/assets/<uuid>
```

These URLs require GitHub authentication. Fetching them without authentication returns:

- HTTP 200 with body: `Not Found` (9 bytes ASCII)
- NOT an HTTP 401/404 status code

This is a **silent failure** — the download appears to succeed (HTTP 200, curl shows 100% transferred), but the content is not an image. The `file` command correctly identifies it as `ASCII text`, but the AI's instruction at the time was insufficiently clear about what to do after detecting non-image content.

---

## Timeline / Sequence of Events

| Time                 | Event                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-03-01T23:22:08Z | AI solver started for issue medmancifra/taxi_cab#5 ("No tabs")                                                                        |
| 2026-03-01T23:22:18Z | Repository cloned to `/tmp/gh-issue-solver-1772407336374`                                                                             |
| 2026-03-01T23:22:19Z | Branch `issue-5-322980a71d48` created                                                                                                 |
| ~23:23:50Z           | AI attempts to download the screenshot from issue #5                                                                                  |
| ~23:23:50Z           | `curl -L -o issue_screenshot.png "https://github.com/user-attachments/assets/f3a85d78-f0cd-46a8-89d6-fc0db150e41e"` downloads 9 bytes |
| ~23:23:50Z           | `file issue_screenshot.png` reports: `ASCII text, with no line terminators`                                                           |
| ~23:23:51Z           | AI ignores the warning and calls `Read("/tmp/issue_screenshot.png")`                                                                  |
| ~23:23:52Z           | The `Read` tool encodes the file as base64 `Tm90IEZvdW5k` with `media_type: "image/png"`                                              |
| ~23:23:52Z           | Anthropic API returns `400 - Could not process image`                                                                                 |
| ~23:23:53Z           | Session crashes with exit code 1                                                                                                      |

---

## Root Cause Analysis

### Primary Root Cause: Unauthenticated Image Download

GitHub user-attachment URLs (`https://github.com/user-attachments/assets/...`) require authentication even for `curl`. Without proper authentication:

- The server silently returns "Not Found" text with HTTP 200
- This is a silent failure — no error status code

**Verified fix:** Using `curl -L -H "Authorization: token $(gh auth token)"` successfully downloads the 547KB JPEG image.

### Secondary Root Cause: Insufficient Instruction Enforcement

The system message at the time contained an instruction about verifying images with the `file` command. However, the instruction's consequence was ambiguous — it said to "retry or skip" but didn't make it **absolutely clear and mandatory** to skip reading the file if `file` shows non-image content.

The AI saw `file` report `ASCII text` but still proceeded to call `Read` on it. The instruction needed to be **stronger and more actionable**: explicitly say to **STOP and NOT call Read** if the file is not a valid image.

### Contributing Factor: URL Type Not Recognized as Private Asset

The current system message hints about using `gh` for GitHub Gists but doesn't specifically mention `github.com/user-attachments/assets/` URLs as requiring authenticated download.

---

## Proposed Solutions

### Solution 1 (Implemented): Update System Message

Add a specific instruction that:

1. Identifies `github.com/user-attachments/assets/` URLs as requiring authenticated download
2. Provides the exact `curl` command with `gh auth token`
3. Makes it **absolutely mandatory** to skip `Read` if the `file` command shows non-image content

### Solution 2 (Future): Validate Image Before Sending to API

In `claude.lib.mjs` or the Claude Code Read tool implementation, validate that the file is a valid image before encoding it as `image/png` base64. If the file is not a valid image, return an error to the AI instead of encoding non-image content.

### Solution 3 (Future): Handle `file` Output in System Message Check

The system message check should explicitly say:

> If `file` shows anything other than `PNG image`, `JPEG image`, `GIF image`, `WebP`, `SVG` etc., **do NOT call Read on the file**. Instead, use the appropriate authenticated download method.

---

## Supporting Data

- Downloaded log: [solution-draft-log.txt](./solution-draft-log.txt) (7363 lines)
- The error occurred at log lines 7271 and 7288
- The incorrect `Read` call was at log line ~7114
- The bad curl download was at log line ~6811
- The `file` command correctly identified the issue at log line ~6897

---

## Related Issues to Report

The AI (the `file` check worked) should have followed through on the skip instruction. The AI's behavior could be reported as a bug to Anthropic's Claude Code:

- Claude Code's `Read` tool should validate that a file being read as an image is actually a valid image binary before encoding it.
- However, the best fix is in the system message so the AI has clear instructions.
