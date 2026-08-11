## Summary

The npm resolver installs version-specific packages as global aliases such as
`zx-v-latest@npm:zx@8.8.5` and `zx-v-8.8.5@npm:zx@8.8.5`. If the package exposes
a binary, the second alias fails with `EEXIST` because both aliases claim the
original package's binary name (`zx`). This prevents a caller from migrating a
bare `use('zx')` import to reproducible `use('zx@8.8.5')` on an existing
installation.

Found while fixing link-assistant/hive-mind#2150. This is distinct from #72,
which concerns Node 24 CommonJS namespace unwrapping.

## Minimal reproduction

```bash
prefix="$(mktemp -d)"
npm install -g --prefix "$prefix" zx-v-latest@npm:zx@8.8.5
npm install -g --prefix "$prefix" zx-v-8.8.5@npm:zx@8.8.5
```

Observed with npm 11.17.0:

```text
npm error code EEXIST
npm error path <prefix>/bin/zx
npm error EEXIST: file already exists
npm error File exists: <prefix>/bin/zx
```

The repository reproducer is
`experiments/issue-2150/reproduce-use-m-bin-alias-conflict.sh` in Hive Mind PR
#2151. It uses a temporary prefix and verifies the error and binary path.

## Expected

Multiple use-m aliases for the same package can coexist, including packages
with `bin` entries. Loading a version-pinned module should not require deleting
the former `-v-latest` alias or an unrelated global executable.

## Root cause

`use-m` runs:

```text
npm install -g <alias>@npm:<package>@<version>
```

npm gives a global alias the package's original `bin` names. Alias directory
names are unique, but their global executable paths are not.

## Workaround

Hive Mind PR #2151 first verifies that the conflicting executable symlink
targets another use-m alias for the same package, then retries npm with
`--force --no-bin-links`. The versioned module alias installs, both aliases
remain, and npm 11 leaves the original executable symlink unchanged. Clean CI
preinstallation also uses `--no-bin-links`.

Never use `--force` without verifying ownership: the path may belong to a
user-installed global package rather than use-m.

## Suggested fix

The npm resolver should treat package binaries as unnecessary because use-m
imports modules; it does not invoke their global CLIs. On `EEXIST`, it can:

1. parse the conflicting executable path;
2. resolve its symlink target;
3. verify the target is `<globalRoot>/<same-package>-v-*/...`;
4. retry the alias install without bin links (using `--force` only after that
   ownership check, because npm 11 still performs the collision check with
   `--no-bin-links` alone).

A regression test should install `zx-v-latest`, then resolve `zx@8.8.5` in the
same isolated prefix and assert that both module aliases remain loadable.
