#!/usr/bin/env python3
"""Type-check exact patched modules using real dependencies from the native build.

This focused harness supplies module nesting only; it does not replace native
storage, transaction, JSON, hashing or async dependencies. Full CLI proof is separate.
"""
from pathlib import Path
import subprocess
import sys
import tempfile

root = Path(sys.argv[1]).resolve(strict=True)
package = Path(__file__).resolve().parent
native = root / 'codex-rs/login/src/auth'
deps = root / 'codex-rs/target/dev-small/deps'
for name in ['canonical_refresh_intent.rs', 'canonical_refresh_transaction.rs']:
    if native.joinpath(name).read_bytes() != package.joinpath(name).read_bytes():
        raise SystemExit('Refusing changed native refresh-intent module.')
source = f'''
mod auth {{
    pub mod storage {{
        #[path = "{native / 'canonical_auth.rs'}"] pub mod canonical_auth;
    }}
    mod manager {{
        #[path = "{native / 'canonical_transaction.rs'}"] mod canonical_transaction;
        #[cfg(test)] #[path = "{package / 'canonical_refresh_transaction_tests.rs'}"] mod tests;
    }}
}}
'''
with tempfile.TemporaryDirectory(prefix='hive-refresh-transaction-build-') as temporary:
    directory = Path(temporary)
    harness = directory / 'harness.rs'
    harness.write_text(source)
    binary = directory / 'transaction-tests'
    command = ['rustc', '+1.99.1', '--edition', '2024', '--test', str(harness),
               '-L', f'dependency={deps}', '-o', str(binary)]
    for dependency in ['serde_json', 'sha2', 'tokio']:
        libraries = sorted(deps.glob(f'lib{dependency}-*.rlib'))
        if not libraries:
            raise SystemExit('The actual native dependency build is required first.')
        command += ['--extern', f'{dependency}={libraries[0]}']
    subprocess.run(command, check=True)
    subprocess.run(['prlimit', '--data=134217728', '--stack=8388608', '--core=0', '--',
                    str(binary), '--test-threads=1'], check=True)
