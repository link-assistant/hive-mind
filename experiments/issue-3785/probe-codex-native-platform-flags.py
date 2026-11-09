#!/usr/bin/env python3
"""Exercise the real storage modules' open flags on native Linux or bounded QEMU.

Cross execution needs the pinned Rust musl target and an explicit QEMU executable;
CI runs the same controls natively before compiling the much larger CLI.
"""
import argparse
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent / 'native-codex'
MODULES = ['canonical_auth', 'canonical_session_index', 'canonical_rollout_paths',
           'canonical_rollout_maintenance', 'canonical_message_history',
           'canonical_migration_journals', 'canonical_migration_stages',
           'canonical_sqlite_authority']
TESTS = r'''
#[cfg(test)]
mod platform_flags {
    use super::*;
    use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, symlink};
    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new(name: &str) -> Self {
            let root = std::env::temp_dir().join(format!("native-flags-{}-{name}", std::process::id()));
            std::fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
            Self(root)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
    }
    #[test]
    fn real_directory_is_admitted_and_non_directory_is_refused() {
        let fixture = Fixture::new("directory");
        let open = |path: &std::path::Path| std::fs::OpenOptions::new()
            .read(true).custom_flags(DIRECTORY | NOFOLLOW).open(path);
        open(&fixture.0).expect("a real directory must be admitted on this architecture");
        let file = fixture.0.join("ordinary-file");
        std::fs::write(&file, b"synthetic").unwrap();
        assert!(open(&file).is_err(), "directory opens must refuse regular files");
    }
    #[test]
    fn final_file_and_directory_symlinks_are_refused() {
        let fixture = Fixture::new("links");
        let file = fixture.0.join("ordinary-file");
        std::fs::write(&file, b"synthetic").unwrap();
        let alias = fixture.0.join("file-alias");
        symlink(&file, &alias).unwrap();
        assert!(std::fs::OpenOptions::new().read(true).custom_flags(NOFOLLOW).open(&alias).is_err(),
            "file opens must refuse final symlinks on this architecture");
        let directory_alias = fixture.0.join("directory-alias");
        symlink(&fixture.0, &directory_alias).unwrap();
        assert!(std::fs::OpenOptions::new().read(true).custom_flags(DIRECTORY | NOFOLLOW)
            .open(&directory_alias).is_err(), "directory opens must refuse final symlinks");
    }
}
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target')
    parser.add_argument('--runner', type=Path)
    args = parser.parse_args()
    assert not args.runner or args.target, 'Cross execution must declare the target.'
    with tempfile.TemporaryDirectory(prefix='codex-platform-flags-') as temporary:
        root = Path(temporary)
        for file in ROOT.glob('*.rs'):
            shutil.copyfile(file, root / file.name)
        failures = []
        for module in MODULES:
            source = root / (module + '.rs')
            tests = TESTS.replace('DIRECTORY', 'O_DIRECTORY').replace('NOFOLLOW', 'O_NOFOLLOW') if module == 'canonical_auth' else TESTS
            source.write_text(source.read_text() + tests)
            binary = root / (module + '-tests')
            command = ['rustc', '+1.99.1', '--edition', '2024', '--test', str(source), '-C', 'debuginfo=0', '-o', str(binary)]
            if args.target:
                command.extend(['--target', args.target])
                if args.target.endswith('-musl'):
                    command.extend(['-C', 'linker=rust-lld', '-C', 'target-feature=+crt-static'])
            subprocess.run(['prlimit', '--data=536870912', '--stack=16777216', '--core=0', '--', *command], check=True, timeout=60)
            execute = [str(args.runner), str(binary)] if args.runner else [str(binary)]
            print(f'Platform flag controls: {module}', flush=True)
            result = subprocess.run(['prlimit', '--data=268435456', '--stack=16777216', '--core=0', '--', *execute, 'platform_flags::', '--test-threads=1'], timeout=20)
            if result.returncode:
                failures.append(module)
        assert not failures, f'Native platform flag controls failed: {failures}'
        print('PASS: all 16 storage flag controls across eight exact native modules.', flush=True)


if __name__ == '__main__':
    main()
