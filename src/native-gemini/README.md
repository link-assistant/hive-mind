# Pinned native Gemini package recipe

This directory ships with the Hive Mind npm package. The adjacent
`native-gemini-package.lib.mjs` installs the verified Gemini 0.65.0 adapter into a
separate executable generation. Both image variants activate it from the
installed npm artifact. The installed runtime verifier requires its complete
native byte inventory. Default canonical storage selection, launcher admission
and restored-state migration remain unfinished.

The recipe checks all 449 files in the locked upstream npm archive, applies
exact line edits to five bundles, and installs nineteen checked helpers. Every
input, recipe payload and output has a SHA-256 check. The upstream archive's
SHA-512 integrity is retained in the manifest. The upstream Apache license is
included as `LICENSE.upstream`; Hive Mind's adapter changes use the repository
license.

Installation creates a fresh sibling generation and publishes an exclusive
directory symlink after complete verification. It preserves the original native
package. Existing complete installations verify before reuse; changed sources,
incomplete generations, destination collisions, unexpected executable files and
changed native bytes refuse admission. A failed unpublished generation is
removed by its installer. Unclaimed generations after process death are retained;
no orphan cleanup is claimed.

Sibling placement preserves npm's flattened optional dependency resolution.
An existing nested `node_modules` directory is linked as executable dependency
storage, with its directory identity recorded and rechecked. This is separate
from authentication/history storage. Full dependency provenance and the complete
production storage lifecycle still need the gates in the acceptance inventory.

`install-native-gemini.mjs` activates the verified generation by atomically
replacing the package manager's existing Gemini bin symlink. Installation
requires exclusive ownership of the package directory, as during image builds.
It refuses ordinary executable files and preserves the selected stock command
when package verification fails. Reinstallation verifies the existing generation
without replacing its bin inode. Verification checks bytes without executing
provider code; a matching CLI version alone cannot admit a stock package.
`HIVE_MIND_NATIVE_GEMINI_DEBUG=1` adds a fixed installation phase and pinned
relative filename on refusal. It never logs source paths or native contents and
is disabled by default.

Reproduce the recipe after installing the repository's development dependencies:

```sh
python3 experiments/issue-3785/build_native_gemini_recipe.py \
  /path/to/gemini-cli-0.65.0.tgz /path/to/pristine-package \
  /path/to/tested-stage-28-package /path/to/fresh-recipe
```

The archive must match the committed lockfile integrity. The checked tested
package is reconstructed by the thirty-one native authentication/history stages.
The generator verifies every edit against the original complete source before
writing a recipe and formats the JSON reproducibly.

`experiments/issue-3785/check_packaged_gemini.sh` packs the actual npm allowlist,
loads the installer from that artifact, checks exact output/original bytes,
refusals and command activation, then runs actual native authentication,
ACP/terminal restore, child restore and interrupted-plan controls against the
activated generation. No native exports are replaced in these complete CLI
controls. `verifyNativeGemini` checks executable provenance only;
the launcher must separately establish canonical authentication and full history
before execution.

Selected native authentication and history accept optional launcher-admitted
device/inode identities through `HIVE_MIND_GEMINI_AUTH_IDENTITY` and
`HIVE_MIND_GEMINI_HISTORY_IDENTITY`. Native account/authentication reads,
history initialization and inference recheck them against their selected owned
private directories. The native process retains the initial selections and
markers, refusing later removal, changes or directory replacement. A marker
without its selector also refuses admission. Ordinary unselected behavior is
preserved. This native contract does not activate selected Docker projection or
default canonical migration. See
[inherited identity evidence](../../docs/case-studies/issue-3785/evidence/native-gemini-inherited-identity.txt).
