# GCS Engine Operating Rules

- The source of truth is pinned to GCS v5.44.0 and GCS Master Library v5.12.0.
- This foundation accepts only `.gcs` data version 5; versions 1–4 and 6 or later are unsupported.
- `calc` is derived data produced by GCS `Recalculate`, not editable source state.
- Unknown fields and `third_party` must never be dropped during parsing, serialization, or future mutations.
- Only containers may have children, and future mutations must reject cycles.
- GCS `Toggle State` changes `disabled` only for traits; it is not available for skills.
- Search is a case-insensitive substring match; multiple selected tags use AND semantics.
- Fixed-point textual compatibility is defined by pinned GCS `fxp.FromString`, including its non-obvious sign/dot/comma-only zero forms and Go-valid exponent separators; intentional safer divergences must be explicit and differential-tested.
- Fixtures may change only together with their upstream provenance and SHA-256 digest.
- `packages/gcs-engine` and translated upstream fragments use MPL-2.0; the rest of the monorepo remains separately licensable.
- The canonical gate is `docker compose run --rm toolchain pnpm check`.
