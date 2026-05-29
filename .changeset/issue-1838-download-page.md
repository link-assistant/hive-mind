---
'@link-assistant/hive-mind': minor
---

feat(site): add a /download landing page deployed to GitHub Pages (#1838)

Adds a polished, self-contained download/install page (under `site/`) modelled on
the vk-bot-desktop site, covering all three platforms hive-mind runs on — macOS,
Windows, and Linux — with copy-to-clipboard install commands for npm, npx, and
Docker. The page mirrors the feature set of the reference site:

- Full theme support: a System / Light / Dark switch backed by `localStorage`
  that also tracks the OS `prefers-color-scheme` live.
- Localized into the same four languages the repo maintains READMEs for
  (English, Russian, Chinese, Hindi), with auto-detection.
- OS auto-detection that pre-selects the visitor's platform tab.
- Live "latest release" badge fetched from the GitHub Releases API under a
  strict CSP, with a graceful fallback when offline.

The site is built with esbuild (React 19, no remote CDN) into `site/dist` and
deployed by a new `.github/workflows/pages.yml` workflow, which also runs a
Playwright headless-browser e2e smoke test and regenerates the locale/theme
preview screenshots in CI so the docs always reflect the current UI.
