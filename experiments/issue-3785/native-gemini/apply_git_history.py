#!/usr/bin/env python3
"""Apply the experimental data-only Git checkpoint authority to pinned source."""
import hashlib
import json
from pathlib import Path
import sys

here = Path(__file__).resolve().parent
package = Path(sys.argv[1]).resolve(strict=True)
if json.loads((package / 'package.json').read_text())['version'] != '0.65.0':
    raise SystemExit('Refusing an unpinned native Gemini package.')
bundle = package / 'bundle'
for name, expected in (
    ('hive-gemini-history.mjs', '586d39370a4344a1aaa46c81894f2c6239253a91cb84e3871288c2093c328e99'),
    ('hive-gemini-publication.mjs', '2e55f93d5075a6c9cc9d5b3c7e71f243accc8f72e955e038d0341cb8fed0bc00'),
    ('hive-gemini-shell-history.mjs', 'c1b5b1abca32643ae0674779fe21bcf5713795906b9f6aac0d57a0ce3774e2f0'),
    ('hive-gemini-tracker-history.mjs', '11e56b631ab984ad8bb7992586a9e6e8b0030fba5e47c1e9b0f2c4fb9497b2c1'),
    ('hive-gemini-tracker-transactions.mjs', 'c504c700a3c11e6d25777e8b495bfba043c729cd67a91fc476465379bb667fd9'),
):
    if hashlib.sha256((bundle / name).read_bytes()).hexdigest() != expected:
        raise SystemExit('Refusing changed prerequisite native Gemini Git helpers.')
target = bundle / 'chunk-DKZARV6U.js'
original = target.read_bytes()
if hashlib.sha256(original).hexdigest() != '9e5df4a69c98a27919561e63ebc5d9338256e399f27c4f5171ff2564cedb9b55':
    raise SystemExit('Refusing changed native Gemini Git history input.')
for name in ('hive-gemini-git-history.mjs', 'hive-gemini-git-lock.mjs'):
    if (bundle / name).exists() or (bundle / name).is_symlink():
        raise SystemExit('Refusing an existing native Gemini Git helper.')
source = original.decode()
start = source.index('var GitService = class _GitService {\n')
end = source.index('\n// packages/core/dist/src/services/sandboxedFileSystemService.js', start)
before = source[start:end]
after = before


def replace(old, new):
    global after
    if after.count(old) != 1:
        raise SystemExit('Ambiguous native Git context; no files changed.')
    after = after.replace(old, new)


for method, parameters in (('initialize', ''), ('getCurrentCommitHash', ''),
                           ('createFileSnapshot', 'message'), ('restoreProjectFromSnapshot', 'commitHash')):
    signature = f'  async {method}({parameters}) {{\n'
    replace(signature, signature + f'    return withNativeGeminiGitHistory(this, "{method}", async () => {{\n')
for old in ('    }\n  }\n  static async verifyGitAvailability()',
            '    return hash.trim();\n  }\n  async createFileSnapshot',
            '    });\n  }\n  async restoreProjectFromSnapshot',
            '    await repo.clean("f", ["-d"]);\n  }'):
    close = old.index('\n  }')
    replace(old, old[:close] + '\n    });' + old[close:])
replace('''    return {
      ...getSafeGitEnv(sanitizeEnvironment(process.env,''', '''    return nativeGeminiGitEnvironment(this, {
      ...getSafeGitEnv(sanitizeEnvironment(process.env,''')
replace('''      GIT_COMMITTER_EMAIL: SHADOW_REPO_AUTHOR_EMAIL
    };''', '''      GIT_COMMITTER_EMAIL: SHADOW_REPO_AUTHOR_EMAIL
    });''')
replace('''  get shadowGitRepository() {
    const repoDir''', '''  get shadowGitRepository() {
    assertNativeGeminiGitOperation(this);
    const repoDir''')
source = 'import { withNativeGeminiGitHistory, nativeGeminiGitEnvironment, assertNativeGeminiGitOperation } from "./hive-gemini-git-history.mjs";\n' + source[:start] + after + source[end:]
lock = here.parents[2] / 'src/shared-auth-refresh-lock.lib.mjs'
if hashlib.sha256(lock.read_bytes()).hexdigest() != '6271784aa3773fc3a54056bf1ce8fd7b1f2da3a813e01537c47bcbc6d674c568':
    raise SystemExit('Refusing a different experimental kernel lock primitive.')
if '--check' in sys.argv[2:]:
    print('Pinned native Gemini Git history stage applies; no files changed.')
else:
    if target.is_symlink():
        target.unlink()
    target.write_text(source)
    (bundle / 'hive-gemini-git-history.mjs').write_bytes((here / 'git_history.mjs').read_bytes())
    (bundle / 'hive-gemini-git-lock.mjs').write_bytes(lock.read_bytes())
    print('Applied disposable native Gemini Git history draft; production is unchanged.')
print('Native Git manager SHA-256:', hashlib.sha256(source.encode()).hexdigest())
print('Native Git helper SHA-256:', hashlib.sha256((here / 'git_history.mjs').read_bytes()).hexdigest())
