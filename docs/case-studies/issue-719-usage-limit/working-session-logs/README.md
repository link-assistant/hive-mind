# Working Session Logs

This directory contains diagnostic and working session logs from the development and validation of the usage-limit handling feature (issue #719).

## File Organization

### CI Logs (`ci-logs.*`)
- **ci-logs.gh-run-list.*.json**: GitHub Actions run listings and status checks
- **ci-logs.issue-719.*.{json,txt}**: Issue details and comments
- **ci-logs.pr-722.*.{json,txt}**: Pull request details, comments, and status checks

### Development Logs (`logs.*`)
- **logs.git-*.txt**: Git operations (status, commits, branch operations)
- **logs.search-*.txt**: Code search results for various keywords and patterns
- **logs.src-*.txt**: Source code segments and analysis
- **logs.lint.*.txt**: Linting results and validation
- **logs.exp-*.txt**: Experiment script outputs
- **logs.pr-*.txt**: Pull request operations and comments

## Purpose

These logs were generated during:
1. Initial research and investigation of the usage-limit handling requirement
2. Implementation of detection and parsing logic across Claude, Codex, and OpenCode tools
3. PR comment formatting and validation
4. CI/CD verification and troubleshooting
5. Final readiness checks

## Usage

These logs serve as:
- Audit trail of the development process
- Reference for debugging similar issues in the future
- Evidence for case study analysis
- Historical context for the implementation approach

## Related Documentation

See parent directory files for structured case study documentation:
- `00-OVERVIEW.md` - High-level summary
- `03-EVIDENCE.md` - Key evidence and analysis
- `20-TIMELINE.md` - Chronological timeline
- `10-LOGS.md` - Log excerpts and analysis
