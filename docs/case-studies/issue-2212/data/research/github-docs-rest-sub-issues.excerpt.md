# Excerpt: docs.github.com/en/rest/issues/sub-issues?apiVersion=2022-11-28

Captured 2026-09-05 with curl. Only the sentences quoted by the case study are kept;
the full page is 600 KB of rendered HTML and is not committed.

## Endpoints

- `/repos/{owner}/{repo}/issues/{issue_number}/sub_issue`
- `/repos/{owner}/{repo}/issues/{issue_number}/sub_issues`
- `/repos/{owner}/{repo}/issues/{issue_number}/sub_issues/priority`

## Rate-limit notes

- Removing content too quickly using this endpoint may result in secondary rate limiting.
- Creating content too quickly using this endpoint may result in secondary rate limiting.
