# Best Practices for AI-Driven Development

This document describes CI/CD best practices that significantly improve the quality and reliability of AI-driven development workflows. When properly configured, Hive Mind AI solvers are forced to iterate with CI/CD checks until all tests pass, ensuring code quality meets the highest standards.

## Why CI/CD Matters for AI Development

Hive Mind's AI issue solver is instructed to pay attention to CI/CD checks in each pull request. This creates a powerful feedback loop:

1. **AI creates a solution** - The solver generates code based on issue requirements
2. **CI/CD validates the solution** - Automated checks verify code quality
3. **AI iterates until passing** - The solver fixes issues until all checks pass
4. **Quality is guaranteed** - No code merges without passing all gates

This approach ensures consistent quality regardless of whether the team consists of humans, AIs, or both.

## Recommended CI/CD Templates

We provide ready-to-use templates for multiple languages with all best practices pre-configured:

| Language | Template Repository |
|----------|---------------------|
| JavaScript/TypeScript | [js-ai-driven-development-pipeline-template](https://github.com/link-foundation/js-ai-driven-development-pipeline-template) |
| Rust | [rust-ai-driven-development-pipeline-template](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template) |
| Python | [python-ai-driven-development-pipeline-template](https://github.com/link-foundation/python-ai-driven-development-pipeline-template) |
| Go | [go-ai-driven-development-pipeline-template](https://github.com/link-foundation/go-ai-driven-development-pipeline-template) |
| C# | [csharp-ai-driven-development-pipeline-template](https://github.com/link-foundation/csharp-ai-driven-development-pipeline-template) |
| Java | [java-ai-driven-development-pipeline-template](https://github.com/link-foundation/java-ai-driven-development-pipeline-template) |

## Universal Best Practices

### 1. File Size Limits

**Enforce a maximum of 1000-1500 lines per code file.**

This constraint benefits both AI and human developers:
- AI models can read and understand entire files within context windows
- Humans can navigate and comprehend files without cognitive overload
- Forces modular, well-organized code architecture

Example enforcement in CI:
```bash
find src/ -name "*.js" -exec wc -l {} + | awk '$1 > 1000 {exit 1}'
```

### 2. Automated Code Formatting

Consistent formatting eliminates style debates and reduces diff noise:

| Language | Tool |
|----------|------|
| JavaScript/TypeScript | ESLint + Prettier |
| Rust | rustfmt |
| Python | Ruff |
| Go | gofmt |
| C# | dotnet format |
| Java | Spotless (Google Java Format) |

All templates include pre-commit hooks that run formatters automatically before each commit.

### 3. Static Analysis & Linting

Catch bugs and enforce patterns before code reaches review:

| Language | Tools |
|----------|-------|
| JavaScript/TypeScript | ESLint with strict rules |
| Rust | Clippy (pedantic + nursery) |
| Python | Ruff + mypy |
| Go | go vet + staticcheck |
| C# | .NET analyzers (warnings as errors) |
| Java | SpotBugs (maximum effort) |

### 4. Comprehensive Testing

Every template enforces testing across multiple dimensions:

- **Cross-platform**: Tests run on Ubuntu, macOS, and Windows
- **Multiple versions**: Latest LTS versions of language runtimes
- **Coverage reporting**: Automatic uploads to Codecov
- **Race detection**: For languages that support it (Go, Rust)

The goal is 100% test coverage for critical paths.

### 5. Changeset-Based Versioning

All templates use a changeset system that:

- **Eliminates merge conflicts** - Each PR creates an independent changeset file
- **Automates version bumps** - Highest bump type wins when merging
- **Generates changelogs** - Release notes are compiled automatically
- **Supports semantic versioning** - patch/minor/major bumps are explicit

| Language | Tool |
|----------|------|
| JavaScript/TypeScript | @changesets/cli |
| Rust | changelog.d + custom scripts |
| Python | Scriv |
| Go, C#, Java | Custom changeset workflows |

### 6. Pre-commit Hooks

Local quality gates prevent broken commits from reaching CI:

1. Format check and auto-fix
2. Lint and static analysis
3. Type checking (where applicable)
4. File size validation
5. Secrets detection

This "shift left" approach catches issues immediately rather than waiting for CI.

### 7. Release Automation

Automated release workflows ensure:

- **No manual version management** - Versions update automatically
- **OIDC trusted publishing** - No API tokens needed in CI
- **Validated releases only** - All checks must pass before publishing
- **Dual trigger modes** - Both automatic (on merge) and manual (workflow dispatch)

## Code Architecture Principles

For deeper guidance on writing maintainable code, see the [Code Architecture Principles](https://github.com/link-foundation/code-architecture-principles) repository, which covers:

### Universal Principles

- **Modularity**: Split systems into small, testable parts
- **Separation of concerns**: High cohesion, low coupling
- **Abstraction**: Hide implementation details behind stable interfaces
- **Immutability**: Prefer creating new values over mutation
- **Fail fast**: Validate input at system boundaries

### Key Recommendations

1. Design APIs that are obvious to use correctly and difficult to misuse
2. Expose functionality to enable extensibility rather than hiding internals
3. Make invalid states impossible through thoughtful data modeling
4. Relocate side effects to system edges; keep core logic pure
5. Use type systems to model valid data shapes

## Quality Enforcement Strategy

The templates implement a defense-in-depth approach:

```
Developer Machine    →    CI/CD Pipeline    →    Release
├── Pre-commit hooks      ├── Format check        ├── All checks pass
├── Local tests           ├── Lint/analyze        ├── Version bump
└── IDE integration       ├── Full test suite     ├── Changelog update
                          ├── Build validation    └── Publish package
                          └── Changeset verify
```

Each layer catches different issues, ensuring no problematic code reaches production.

## Getting Started

1. **Choose a template** from the table above matching your language
2. **Use it as a GitHub template** to create your new repository
3. **Configure secrets** if needed for publishing (OIDC preferred)
4. **Start developing** with all best practices pre-configured

The AI solvers will automatically respect and iterate with all configured checks, producing higher quality output than repositories without CI/CD enforcement.

## References

- [Code Architecture Principles](https://github.com/link-foundation/code-architecture-principles)
- [Contributing Guidelines](./CONTRIBUTING.md)
