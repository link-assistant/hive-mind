"""Host entry point for reviewed private backups and verified restores."""

import argparse
import contextlib
import os
import re
import stat
import subprocess
import sys
import tarfile

from bundle import check_output_path, json_bytes, private_output, read_json, restore_bundle, write_bundle
from selection import PROVIDERS, build_plan


def binary_input(path):
    if path == "-":
        if sys.stdin.isatty():
            raise ValueError("Provide the input file or pipe it on stdin without a terminal")
        return contextlib.nullcontext(sys.stdin.buffer)
    return open(path, "rb")


def selected_backup(name, state_dir, args):
    parser = argparse.ArgumentParser(prog="hive-manager deploy backup", allow_abbrev=False)
    actions = parser.add_mutually_exclusive_group(required=True)
    actions.add_argument("--plan", action="store_true", help="Print a private source plan for review")
    actions.add_argument("--plan-file", metavar="FILE|-", help="Use the reviewed JSON plan")
    parser.add_argument("--state", action="store_true", help="Select managed non-provider state")
    parser.add_argument("--provider", action="append", choices=PROVIDERS, default=[], help="Select a provider's state, repeatable")
    parser.add_argument("--path", action="append", default=[], metavar="NAME=/PATH", help="Select an additional host file or directory")
    parser.add_argument("--mount", action="append", default=[], metavar="NAME=[CONTAINER:]/TARGET", help="Select a Docker bind or volume by its exact container destination")
    parser.add_argument("--legacy", action="append", default=[], metavar="NAME=CONTAINER:/PATH", help="Select a writable-layer path in a stopped container")
    parser.add_argument("--output", metavar="FILE|-", help="Write a private bundle to a new file or to stdout")
    options = parser.parse_args(args)
    selection = {"state": options.state, "providers": sorted(set(options.provider)),
                 "paths": sorted(options.path), "mounts": sorted(options.mount), "legacy": sorted(options.legacy)}
    if options.plan:
        if options.output is not None:
            parser.error("Redirect stdout to save the review plan")
        sys.stdout.buffer.write(json_bytes(build_plan(name, state_dir, selection)))
        return
    if any(selection.values()):
        parser.error("Source options belong to --plan")
    with binary_input(options.plan_file) as stream:
        reviewed = read_json(stream)
    if not isinstance(reviewed, dict):
        raise ValueError("Expected a private backup plan")
    current = build_plan(name, state_dir, reviewed.get("selection"))
    if current != reviewed:
        raise ValueError("Backup sources differ from the reviewed plan. Review a fresh plan.")
    if options.output in (None, "-"):
        if sys.stdout.isatty():
            parser.error("Choose --output FILE or redirect the bundle to a private destination")
        if stat.S_ISREG(os.fstat(sys.stdout.fileno()).st_mode):
            check_output_path(os.path.realpath("/proc/self/fd/1"), current)
        write_bundle(sys.stdout.buffer, current)
    else:
        with private_output(options.output, current) as output:
            write_bundle(output, current)
        print(os.path.abspath(options.output))


def owner_ids(value):
    if not re.fullmatch(r"(?:0|[1-9][0-9]{0,9}):(?:0|[1-9][0-9]{0,9})", value):
        raise argparse.ArgumentTypeError("expected numeric UID:GID")
    uid, gid = map(int, value.split(":"))
    if uid >= 2**32 - 1 or gid >= 2**32 - 1:
        raise argparse.ArgumentTypeError("UID and GID must be valid Linux IDs")
    return uid, gid


def selected_restore(state_dir, args):
    parser = argparse.ArgumentParser(prog="hive-manager deploy restore --bundle", allow_abbrev=False)
    parser.add_argument("--input", default="-", metavar="FILE|-", help="Read a private bundle file or stdin")
    parser.add_argument("--owner", type=owner_ids, metavar="UID:GID", help="Assign restored payloads to this owner")
    options = parser.parse_args(args)
    with binary_input(options.input) as stream:
        restore_bundle(stream, state_dir, options.owner)
    print(f"Restored private backup to {state_dir}")


if __name__ == "__main__":
    action, name, state_dir, *args = sys.argv[1:]
    os.umask(0o077)
    try:
        if action == "backup":
            selected_backup(name, state_dir, args)
        else:
            selected_restore(state_dir, args)
    except (EOFError, OSError, ValueError, OverflowError, subprocess.CalledProcessError, tarfile.TarError) as error:
        sys.exit(f"hive-manager: {error}")
