#!/usr/bin/env python3
"""Prepare and build the pinned Linux adapter; never download a runtime binary.

Compilation runs on provisioned CI runners. The prepared source inventory and
compiler/profile inputs accompany every output. Runtime installation is separate.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import resource
import shutil
import stat
import subprocess
import tempfile
import tarfile

ROOT = Path(__file__).resolve().parents[1]
RECIPE = ROOT / "src/native-codex/recipe.json"
ADAPTERS = ROOT / "experiments/issue-3785/native-codex"


def sha256(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def regular(path, limit):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise ValueError("Native build input must be an unaliased regular file.")
    if info.st_size <= 0 or info.st_size > limit:
        raise ValueError("Native build file size is outside the admitted bound.")
    return info


def load_recipe(path=RECIPE, inputs=ADAPTERS):
    regular(path, 1024 * 1024)
    recipe = json.loads(path.read_text())
    if recipe["schema"] != 1 or recipe["profile"] != "release":
        raise ValueError("Unsupported native build recipe.")
    for name, expected in recipe["inputs"].items():
        if Path(name).name != name:
            raise ValueError("Invalid native build input name.")
        source = inputs / name
        regular(source, 4 * 1024 * 1024)
        if sha256(source) != expected:
            raise ValueError("Native build input does not match its pinned recipe.")
    return recipe, sha256(path)


def git(root, *arguments):
    return subprocess.check_output(["git", "-C", str(root), *arguments])


def check_revision(root, recipe):
    if git(root, "rev-parse", "HEAD").decode().strip() != recipe["upstreamCommit"]:
        raise ValueError("Refusing an unpinned native source checkout.")


def source_inventory(root):
    names = set(git(root, "diff", "--name-only", "-z", "HEAD").split(b"\0"))
    names.update(git(root, "ls-files", "--others", "--exclude-standard", "-z").split(b"\0"))
    inventory = {}
    for raw in sorted(names - {b""}):
        name = raw.decode()
        target = root / name
        info = regular(target, 8 * 1024 * 1024)
        inventory[name] = {"sha256": sha256(target), "bytes": info.st_size,
                           "mode": stat.S_IMODE(info.st_mode)}
    return inventory


def source_digest(inventory):
    content = {name: {key: item[key] for key in ("sha256", "bytes")}
               for name, item in inventory.items()}
    return hashlib.sha256(json.dumps(content, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def build_environment(recipe, inherited=None):
    inherited = os.environ if inherited is None else inherited
    env = {name: value for name, value in inherited.items()
           if not name.startswith(("CARGO_", "RUSTFLAGS", "RUSTUP_TOOLCHAIN"))
           and name != "RUSTC_WRAPPER" and name != "RUSTC_WORKSPACE_WRAPPER"}
    # Keep only cache locations from Cargo's inherited configuration. Compiler,
    # target, flags, profile and parallelism always come from the pinned recipe.
    for name in ("CARGO_HOME", "RUSTUP_HOME"):
        if name in inherited:
            env[name] = inherited[name]
    env.pop("RUSTC", None)
    env.pop("CARGO_ENCODED_RUSTFLAGS", None)
    env.update(recipe["cargoEnvironment"])
    env["RUSTUP_TOOLCHAIN"] = recipe["rustToolchain"]
    return env


def write_json(path, value):
    with path.open("x", encoding="utf8") as output:
        json.dump(value, output, indent=2, sort_keys=True)
        output.write("\n")


def compiler(recipe, env):
    version = subprocess.check_output(["rustc", "+" + recipe["rustToolchain"],
                                       "--version", "--verbose"], env=env, text=True)
    if not version.startswith("rustc " + recipe["rustToolchain"] + " "):
        raise ValueError("Native build compiler differs from the pinned toolchain.")
    return version


def prepare(root, state):
    recipe, digest = load_recipe()
    check_revision(root, recipe)
    if git(root, "status", "--porcelain", "--untracked-files=all") or state.exists():
        raise ValueError("Native preparation requires a fresh checkout and a new state file.")
    env = build_environment(recipe)
    version = compiler(recipe, env)
    for name, expected in recipe["licenses"].items():
        source = root / name
        regular(source, 4 * 1024 * 1024)
        if sha256(source) != expected:
            raise ValueError("Pinned upstream license input differs.")
    for step in recipe["steps"]:
        subprocess.run(["python3", str(ADAPTERS / ("apply_" + step + ".py")),
                        str(root)], env=env, check=True)
    # apply_adapter also supplies a separate experimental executable. Release
    # builds include only codex-cli; omit that unused driver from prepared source.
    driver = root / "codex-rs/login/src/bin/hive-canonical-auth-probe.rs"
    if sha256(driver) != recipe["inputs"]["native_lifecycle_probe.rs"]:
        raise ValueError("Unexpected native driver bytes during source preparation.")
    driver.unlink()
    inventory = source_inventory(root)
    if source_digest(inventory) != recipe["sourceInventorySha256"]:
        raise ValueError("Native preparation differs from the pinned complete source inventory.")
    write_json(state, {"schema": 1, "upstreamCommit": recipe["upstreamCommit"],
                       "recipeSha256": digest, "compiler": version,
                       "cargoEnvironment": recipe["cargoEnvironment"],
                       "sourceFiles": inventory})
    print("Prepared the pinned native Codex release source and checked inventory.")


def verify_source(root, state, recipe, digest):
    regular(state, 4 * 1024 * 1024)
    prepared = json.loads(state.read_text())
    check_revision(root, recipe)
    if (prepared["recipeSha256"] != digest
            or prepared["upstreamCommit"] != recipe["upstreamCommit"]
            or prepared["cargoEnvironment"] != recipe["cargoEnvironment"]
            or source_digest(prepared["sourceFiles"]) != recipe["sourceInventorySha256"]
            or prepared["sourceFiles"] != source_inventory(root)):
        raise ValueError("Native prepared source or recipe changed before packaging.")
    return prepared


def inspect_binary(binary, recipe, platform, executable=True):
    info = regular(binary, recipe["maxBinaryBytes"])
    with binary.open("rb") as source:
        header = source.read(64)
    if (len(header) != 64 or header[:7] != b"\x7fELF\x02\x01\x01"
            or int.from_bytes(header[16:18], "little") not in (2, 3)
            or int.from_bytes(header[18:20], "little") != recipe["targets"][platform]["elfMachine"]
            or (executable and not info.st_mode & 0o111)):
        raise ValueError("Native binary does not match the admitted Linux platform.")
    return {"sha256": sha256(binary), "bytes": info.st_size}


def process_limits():
    resource.setrlimit(resource.RLIMIT_DATA, (536870912, 536870912))
    resource.setrlimit(resource.RLIMIT_STACK, (16777216, 16777216))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def verify_version(binary, recipe):
    with tempfile.TemporaryDirectory(prefix="hive-native-codex-version-") as temporary:
        home = Path(temporary)
        config = home / "config"
        config.mkdir(mode=0o700)
        env = {"PATH": "/usr/bin:/bin", "HOME": temporary, "CODEX_HOME": str(config),
               "XDG_CONFIG_HOME": str(home / "xdg-config"),
               "XDG_CACHE_HOME": str(home / "xdg-cache"),
               "XDG_DATA_HOME": str(home / "xdg-data"), "RUST_LOG": "off"}
        result = subprocess.run([str(binary), "--version"], cwd=home, env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                timeout=30, check=True, preexec_fn=process_limits)
        if result.stdout.strip() != ("codex-cli " + recipe["version"]).encode():
            raise ValueError("Native binary reported a different pinned CLI version.")


def build(root, state, platform, output):
    recipe, digest = load_recipe()
    prepared = verify_source(root, state, recipe, digest)
    if output.exists() or output.is_symlink():
        raise ValueError("Native output must be a fresh directory.")
    env = build_environment(recipe)
    if compiler(recipe, env) != prepared["compiler"]:
        raise ValueError("Compiler changed after native source preparation.")
    target = recipe["targets"][platform]["target"]
    workspace = root / "codex-rs"
    subprocess.run(["cargo", "+" + recipe["rustToolchain"], "build", "--locked", "--verbose",
                    "--release", "--manifest-path", str(workspace / "Cargo.toml"),
                    "--target-dir", str(workspace / "target"), "--target", target,
                    "-p", "codex-cli", "--bin", "codex"],
                   cwd=workspace, env=env, check=True)
    verify_source(root, state, recipe, digest)
    binary = workspace / "target" / target / "release/codex"
    identity = inspect_binary(binary, recipe, platform)
    verify_version(binary, recipe)
    output.mkdir(mode=0o755)
    shutil.copyfile(binary, output / "codex")
    (output / "codex").chmod(0o755)
    if inspect_binary(output / "codex", recipe, platform) != identity:
        raise ValueError("Packaged native binary differs from the compiled output.")
    for name, expected in recipe["licenses"].items():
        source = root / name
        if sha256(source) != expected:
            raise ValueError("Native license changed during compilation.")
        destination = output / "licenses" / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
    shutil.copyfile(RECIPE, output / "recipe.json")
    write_json(output / "source.json", prepared)
    write_json(output / "manifest.json", {
        "schema": 1, "platform": platform, "target": target, "version": recipe["version"],
        "upstreamCommit": recipe["upstreamCommit"], "recipeSha256": digest,
        "sourceSha256": sha256(output / "source.json"), "binary": identity,
        "compiler": prepared["compiler"], "cargoEnvironment": recipe["cargoEnvironment"],
        "licenses": recipe["licenses"],
    })
    print("Built and verified the pinned native Codex release artifact.")


def artifact_paths(recipe):
    return {"codex", "manifest.json", "source.json", "recipe.json"} | {
        "licenses/" + name for name in recipe["licenses"]}


def verify_artifact(root, recipe, digest, platform, executable=False):
    if root.is_symlink() or not root.is_dir() or root.resolve() != root:
        raise ValueError("Native artifact must use a canonical directory.")
    expected = artifact_paths(recipe)
    directories = {parent.as_posix() for name in expected for parent in Path(name).parents
                   if parent.as_posix() != "."}
    seen = set()
    for path in root.rglob("*"):
        name = path.relative_to(root).as_posix()
        mode = path.lstat().st_mode
        if stat.S_ISDIR(mode) and name in directories:
            continue
        if not stat.S_ISREG(mode) or name not in expected:
            raise ValueError("Unexpected native artifact entry.")
        regular(path, recipe["maxBinaryBytes"] if name == "codex" else 4 * 1024 * 1024)
        seen.add(name)
    if seen != expected:
        raise ValueError("Native artifact is incomplete.")
    if sha256(root / "recipe.json") != digest:
        raise ValueError("Native artifact recipe differs from the checked-out recipe.")
    manifest = json.loads((root / "manifest.json").read_text())
    prepared = json.loads((root / "source.json").read_text())
    target = recipe["targets"][platform]["target"]
    expected_manifest = {"schema": 1, "platform": platform, "target": target,
                         "version": recipe["version"], "upstreamCommit": recipe["upstreamCommit"],
                         "recipeSha256": digest, "sourceSha256": sha256(root / "source.json"),
                         "cargoEnvironment": recipe["cargoEnvironment"], "licenses": recipe["licenses"]}
    if any(manifest.get(key) != value for key, value in expected_manifest.items()):
        raise ValueError("Native artifact provenance differs from its pinned inputs.")
    if (prepared.get("schema") != 1 or prepared.get("recipeSha256") != digest
            or prepared.get("upstreamCommit") != recipe["upstreamCommit"]
            or prepared.get("cargoEnvironment") != recipe["cargoEnvironment"]
            or source_digest(prepared["sourceFiles"]) != recipe["sourceInventorySha256"]
            or prepared.get("compiler") != manifest.get("compiler")
            or not prepared["compiler"].startswith("rustc " + recipe["rustToolchain"] + " ")
            or ("host: " + target) not in prepared["compiler"].splitlines()):
        raise ValueError("Native artifact source or compiler differs from its pinned inputs.")
    if manifest.get("binary") != inspect_binary(root / "codex", recipe, platform, executable):
        raise ValueError("Native artifact executable identity changed.")
    for name, expected_hash in recipe["licenses"].items():
        if sha256(root / "licenses" / name) != expected_hash:
            raise ValueError("Native artifact license identity changed.")
    return manifest


def assemble(artifacts, output):
    """Assemble in an exclusively owned CI workspace; download never executes."""
    recipe, digest = load_recipe()
    for platform in recipe["targets"]:
        verify_artifact(artifacts / ("native-codex-runtime-" + platform), recipe, digest, platform)
    if output.exists() or output.is_symlink():
        raise ValueError("Native runtime assembly requires a fresh output directory.")
    staging = Path(tempfile.mkdtemp(prefix=".native-codex-runtime-", dir=output.parent))
    try:
        for platform in recipe["targets"]:
            source = artifacts / ("native-codex-runtime-" + platform)
            destination = staging / platform
            for name in sorted(artifact_paths(recipe)):
                target = destination / name
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open("xb") as writer, (source / name).open("rb") as reader:
                    shutil.copyfileobj(reader, writer, 64 * 1024)
                target.chmod(0o755 if name == "codex" else 0o644)
            verify_artifact(destination, recipe, digest, platform, executable=True)
        staging.chmod(0o755)
        staging.rename(output)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    print("Assembled both verified native Codex platforms for the npm artifact.")


def verify_package(archive):
    """Check the actual npm file allowlist and bytes without running either CLI."""
    recipe, digest = load_recipe()
    prefix = "package/src/native-codex/runtime/"
    allowed = {platform + "/" + name for platform in recipe["targets"]
               for name in artifact_paths(recipe)}
    seen = set()
    with tempfile.TemporaryDirectory(prefix="native-codex-package-") as temporary:
        root = Path(temporary)
        with tarfile.open(archive, "r:gz") as package:
            for member in package:
                if not member.name.startswith(prefix):
                    continue
                name = member.name[len(prefix):]
                if (name not in allowed or name in seen or not member.isfile()
                        or member.size <= 0 or member.size > (
                            recipe["maxBinaryBytes"] if name.endswith("/codex") else 4 * 1024 * 1024)):
                    raise ValueError("Unexpected native payload in the npm artifact.")
                seen.add(name)
                destination = root / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                with package.extractfile(member) as reader, destination.open("xb") as writer:
                    shutil.copyfileobj(reader, writer, 64 * 1024)
                destination.chmod(member.mode & 0o777)
        if seen != allowed:
            raise ValueError("The actual npm file allowlist omitted a native platform or required file.")
        for platform in recipe["targets"]:
            verify_artifact(root / platform, recipe, digest, platform, executable=True)
    print("Verified both complete native platforms in the actual npm artifact.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest="command", required=True)
    assembly = subcommands.add_parser("assemble")
    assembly.add_argument("artifacts", type=Path)
    assembly.add_argument("output", type=Path)
    package = subcommands.add_parser("verify-package")
    package.add_argument("archive", type=Path)
    for command in ("prepare", "verify-source", "build"):
        sub = subcommands.add_parser(command)
        sub.add_argument("source", type=Path)
        sub.add_argument("state", type=Path)
        if command == "build":
            sub.add_argument("platform", choices=("linux-x64", "linux-arm64"))
            sub.add_argument("output", type=Path)
    arguments = parser.parse_args()
    if arguments.command == "assemble":
        assemble(arguments.artifacts.resolve(strict=True), arguments.output.absolute())
        return
    if arguments.command == "verify-package":
        verify_package(arguments.archive.resolve(strict=True))
        return
    root = arguments.source.resolve(strict=True)
    state = arguments.state.absolute()
    if state.is_relative_to(root):
        raise ValueError("Keep build state outside the pinned source checkout.")
    if arguments.command == "prepare":
        prepare(root, state)
    elif arguments.command == "verify-source":
        recipe, digest = load_recipe()
        verify_source(root, state, recipe, digest)
        print("Verified the complete prepared native source inventory.")
    else:
        build(root, state, arguments.platform, arguments.output.absolute())


if __name__ == "__main__":
    main()
