#!/usr/bin/env python3
"""Rebuild history stages from the pinned constructor package and compare bytes."""
import argparse
import hashlib
from pathlib import Path
import shutil
import subprocess
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('constructor_package', type=Path)
parser.add_argument('tested_package', type=Path)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--tracker', action='store_true', help='Also apply tracker storage and startup admission.')
parser.add_argument('--git', action='store_true', help='Also apply tracker and checked native Git checkpoint storage.')
parser.add_argument('--restorable', action='store_true', help='Also apply Git, native restore metadata and terminal edit admission.')
parser.add_argument('--acp', action='store_true', help='Also apply native ACP checkpoint, restore, turn-boundary and listing repairs.')
parser.add_argument('--terminal-reopen', action='store_true', help='Also preserve terminal checkpoint turn boundaries for a third-process resume.')
parser.add_argument('--terminal-resume', action='store_true', help='Also wait for native terminal resume before admitting its first prompt.')
parser.add_argument('--headless', action='store_true', help='Also register both native noninteractive checkpoint writers; requires --acp.')
parser.add_argument('--subagent', action='store_true', help='Also check native child conversation directories; requires --headless.')
args = parser.parse_args()
assert not args.subagent or args.headless, 'The child-history stage requires the preceding headless stage.'
assert not args.headless or args.acp, 'The headless stage requires the preceding ACP CLI stages.'
source = args.constructor_package.resolve(strict=True)
tested = args.tested_package.resolve(strict=True)
output = args.output.resolve()
assert not output.exists() and not output.is_symlink(), 'Refuse to replace an existing package.'
output.mkdir(mode=0o700)
shutil.copyfile(source / 'package.json', output / 'package.json')
shutil.copytree(source / 'bundle', output / 'bundle', symlinks=False)
here = Path(__file__).resolve().parent


def hashes():
    result = {}
    for file in output.rglob('*'):
        if file.is_file():
            with file.open('rb') as stream:
                result[str(file.relative_to(output))] = hashlib.file_digest(stream, 'sha256').hexdigest()
    return result


include_terminal_reopen = args.terminal_reopen or args.terminal_resume
include_restorable = args.restorable or args.acp or include_terminal_reopen
include_git = args.git or include_restorable
include_tracker = args.tracker or include_git
stages = ('history', 'artifacts', 'blobs', 'logger', 'shell_history') + (('tracker', 'tracker_admission', 'tracker_coordination') if include_tracker else ()) + (('git_history', 'git_configuration', 'git_objects', 'git_services') if include_git else ()) + (('restorable_history', 'restorable_admission') if include_restorable else ()) + (('acp_restorable', 'acp_restore_history', 'acp_durable_history', 'acp_checkpoint_listing') if args.acp else ()) + (('terminal_durable_history',) if include_terminal_reopen else ()) + (('terminal_resume_admission',) if args.terminal_resume else ()) + (('headless_restorable',) if args.headless else ()) + (('subagent_history',) if args.subagent else ())
for stage in stages:
    command = [sys.executable, str(here / ('apply_' + stage + '.py')), str(output)]
    before = hashes()
    subprocess.run([*command, '--check'], check=True)
    assert hashes() == before, 'Checking applicability must not modify the disposable package.'
    subprocess.run(command, check=True)

names = ('chunk-DKZARV6U.js', 'chunk-XHQ6TTKH.js', 'gemini-GLQ4MVLB.js', 'interactiveCli-AVD3AKNJ.js', 'hive-gemini-admission.mjs', 'hive-gemini-history.mjs', 'hive-gemini-publication.mjs', 'hive-gemini-shell-history.mjs') + (('hive-gemini-tracker-history.mjs', 'hive-gemini-tracker-transactions.mjs') if include_tracker else ()) + (('hive-gemini-git-history.mjs', 'hive-gemini-git-lock.mjs', 'hive-gemini-git-configuration.mjs', 'hive-gemini-git-objects.mjs') if include_git else ()) + (('chunk-YTHYCFAB.js', 'hive-gemini-restorable-history.mjs', 'hive-gemini-restorable-admission.mjs') if include_restorable else ())
for name in names:
    actual = (output / 'bundle' / name).read_bytes()
    assert actual == (tested / 'bundle' / name).read_bytes(), 'Fresh application differs from the tested package: ' + name
    print(hashlib.sha256(actual).hexdigest(), name)
print(f'PASS: checked fresh source application produces the same {len(names)} native manager/CLI/helper files without mutation during applicability checks.')
