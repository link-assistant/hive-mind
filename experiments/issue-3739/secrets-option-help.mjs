// Playwright MCP help text published on #2347/#2348 as `--secrets [REDACTED]`.
import { sanitizeForPublication } from '../../src/token-sanitization.lib.mjs';
const text = '  --secrets <path>                      path to a file containing secrets in the\n                                        dotenv format\n  --password <value>\n  token: ${{ secrets.GITHUB_TOKEN }}\n';
const output = await sanitizeForPublication(text);
console.log(JSON.stringify({ unchanged: output === text, output }));
