#!/usr/bin/env python3
"""Exercise release input admission without compiling on a constrained host."""
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("native_build", ROOT / "scripts/build-native-codex.py")
BUILD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD)


class NativeBuildAdmission(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="native-codex-build-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.recipe = self.root / "recipe.json"
        shutil.copyfile(ROOT / "src/native-codex/recipe.json", self.recipe)
        self.inputs = self.root / "inputs"
        self.inputs.mkdir()
        for name in json.loads(self.recipe.read_text())["inputs"]:
            shutil.copyfile(ROOT / "experiments/issue-3785/native-codex" / name, self.inputs / name)

    def test_exact_native_release_inputs(self):
        recipe, digest = BUILD.load_recipe(self.recipe, self.inputs)
        self.assertEqual(recipe["version"], "0.164.0")
        self.assertEqual(len(digest), 64)

    def test_changed_input_stops_before_source_mutation(self):
        (self.inputs / "canonical_auth.rs").write_text("changed native implementation\n")
        with self.assertRaisesRegex(ValueError, "input"):
            BUILD.load_recipe(self.recipe, self.inputs)

    def test_alias_input_is_not_admitted(self):
        original = self.inputs / "canonical_auth.rs"
        saved = original.with_suffix(".saved")
        original.rename(saved)
        original.symlink_to(saved.name)
        with self.assertRaisesRegex(ValueError, "regular"):
            BUILD.load_recipe(self.recipe, self.inputs)

    def test_wrong_platform_and_oversize_binary_are_not_executed(self):
        recipe, _ = BUILD.load_recipe(self.recipe, self.inputs)
        binary = self.root / "codex"
        # A regular executable ELF header with the other supported machine type
        # must fail admission before there is any opportunity to execute it.
        header = bytearray(64)
        header[:7] = b"\x7fELF\x02\x01\x01"
        header[16:20] = b"\x03\x00\xb7\x00"
        binary.write_bytes(header)
        binary.chmod(0o755)
        with self.assertRaisesRegex(ValueError, "platform"):
            BUILD.inspect_binary(binary, recipe, "linux-x64")
        with binary.open("r+b") as output:
            output.seek(18)
            output.write(b"\x3e\x00")
            output.truncate(recipe["maxBinaryBytes"] + 1)
        with self.assertRaisesRegex(ValueError, "size"):
            BUILD.inspect_binary(binary, recipe, "linux-x64")

    def test_build_override_environment_is_removed(self):
        recipe, _ = BUILD.load_recipe(self.recipe, self.inputs)
        env = BUILD.build_environment(recipe, {
            "PATH": "/usr/bin", "HOME": str(self.root),
            "RUSTFLAGS": "unexpected compiler arguments",
            "CARGO_ENCODED_RUSTFLAGS": "unexpected encoded arguments",
            "CARGO_PROFILE_RELEASE_OPT_LEVEL": "0",
            "CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER": "other-linker",
            "CARGO_BUILD_RUSTFLAGS": "unexpected build arguments",
        })
        self.assertEqual(env["CARGO_PROFILE_RELEASE_OPT_LEVEL"], "2")
        self.assertNotIn("RUSTFLAGS", env)
        self.assertNotIn("CARGO_ENCODED_RUSTFLAGS", env)
        self.assertNotIn("CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER", env)
        self.assertNotIn("CARGO_BUILD_RUSTFLAGS", env)


if __name__ == "__main__":
    unittest.main()
