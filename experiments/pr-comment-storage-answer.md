Good question — I researched all of these and **verified the viable ones with a live experiment** against this repo (creating throwaway refs via the Git Data API, fetching the resulting URLs, then deleting the refs). Script + raw log: `experiments/storage-probe.sh` / `experiments/storage-probe.log`; full write-up in `docs/case-studies/issue-1843/external/research-notes.md` (Finding 6).

### Short answer

Yes — images can be stored **without any branch** (and without any tag). The catch behind every option is the same: GitHub only renders an image in a comment if the bytes are reachable at an `https://` URL it will proxy through Camo, and a git object is only servable if it's kept alive by **some** ref. So the question is really _which kind of ref_ — a branch is just one of three.

### What does NOT work

- **GitHub Actions artifacts** — cannot be embedded inline. They're stored as **zip archives**, their download URLs are **authenticated, signed and expiring** (90‑day default retention), and they can only be **created from inside a workflow run** — there's no PAT‑usable upload endpoint and no stable image URL GitHub will render. ❌
- **PR "attachments"** (`github.com/user-attachments/assets/…`) — the uploader is **cookie/session‑gated and rejects PATs (HTTP 422)**, so it can't be driven headlessly. ❌ (same blocker already documented in the case study)
- **Gists** — token‑creatable, but owned by the **token's user account**, not the repo; poor binary support and inconsistent private‑content access. ❌
- **Release assets** — token‑uploadable, but **require a tag**, pollute the Releases UI, and don't reliably render inline for private repos. ⚠️

### What DOES work (token‑only, renders inline, public + private) — verified

| Approach                                                    | Embed URL                             | Result                      |
| ----------------------------------------------------------- | ------------------------------------- | --------------------------- |
| **Git tag** `refs/tags/…`                                   | `…/blob/<tag>/<path>?raw=true`        | **HTTP 200 `image/png`** ✅ |
| **Custom ref** `refs/hive-mind-media/…` (no branch, no tag) | `…/blob/<commit-sha>/<path>?raw=true` | **HTTP 200 `image/png`** ✅ |

Both reuse the **exact Git Data API flow used by the implementation** (blob → tree → parentless commit → create ref). The only differences from the earlier branch-based draft:

- the ref _kind_ (`refs/tags/*` or a custom `refs/hive-mind-media/*` namespace instead of `refs/heads/*`), and
- for the custom‑ref option, embedding by **commit SHA** instead of ref name (GitHub's friendly `/blob/<name>/` URLs resolve only `heads/*` and `tags/*`, but a **commit SHA resolves regardless of the namespace** that keeps it alive — which is why a custom ref renders).

### Recommendation

A **custom ref namespace (`refs/hive-mind-media/*`) embedded via the commit‑SHA `?raw=true` URL** is the cleanest "no branch" answer: it keeps the bytes alive, needs no new credentials or services, renders for public **and** private repos, and is **invisible in every GitHub UI list** (branch dropdown, PR base picker, tags/releases) — so it's never a stray merge target. A **git tag** is the simpler alternative (friendly URL, ~one‑line change) but shows up under Tags/Releases.

Decision applied in this PR: use the **custom ref** path by default. Interactive images now go under `refs/hive-mind-media/pr-<number>` via Git Data API commits and are embedded with commit-SHA `?raw=true` URLs, so no branch or tag is introduced.
