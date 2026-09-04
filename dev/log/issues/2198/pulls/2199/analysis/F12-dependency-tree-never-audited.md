# F12 — Nothing audited the dependency tree for known vulnerabilities

**Severity:** High · **Class:** False negative (missing gate)
**Status:** Fixed by porting the template's `npm-audit` job.

## Symptom

```
$ grep -rn "npm audit\|audit-level" .github/ package.json scripts/
$ echo $?
1
```

No hit anywhere in the repository. `security.yml` looked like coverage — it runs CodeQL
and `actions/dependency-review-action` — but neither audits the dependency tree that is
actually shipped:

- **CodeQL** analyses *our* source for insecure patterns. It knows nothing about
  advisories against our dependencies.
- **`dependency-review-action`** is `if: github.event_name == 'pull_request'` and only
  inspects the dependencies a PR **changes**. A high-severity advisory published against
  a package that has been pinned in `package-lock.json` for a year is invisible to it
  **forever**, because no PR ever changes that line.

So the only two ways the repository could learn about a vulnerable dependency were a
Dependabot alert (out of band, not a gate) or a human.

This is the shape that recurs throughout this issue: **a plausible-looking security job
that does not check the thing you assumed it checked** — the same mistake as F8, where an
installed scanner was mistaken for a running one.

## Found how

By the file-tree comparison the issue asks for. The template's `security.yml` has an
`npm-audit` job; diffing the two files surfaced it as the only structural difference
besides hive-mind's extra `codeql-config.yml`.

## Fix

The template's job, minus its workspace matrix — `package-lock.json` is the only lockfile
in this repository:

```yaml
- name: Audit current lock
  run: npm audit --package-lock-only --audit-level=high
```

`--package-lock-only` audits the lockfile **as committed**, without installing. The job
therefore reports on what a consumer would get, and cannot be turned green by a
resolution that only happens on this runner.

Because it sits in `security.yml`, it inherits that workflow's `schedule: cron` trigger —
which is what makes it able to notice an advisory published *after* the code stopped
changing, the case `dependency-review` structurally cannot cover.

Current state: `found 0 vulnerabilities`.

## Guard

`tests/dependency-audit-2198.test.mjs` fails if the job is dropped, if `--audit-level` is
weakened past `high`, if the job loses `timeout-minutes`/`concurrency`, or if someone adds
an `if: github.event_name == 'pull_request'` guard that would neuter the scheduled run.
Verified to fail on the pre-fix tree (4 failing assertions).
