# Link Checker Report

| Status         | Count |
| -------------- | ----- |
| 🔍 Total       | 120   |
| ✅ Successful  | 108   |
| ⏳ Timeouts    | 0     |
| 🔀 Redirected  | 6     |
| 👻 Excluded    | 2     |
| ❓ Unknown     | 0     |
| 🚫 Errors      | 4     |
| ⛔ Unsupported | 0     |

## Errors per input

### Errors in csharp/docs/index.md

- [ERROR] <file:///home/runner/work/repo/repo/csharp/docs/api/Foundation.Data.Doublets.Cli.yml> (at 15:12) | File not found. Check if file exists and path is correct

### Errors in js/index.html

- [ERROR] <error:> (at 10:49) | Cannot resolve root-relative link '/favicon.svg': To resolve root-relative links in local files, provide a root dir

### Errors in README.md

- [404] <https://example.com/csharp/> (at 48:130) | Rejected status code: 404 Not Found
- [404] <https://example.com/rust/link_cli/> (at 49:62) | Rejected status code: 404 Not Found

## Redirects per input

### Redirects in README.md

- https://example.com/docs --[302]--> https://example.com/docs/latest/
- https://example.com/protocols --[301]--> https://example.com/links-notation
- https://example.com/articles/804617 --[301]--> https://example.com/articles/804617/ --[302]--> https://example.com/companies/articles/804617/

### Redirects in rust/README.md

- https://example.com/docs --[302]--> https://example.com/docs/latest/
