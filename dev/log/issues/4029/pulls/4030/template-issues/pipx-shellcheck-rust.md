## Summary

The ShellCheck job runs `pipx run --spec shellcheck-py==0.11.0.1 shellcheck`. The `ubuntu-24.04` runner image already ships `/usr/bin/shellcheck`, so pipx prints this warning on every run:

```
⚠️  shellcheck is already on your PATH and installed at /usr/bin/shellcheck.
```

The job stays green, but the warning shows up in every log. A warning that is always present teaches readers to ignore warnings in that job, so a real one goes unnoticed.

Seen in: `.github/workflows/workflows.yml line 182` (run 42646951557 on `main`).

## Reproduction

On any `ubuntu-24.04` runner (or locally with `/usr/bin/shellcheck` installed):

```bash
pipx run --spec shellcheck-py==0.11.0.1 shellcheck --version
```

## Workaround / suggested fix

Install the same pinned version into a venv and call that binary. It pins the same version and prints no warning:

```yaml
      - name: ShellCheck
        run: |
          python3 -m venv "$RUNNER_TEMP/shellcheck-venv"
          "$RUNNER_TEMP/shellcheck-venv/bin/pip" install --quiet --disable-pip-version-check shellcheck-py==0.11.0.1
          git ls-files -z '*.sh' | xargs -0 "$RUNNER_TEMP/shellcheck-venv/bin/shellcheck"
```

The same change was made in link-assistant/hive-mind#4029 (`.github/workflows/workflows.yml`, test `tests/workflow-shellcheck-4025.test.mjs`).
