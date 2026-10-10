# Include `file` in the Box runtime for attachment validation

Hive Mind 2.34.0 derives its task runtime from `ghcr.io/link-foundation/box:2.10.2` and `box-dind:2.10.2`. A captured Claude task failed a shell command with `/bin/bash: line 1: file: command not found`; exit status 127. The same utility was absent in the issue-solving task environment used for the investigation. The common essentials installer does not explicitly install `file`.

Evidence: https://github.com/link-assistant/hive-mind/issues/2687 and https://github.com/link-assistant/hive-mind/pull/2592#issuecomment-6047133066 (complete sanitized log linked there). This dependency problem is separate from Hive Mind's provider-error precedence bug, which masked a later usage limit.

Reproduction on the reported published task image:

```bash
docker run --rm --memory=256m --entrypoint /bin/bash \
  konard/hive-mind-dind:2.34.0 \
  -lc 'command -v file; file /etc/os-release'
```

Compare the Box base itself:

```bash
docker run --rm --memory=256m --entrypoint /bin/bash \
  ghcr.io/link-foundation/box:2.10.2 \
  -lc 'command -v file; file /etc/os-release'
```

Expected: the command classifies a file. Reported task result: `file: command not found`, exit 127. The historical task log proves the derived-image failure; the isolated base-image comparison is a suggested upstream validation, not a claim of a separate local base-image run.

Workaround verified during investigation, running as `box` without sudo:

```bash
HOMEBREW_NO_AUTO_UPDATE=1 brew install file
file --mime-type downloaded-attachment.png
```

Suggested fix: add `file` to the system-package list in `ubuntu/24.04/essentials-box/install.sh` so both Box variants inherit it, and verify `file --version` plus MIME identification of an image in image tests. This enables agents to distinguish an actual downloaded image from an HTML error page before opening it. Hive Mind is adding a fallback installation and a runtime verification check in PR 2690.
