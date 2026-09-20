# F11 — The two workflow linters now contradict each other

**Severity:** Medium · **Class:** False positive (a correct change is reported as an error)
**Status:** Documented and scoped-ignored in `6501cdd3`. Blocked on upstream actionlint.

## Symptom

Introducing the local composite action of F10 made the two gates of F3 disagree, and no
form of `uses:` satisfies both.

| `uses:` form | zizmor 1.30.0 | actionlint 1.7.7 | actionlint 1.7.12 |
| --- | --- | --- | --- |
| `uses: ./.github/actions/setup-buildx-resilient` | **exit 12** — `self-repository` | exit 0 | exit 0 |
| `uses: $/.github/actions/setup-buildx-resilient` | exit 0 | **`invalid format because ref is missing`** | **same** |

Reduced to a twelve-line repository — one workflow, one local composite action, nothing
else — by [`experiments/issue-2198/actionlint-zizmor-self-repository-probe.sh`](../../../../../../../experiments/issue-2198/actionlint-zizmor-self-repository-probe.sh),
whose output is [`../local/actionlint-self-repository-probe.txt`](../local/actionlint-self-repository-probe.txt).
The deadlock is a property of the two tools, not of anything specific to this repository.

## What each tool is asking for

zizmor's `self-repository` audit recommends GitHub's `uses: $/...` syntax — shipped
2026-07-30 — over `uses: ./...`. The rationale is real: `./` resolves against the
**runtime filesystem**, so what runs depends on whether (and to what) the job checked
out, while `$/` refers to the workflow's own repository at the workflow's own ref,
independent of filesystem state.

actionlint does not parse `$/` yet. v1.7.12 (2026-03-30) is the newest release, and
support is still open upstream:
[rhysd/actionlint#711](https://github.com/rhysd/actionlint/issues/711),
[rhysd/actionlint#732](https://github.com/rhysd/actionlint/issues/732).

So the recommendation is currently **unsatisfiable** in any repository that gates on both
tools.

## The template has this latent, and worse

`zizmorcore/zizmor-action@v0.6.2` installs zizmor `latest` by default — its `version:`
input defaults to `latest` — and zizmor 1.30.0, which added this audit, was released
**2026-08-30**. The template's last green `Workflows` run
([33167328667](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/actions/runs/33167328667))
was 2026-08-28, two days earlier. Re-running its own configuration against the current
`latest` reproduces the failure:

```console
$ zizmor --min-confidence medium --config .github/zizmor.yml .github/   # in the template checkout
...
59 findings (33 ignored, 22 suppressed, 4 safe fixes): 0 informational, 4 low, 0 medium, 0 high
$ echo $?
12
```

Four findings — `publish-dockerhub/action.yml:38` and `release.yml:379,711,751`, captured
in [`../local/zizmor-template.txt`](../local/zizmor-template.txt). The template will go
red on the next push that touches `.github/workflows/**`, without anyone having changed a
line, and the fix zizmor suggests will break the actionlint job sitting next to it
(pinned at 1.7.7, `workflows.yml:46`).

Reported as
[js-ai-driven-development-pipeline-template#155](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/155),
with the reproducer, the matrix above, the ignore block, and two further suggestions the
finding exposed: pin `zizmor-action`'s `version:` instead of tracking `latest` — an audit
that appears mid-week is an outage, not a deferral — and bump the actionlint pin to
1.7.12, under which the template is already clean
([`../local/actionlint-template.txt`](../local/actionlint-template.txt) is empty).

## Decision

Keep `./`, which both the runner and actionlint accept, and **ignore the audit for one
file with the reason written down** — rather than restructure working code around a
recommendation no linter in the chain can yet verify:

```yaml
rules:
  self-repository:
    ignore:
      - release.yml
```

The comment above it in `.github/zizmor.yml` states the conflict, both upstream issue
numbers, and the condition for removal: *drop this block once actionlint understands
`$/`*.

The concern behind the audit is separately covered: the four jobs that reference the
action check out first, and `tests/setup-buildx-resilient.test.mjs` fails if any of them
stops doing so (F10). The runtime-filesystem hazard is asserted, not assumed.

## Why this is filed as a false positive

The finding is not wrong about the code; it is wrong about what can be done with it
today. Acting on it would turn a green pipeline red in a different tool, which is the
same class of harm the issue is about — a signal that does not track correctness.
