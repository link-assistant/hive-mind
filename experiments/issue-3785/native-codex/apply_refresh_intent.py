#!/usr/bin/env python3
"""Apply durable refresh intent after the actual native crash regression fails."""
import hashlib
from pathlib import Path
import subprocess
import sys

root = Path(sys.argv[1]).resolve(strict=True)
package = Path(__file__).resolve().parent
pin = "6aaac694803004a63c6f393d153c96d22521a6b9"
if subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip() != pin:
    raise SystemExit("Refusing unpinned native source.")
manager = root / 'codex-rs/login/src/auth/manager.rs'
source = manager.read_text()
if hashlib.sha256(source.encode()).hexdigest() != "128b16e8a93bf428658828f027db2d43c53d2f3cae26726be19e3f982bfb9cfb":
    raise SystemExit("Refusing changed native manager; cached-read repair is required first.")
for name in ['canonical_auth.rs', 'canonical_transaction.rs']:
    if manager.with_name(name).read_bytes() != (package / name).read_bytes():
        raise SystemExit("Refusing modified native storage or transaction source.")
for name in ['canonical_refresh_intent.rs', 'canonical_refresh_transaction.rs']:
    if manager.with_name(name).exists():
        raise SystemExit("Refusing existing native refresh-intent module.")


def replace(text, before, after, count=1):
    if text.count(before) != count:
        raise SystemExit("Ambiguous pinned refresh-intent context; no files changed.")
    return text.replace(before, after)


source = replace(source, '    fn load_canonical_auth(&self) -> Option<CodexAuth> {',
                 '    fn load_canonical_auth(&self) -> Option<CodexAuth> {\n        canonical_transaction::Transaction::assert_refresh_readable().ok()?;')
source = replace(source, '        let exchange = request_chatgpt_token_refresh(',
                 '        canonical.begin_refresh_exchange(&tokens.refresh_token).map_err(RefreshTokenError::from)?;\n        let exchange = request_chatgpt_token_refresh(')
source = replace(source, '''        .map_err(RefreshTokenError::from)?;
        self.reload().await;

        Ok(())
    }
}''', '''        .map_err(RefreshTokenError::from)?;
        canonical.finish_refresh_exchange(&tokens.refresh_token).map_err(RefreshTokenError::from)?;
        self.reload().await;

        Ok(())
    }
}''')
transaction = manager.with_name('canonical_transaction.rs')
text = transaction.read_text()
text = replace(text, '                    Ok(guard) => return Ok(Self { guard: Some(guard) }),', '''                    Ok(guard) => {
                        let transaction = Self { guard: Some(guard) };
                        transaction.reconcile_refresh()?;
                        return Ok(transaction);
                    },''', count=2)
text += '\n#[path = "canonical_refresh_transaction.rs"]\nmod refresh_intent;\n'
auth = manager.with_name('canonical_auth.rs')
auth_text = auth.read_text() + '\n#[path = "canonical_refresh_intent.rs"]\nmod refresh_intent;\n'
# Parse before any mutation. This is syntax checking, not native type checking.
def formatted(value):
    return subprocess.run(['rustfmt', '--edition', '2024', '--config', 'skip_children=true'], input=value, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True).stdout


source, text, auth_text = map(formatted, [source, text, auth_text])
if '--check' in sys.argv[2:]:
    print('Pinned native refresh-intent patch applies; no files changed.')
else:
    for name in ['canonical_refresh_intent.rs', 'canonical_refresh_transaction.rs']:
        manager.with_name(name).write_bytes((package / name).read_bytes())
    auth.write_text(auth_text)
    transaction.write_text(text)
    manager.write_text(source)
    print('Applied native refresh-intent experiment; production is unchanged.')
