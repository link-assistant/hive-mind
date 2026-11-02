#!/usr/bin/env python3
"""Reproduce Cargo's executable hardlink using a tiny offline synthetic crate.

This checks the compiler-to-artifact copy, not Codex runtime functionality.
Compilation and execution have finite memory and stack limits.
"""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("native_build", ROOT / "scripts/build-native-codex.py")
BUILD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD)


def main():
    recipe, _ = BUILD.load_recipe()
    env = BUILD.build_environment(recipe)
    with tempfile.TemporaryDirectory(prefix="hive-cargo-hardlink-") as temporary:
        root = Path(temporary)
        (root / "src").mkdir()
        (root / "Cargo.toml").write_text(
            '[package]\nname = "cargo-hardlink-fixture"\nversion = "0.0.0"\nedition = "2024"\n'
        )
        (root / "src/main.rs").write_text('fn main() { println!("cargo-hardlink-fixture"); }\n')
        subprocess.run(
            ["cargo", "+" + recipe["rustToolchain"], "build", "--offline", "--release",
             "--manifest-path", str(root / "Cargo.toml"), "--target-dir", str(root / "target")],
            cwd=root, env=env, check=True, preexec_fn=BUILD.process_limits,
        )
        source = root / "target/release/cargo-hardlink-fixture"
        before = source.stat()
        aliases = [path for path in (source.parent / "deps").iterdir()
                   if path.stat().st_ino == before.st_ino]
        if before.st_nlink < 2 or len(aliases) != 1:
            raise AssertionError("Cargo executable hardlink was not reproduced.")
        copied = root / "admitted-copy"
        BUILD.copy_compiler_binary(source, copied, 4 * 1024 * 1024)
        if copied.stat().st_nlink != 1 or copied.stat().st_ino == before.st_ino:
            raise AssertionError("Compiler copy did not get an unaliased inode.")
        if source.stat().st_ino != before.st_ino or source.stat().st_nlink != before.st_nlink:
            raise AssertionError("Compiler-owned executable was changed.")
        if BUILD.sha256(source) != BUILD.sha256(copied):
            raise AssertionError("Copied bytes differ from the compiler output.")
        result = subprocess.run([str(copied)], env={"PATH": "/usr/bin:/bin", "HOME": temporary},
                                capture_output=True, check=True, preexec_fn=BUILD.process_limits)
        if result.stdout != b"cargo-hardlink-fixture\n" or result.stderr:
            raise AssertionError("Unexpected synthetic executable result.")
        print("PASS: actual Cargo hardlinked output copied to a stable unaliased executable;")
        print(f"source links={before.st_nlink}, artifact links=1, bytes={before.st_size}.")


if __name__ == "__main__":
    main()
