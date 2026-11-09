#!/usr/bin/env python3
"""Type-check exact patched modules using their pinned real dependencies.

This focused harness supplies module nesting only; it does not replace native
storage, transaction, JSON, hashing or async dependencies. Full CLI proof is separate.
The optional dependency directory supports the small locked dependency crate.
"""
from pathlib import Path
import argparse
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source_root', type=Path)
parser.add_argument('--dependencies-dir', type=Path)
args = parser.parse_args()
root = args.source_root.resolve(strict=True)
package = Path(__file__).resolve().parent
native = root / 'codex-rs/login/src/auth'
deps = (args.dependencies_dir or root / 'codex-rs/target/dev-small/deps').resolve(strict=True)
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
    # Native builds contain multiple sha2 versions. Inspect compiler depfiles
    # rather than accidentally selecting a different version by filename hash.
    for dependency, version in [('serde_json', '1.0.149'), ('sha2', '0.10.9'), ('tokio', '1.52.3')]:
        libraries = []
        for library in sorted(deps.glob(f'lib{dependency}-*.rlib')):
            depfile = library.with_name(library.name.removeprefix('lib')).with_suffix('.d')
            if depfile.exists() and f'/{dependency}-{version}/' in depfile.read_text():
                libraries.append(library)
        if not libraries:
            raise SystemExit(f'The pinned {dependency} {version} dependency build is required first.')
        command += ['--extern', f'{dependency}={libraries[0]}']
    subprocess.run(command, check=True)
    subprocess.run(['prlimit', '--data=134217728', '--stack=8388608', '--core=0', '--',
                    str(binary), '--test-threads=1'], check=True)
