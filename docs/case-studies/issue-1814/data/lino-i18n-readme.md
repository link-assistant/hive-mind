# lino-i18n

[![JavaScript CI/CD](https://github.com/link-foundation/lino-i18n/actions/workflows/js.yml/badge.svg?branch=main)](https://github.com/link-foundation/lino-i18n/actions/workflows/js.yml)
[![Rust CI/CD](https://github.com/link-foundation/lino-i18n/actions/workflows/rust.yml/badge.svg?branch=main)](https://github.com/link-foundation/lino-i18n/actions/workflows/rust.yml)
[![npm](https://img.shields.io/npm/v/lino-i18n?label=npm)](https://www.npmjs.com/package/lino-i18n)
[![Crates.io](https://img.shields.io/crates/v/lino-i18n?label=crates.io)](https://crates.io/crates/lino-i18n)
[![Docs.rs](https://docs.rs/lino-i18n/badge.svg)](https://docs.rs/lino-i18n)
[![GitHub Release](https://img.shields.io/github/v/release/link-foundation/lino-i18n?include_prereleases&label=release)](https://github.com/link-foundation/lino-i18n/releases)

A universal internationalization (i18n) library that stores translations in
[Links Notation](https://github.com/linksplatform/Protocols.Lino) (`.lino`) instead
of JSON or YAML.

The repository ships two implementations and a CLI:

| Path                              | What it is                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| [`js/`](./js)                     | The `lino-i18n` JavaScript package (Node.js, Bun, Deno, browsers).                             |
| [`js/bin/lino-i18n.js`](./js/bin) | A converter CLI that turns `i18next`, `i18n-js`, and `react-intl` catalogues into `.lino`.     |
| [`rust/`](./rust)                 | The `lino-i18n` Rust crate plus the `lino-i18n-macros` companion (`i18n!` compile-time macro). |

Both implementations consume the **same** `.lino` files. They share nested
catalogue authoring, plural categories, placeholder syntax, context suffixes,
multiline strings, bundled locale files, and fallback semantics, so a catalogue
you author once works in either runtime.

Released under the [Unlicense](LICENSE) — public domain.

## Why Links Notation?

Translation files are not data — they are content. JSON is brittle for that
job: every value has to be wrapped in quotes, every nested key needs braces,
and a missing comma breaks the whole file. `.lino` is a quoted-string + nested
identifier format that makes large catalogues comfortable to read in plain
text and trivial to diff.

```lino
en
  greeting "Hello, {{name}}!"
  telegram
    help
      title "Help"
      solve
        alias
          detail "Tool aliases imply `--tool <tool>`"
  prompt
    system
      general
        guidelines
          header "General guidelines."
          body """
            When you start, create a detailed plan for yourself.
            Follow your todo list step by step.
          """
  error
    label "Error"
    invalid
      github
        url "Error: Invalid GitHub URL format"
  cart
    title "Your cart"
    items
      zero "Your cart is empty"
      one "{{count}} item"
      other "{{count}} items"
  role
    male "He is a developer"
    female "She is a developer"
    other "They are a developer"
```

The loader flattens that catalogue to runtime keys like
`telegram.help.solve.alias.detail`,
`prompt.system.general.guidelines.body`, `error.label`,
`error.invalid.github.url`, `cart.items_one`, and `role_female`, so deeply
nested authoring still resolves stable flat runtime keys.

A nested group's `label` child is also exposed as the parent key, so
`error.label` and `error` both resolve to `"Error"` while an explicit `error`
entry still takes precedence. The Hive Mind migration that motivated this
pattern is summarized in
[docs/case-studies/issue-12](./docs/case-studies/issue-12).

### Migration aliases

Projects that migrate older mixed dot/underscore keys to deeper `.lino`
nesting can opt into generated compatibility aliases:

```js
const catalogues = await loadLocalesFromDirectory('./locales', {
  compatibilityAliases: ['collapseTail', 'parentLabel'],
});
const i18n = createI18n({ locales: catalogues, defaultLocale: 'en' });
```

With `collapseTail`, a canonical key such as
`telegram.help.solve.alias.detail` also exposes
`telegram.help_solve_alias_detail`, `telegram.help.solve_alias_detail`, and
`telegram.help.solve.alias_detail`. With `parentLabel`, `error.label` also
exposes `error`. Explicit catalogue entries always win over generated aliases.

The full design rationale lives in [docs/case-studies/issue-1](./docs/case-studies/issue-1).

## Quick start

### JavaScript

```bash
cd js
npm install
npm test
```

```js
import { createI18n } from 'lino-i18n';
import { loadLocalesFromDirectory } from 'lino-i18n/loaders';

const catalogues = await loadLocalesFromDirectory('./locales');
const i18n = createI18n({
  locales: catalogues,
  defaultLocale: 'en',
  fallback: ['en'],
});

i18n.t('greeting', { name: 'World' }); // → "Hello, World!"
i18n.t('cart.items', { count: 0 }); // → "Your cart is empty"
i18n.t('cart.items', { count: 3 }, { locale: 'ru' }); // → "3 товара"
```

### Rust

```bash
cd rust
cargo test
cargo run --example basic
```

```rust
use std::sync::OnceLock;
use lino_i18n::{i18n, I18n, TOptions};

fn catalog() -> &'static I18n {
    static C: OnceLock<I18n> = OnceLock::new();
    C.get_or_init(|| i18n!("locales", default = "en", fallback = "en"))
}

fn main() {
    let c = catalog();
    println!("{}", c.t("greeting", &[("name", "World")]));
    println!("{}", c.t_count("cart.items", 3,
        &[("count", "3")]));
    println!("{}", c.t_with(
        "cart.items",
        &[("count", "3")],
        &TOptions::new().locale("ru").count(3),
    ));
}
```

The `i18n!` macro reads every `*.lino` under the given directory at compile
time, embeds the catalogue text, and builds the `(key → value)` tables when
the `I18n` value is initialized. Each file is tracked through `include_str!`,
so Cargo rebuilds when any catalogue changes.

### CLI conversion

The JavaScript package ships a converter CLI usable through `npx`:

```bash
# Convert i18next JSON to .lino
npx lino-i18n convert --from i18next \
  --in locales/en.json --out locales --locale en

# Convert i18n-js JSON to .lino
npx lino-i18n convert --from i18n-js \
  --in config/locales/en.json --out locales

# Decompile a react-intl message bundle (AST or string) to .lino
npx lino-i18n convert --from react-intl \
  --in messages/en.json --out locales --locale en

# Bundle several locales into one .lino file
npx lino-i18n convert --from i18next \
  --in locales-json --out locales --single-file all.lino
```

Run `npx lino-i18n --help` for the full option list.

## Feature comparison

| Feature                          | i18next | i18n-js | react-intl |      **lino-i18n**      |
| -------------------------------- | :-----: | :-----: | :--------: | :---------------------: |
| Text-friendly catalogue format   |    ✗    |    ~    |     ✗      |     **✓** (`.lino`)     |
| Nested authoring format          |    ✓    |    ✓    |     ~      |          **✓**          |
| Plural categories (CLDR)         |    ✓    |    ✓    |     ✓      |          **✓**          |
| Placeholder interpolation        |    ✓    |    ✓    |     ✓      | **✓** (`{{x}}` & `{x}`) |
| Context / gender suffixes        |    ✓    |    ~    |     ✗      |          **✓**          |
| Namespaces                       |    ✓    |    ✓    |     ✗      |          **✓**          |
| Fallback locales                 |    ✓    |    ✓    |     ~      |          **✓**          |
| Missing-key handler              |    ✓    |    ~    |     ~      |          **✓**          |
| First-class JS API               |    ✓    |    ✓    |     ✓      |          **✓**          |
| First-class Rust API             |    ✗    |    ✗    |     ✗      |          **✓**          |
| Compile-time embedding (Rust)    |    ✗    |    ✗    |     ✗      |  **✓** (`i18n!` macro)  |
| CLI converter from other formats |    ~    |    ~    |     ~      |          **✓**          |
| Public domain license            |    ✗    |    ✗    |     ✗      |    **✓** (Unlicense)    |

See [docs/case-studies/issue-1](./docs/case-studies/issue-1) for the long-form
comparison including code samples and benchmarks.

## Layout

```
.
├── js/
│   ├── bin/lino-i18n.js          # CLI entry point
│   ├── src/                       # JS runtime + converters
│   ├── tests/                     # node --test suites
│   ├── locales/                   # Sample .lino catalogues
│   └── package.json
├── rust/
│   ├── lino-i18n/                 # Runtime crate
│   │   ├── src/
│   │   ├── tests/
│   │   ├── examples/
│   │   └── locales/
│   ├── lino-i18n-macros/          # i18n! proc-macro crate
│   └── Cargo.toml                 # Workspace manifest
├── docs/case-studies/issue-1/     # Design rationale + benchmarks
└── .github/workflows/
    ├── js.yml                     # JS CI/CD, npm release, and docs deployment
    └── rust.yml                   # Rust fmt+clippy+test matrix
```

## CI

Two purpose-built workflows live in `.github/workflows/`:

- **`js.yml`** runs `node --test`, `bun test`, and `deno test` on Linux,
  macOS, and Windows whenever anything under `js/**` changes, plus a CLI
  smoke test that round-trips an `i18next` JSON catalogue to `.lino`. On
  `main`, it also dry-runs the npm package, publishes missing package versions,
  creates `js-v*` GitHub releases, and deploys generated JavaScript docs to
  GitHub Pages. The filename stays aligned with npm Trusted Publisher
  configuration because npm validates the workflow identity during OIDC
  publishing.
- **`rust.yml`** runs `cargo fmt --check`, `cargo clippy -D warnings`, and
  `cargo test --all-targets` on the same three operating systems whenever
  anything under `rust/**` changes. On `main`, it also verifies crate package
  contents, publishes missing crates, creates `rust-v*` GitHub releases, and
  deploys generated Rust docs to GitHub Pages.

## Contributing

1. Fork the repository.
2. Create a feature branch.
3. Add a changeset (`bun run changeset` or hand-write a file in `.changeset/`).
4. Make your changes — keep `js/` and `rust/` behaviour consistent.
5. Open a pull request.

Both implementations must pass their CI matrix before a PR can land.

## License

Released into the public domain under the [Unlicense](LICENSE). Use this
library, fork it, vendor it, or strip the attribution — there is no
restriction.
