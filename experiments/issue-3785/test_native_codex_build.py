#!/usr/bin/env python3
"""Exercise release input admission without compiling on a constrained host."""
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

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


class NativeArtifactAssembly(unittest.TestCase):
    """Synthetic ELF identity fixtures exercise packaging, never native behavior."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="native-codex-artifact-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.recipe = json.loads((ROOT / "src/native-codex/recipe.json").read_text())
        license_bytes = b"Synthetic packaging fixture license, not upstream license text.\n"
        self.recipe["licenses"] = {"LICENSE": hashlib.sha256(license_bytes).hexdigest()}
        recipe_bytes = json.dumps(self.recipe).encode()
        self.digest = hashlib.sha256(recipe_bytes).hexdigest()
        self.artifacts = self.root / "artifacts"
        for platform, machine in self.recipe["targets"].items():
            directory = self.artifacts / ("native-codex-runtime-" + platform)
            directory.mkdir(parents=True)
            header = bytearray(64)
            header[:7] = b"\x7fELF\x02\x01\x01"
            header[16:18] = b"\x03\x00"
            header[18:20] = machine["elfMachine"].to_bytes(2, "little")
            (directory / "codex").write_bytes(header)
            # upload-artifact loses Unix executable modes. Assembly must admit
            # bytes before restoring only the known CLI's executable mode.
            (directory / "codex").chmod(0o644)
            (directory / "recipe.json").write_bytes(recipe_bytes)
            (directory / "licenses").mkdir()
            (directory / "licenses/LICENSE").write_bytes(license_bytes)
            compiler = "rustc " + self.recipe["rustToolchain"] + " (synthetic packaging fixture)\nhost: " + machine["target"] + "\n"
            prepared = {
                "schema": 1, "recipeSha256": self.digest, "upstreamCommit": self.recipe["upstreamCommit"],
                "compiler": compiler, "cargoEnvironment": self.recipe["cargoEnvironment"],
                "sourceFiles": json.loads((ROOT / "src/native-codex/source-files.json").read_text()),
            }
            BUILD.write_json(directory / "source.json", prepared)
            BUILD.write_json(directory / "manifest.json", {
                "schema": 1, "platform": platform, "target": machine["target"], "compiler": compiler,
                "version": self.recipe["version"], "upstreamCommit": self.recipe["upstreamCommit"],
                "recipeSha256": self.digest, "sourceSha256": BUILD.sha256(directory / "source.json"),
                "cargoEnvironment": self.recipe["cargoEnvironment"], "licenses": self.recipe["licenses"],
                "binary": {"sha256": BUILD.sha256(directory / "codex"), "bytes": len(header)},
            })
        self.mock = patch.object(BUILD, "load_recipe", return_value=(self.recipe, self.digest))
        self.mock.start()
        self.addCleanup(self.mock.stop)
        self.output = self.root / "runtime"
        self.x64 = self.artifacts / "native-codex-runtime-linux-x64"

    def test_download_modes_are_restored_after_complete_identity_admission(self):
        BUILD.assemble(self.artifacts, self.output)
        for platform in self.recipe["targets"]:
            BUILD.verify_artifact(self.output / platform, self.recipe, self.digest, platform, executable=True)
            self.assertEqual((self.output / platform / "codex").stat().st_mode & 0o777, 0o755)
        self.assertEqual((self.x64 / "codex").stat().st_mode & 0o777, 0o644)

    def test_changed_binary_is_refused_before_assembly(self):
        with (self.x64 / "codex").open("ab") as target:
            target.write(b"changed")
        with self.assertRaisesRegex(ValueError, "identity"):
            BUILD.assemble(self.artifacts, self.output)
        self.assertFalse(self.output.exists())

    def test_missing_license_or_added_payload_is_refused(self):
        extra = self.x64 / "extra-payload"
        extra.write_text("unadmitted\n")
        with self.assertRaisesRegex(ValueError, "Unexpected"):
            BUILD.assemble(self.artifacts, self.output)
        extra.unlink()
        (self.x64 / "licenses/LICENSE").unlink()
        with self.assertRaisesRegex(ValueError, "incomplete"):
            BUILD.assemble(self.artifacts, self.output)
        self.assertFalse(self.output.exists())

    def test_recipe_source_and_platform_cannot_be_relabeled(self):
        manifest_path = self.x64 / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        for key, value in (("recipeSha256", "0" * 64), ("sourceSha256", "0" * 64),
                           ("platform", "linux-arm64")):
            bad = {**manifest, key: value}
            manifest_path.write_text(json.dumps(bad))
            with self.assertRaisesRegex(ValueError, "provenance"):
                BUILD.assemble(self.artifacts, self.output)
        manifest_path.write_text(json.dumps(manifest))

    def test_existing_destination_is_preserved(self):
        self.output.mkdir()
        (self.output / "kept").write_text("existing generation\n")
        with self.assertRaisesRegex(ValueError, "fresh"):
            BUILD.assemble(self.artifacts, self.output)
        self.assertEqual((self.output / "kept").read_text(), "existing generation\n")

    def test_actual_npm_file_allowlist_retains_both_platforms(self):
        package = self.root / "package"
        package.mkdir()
        shutil.copyfile(ROOT / "package.json", package / "package.json")
        (package / ".gitignore").write_text("src/native-codex/runtime/\n")
        destination = package / "src/native-codex/runtime"
        destination.parent.mkdir(parents=True)
        BUILD.assemble(self.artifacts, destination)
        env = {**os.environ, "NODE_OPTIONS": "--max-old-space-size=128"}
        packed = subprocess.run(["npm", "pack", "--ignore-scripts", "--json", "--pack-destination", str(self.root)],
                                cwd=package, env=env, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        archive = self.root / json.loads(packed.stdout)[0]["filename"]
        BUILD.verify_package(archive)
        shutil.rmtree(destination / "linux-arm64")
        packed = subprocess.run(["npm", "pack", "--ignore-scripts", "--json", "--pack-destination", str(self.root)],
                                cwd=package, env=env, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        archive = self.root / json.loads(packed.stdout)[0]["filename"]
        with self.assertRaisesRegex(ValueError, "allowlist omitted"):
            BUILD.verify_package(archive)


if __name__ == "__main__":
    unittest.main()
