# Claude credential-parent integration

The native pinned CLI already honors CLAUDE_SECURESTORAGE_CONFIG_DIR. Docker
launch must retain this authority rather than silently select a conventional
credential file. This step does not repair the upstream owner-death defect or
complete default migration/full conversation storage.

- [x] Reproduce healthy selected-parent omission, stale legacy selection and
      missing post-preparation identity checks through production builders.
- [x] Project only a safe dedicated credential parent, carrying its admitted
      identity through launch and rechecking after daemon-namespace resolution.
- [x] Revalidate admitted storage in limits/profile/cache readers and immediately
      before native connection/execution. Reject dropped or substituted selectors.
- [x] Run actual pinned native root/two-peer Docker status/logout controls,
      including atomic replacement and private-config disposal; reap all peers.
- [x] Require the installed-package control in both daemon/image checks.
- [x] Run focused regressions, repository checks and the complete default suite.
- [x] Review, document exact limits and commit the independent integration step.

Default selection, safe migration, all writers/refresh/history lifecycles and
other six-tool acceptance requirements remain in the main inventory.
