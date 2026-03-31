# Best Practices for AI-Driven Development

This document describes general best practices for working effectively with Hive Mind and AI-driven development workflows. It covers universal prompting strategies, issue writing guidelines, architecture principles, and links to CI/CD standards.

## Table of Contents

- [Why Best Practices Matter](#why-best-practices-matter)
- [Universal Prompts](#universal-prompts)
- [Writing Good Issues](#writing-good-issues)
- [Architecture Improvement](#architecture-improvement)
- [CI/CD Best Practices](#cicd-best-practices)
- [Using Subagents](#using-subagents)
- [References](#references)

## Why Best Practices Matter

Hive Mind's quality depends heavily on:

1. **Clear issue requirements** — Ambiguous issues produce ambiguous solutions
2. **Strong CI/CD pipelines** — AI solvers iterate until all checks pass, guaranteeing quality
3. **Good prompting** — Universal prompts help AI do deep analysis and avoid common mistakes
4. **Architecture discipline** — Consistent code structure is easier for AI to navigate and extend

Each of these layers compounds: good requirements + strong CI/CD + good prompts = consistently excellent automated solutions.

## Universal Prompts

The following prompts can be added as comments to any GitHub issue or pull request to guide the AI solver's behavior.

### Deep Analysis Bug Prompt

Use this when a bug needs thorough investigation before a fix is attempted:

```
Please perform a deep case study for this issue:
1. Download all relevant logs, error output, and reproduction data to ./docs/case-studies/issue-{id}/
2. Search online for similar issues, known root causes, and community solutions
3. Reconstruct the full timeline: when did this start, what changed, what is the sequence of events that causes the bug?
4. Identify the true root cause (not just the symptom)
5. Propose multiple solution approaches with trade-offs
6. Implement the best solution with tests
7. Verify CI/CD checks pass before finalizing
```

### Deep Analysis Feature Prompt

Use this when a feature request needs research and design before implementation:

```
Please perform a deep analysis for this feature request:
1. Collect all relevant context and examples to ./docs/case-studies/issue-{id}/
2. Search online for how similar features are implemented in comparable tools
3. Analyze trade-offs: performance, maintainability, backward compatibility
4. Propose a detailed implementation plan with alternative approaches
5. Implement the chosen approach with tests
6. Update documentation to reflect the new feature
7. Verify all CI/CD checks pass before finalizing
```

### Universal Validation Prompt

Add this as a comment before finalizing any solution to ensure nothing is missed:

```
Before marking this complete, please verify:
1. All requirements from the original issue are addressed
2. All discussion points from PR/issue comments are resolved
3. All CI/CD checks are passing (no lint errors, all tests green)
4. No previously working features have been broken
5. Code follows the repository's existing style and conventions
6. Documentation is updated if behavior changed
7. No debug code, temporary hacks, or TODOs remain
8. The changeset (if required) is present and accurate
```

### Plan Mode Prompt

Use this when you want the AI to propose a plan before writing any code:

```
Please enter plan mode for this issue:
1. Collect all relevant data to ./docs/case-studies/issue-{id}/
2. Read all related source files, tests, and documentation
3. Search online if external knowledge is needed
4. Propose a detailed step-by-step implementation plan
5. List all files that will be created or modified
6. Identify risks and edge cases
7. Wait for approval before writing any code
```

### Maximum Power Prompt

Use this for complex issues where full AI capability is needed:

```
Solve this issue using maximum thoroughness:
- Use --model opus --think max for deep reasoning
- Download and analyze all relevant logs
- Do online research for similar problems and solutions
- Write comprehensive tests covering edge cases
- Add detailed tracing/logging that remains in code but is off by default
- Ensure all CI/CD checks pass
- Leave no stone unturned
```

## Writing Good Issues

Good issue requirements are the foundation of quality AI solutions. Study closed issues and merged PRs in this repository for examples.

### Issue Writing Checklist

- [ ] **Clear problem statement** — What is broken or missing? What is the expected vs. actual behavior?
- [ ] **Reproduction steps** — How can the problem be reliably reproduced?
- [ ] **Context** — Which files, functions, or components are involved? Link to them.
- [ ] **Acceptance criteria** — What specific conditions define "done"? List them explicitly.
- [ ] **Examples** — Include code snippets, error messages, or screenshots as evidence.
- [ ] **Constraints** — Are there things the solution must NOT do (e.g., must not break X, must not add a dependency)?
- [ ] **Priority** — How urgent is this? What is the impact if left unfixed?

### Issue Requirement Patterns from This Repository

Based on successfully solved issues in this repository:

**For bugs:**

```
## Problem
[One sentence description of the wrong behavior]

## Steps to Reproduce
1. [Exact command or action]
2. [What happens]
3. [What should happen instead]

## Root Cause Hypothesis
[Optional: your best guess at why this happens]

## Acceptance Criteria
- [ ] [Specific measurable condition 1]
- [ ] [Specific measurable condition 2]
- [ ] All CI/CD checks pass
```

**For features:**

```
## Goal
[One sentence description of the new capability]

## Motivation
[Why is this needed? What problem does it solve?]

## Proposed Implementation
[Optional: your suggestion for how to implement it]

## Acceptance Criteria
- [ ] [Feature works in scenario A]
- [ ] [Feature works in scenario B]
- [ ] Tests cover the new behavior
- [ ] Documentation is updated
- [ ] All CI/CD checks pass
```

## Architecture Improvement

To improve the architecture of a codebase using AI, use this prompt referencing the Code Architecture Principles:

```
Please analyze this codebase against the architecture principles at:
https://raw.githubusercontent.com/link-foundation/code-architecture-principles/refs/heads/main/README.md

For each principle that is currently violated or could be better applied:
1. Identify the specific location (file:line) where the violation occurs
2. Explain why it is a violation and what the impact is
3. Propose a concrete refactoring with a before/after code example
4. Prioritize by impact: high/medium/low

Focus especially on:
- File size limits (1000-1500 lines max)
- Single Responsibility principle
- Separation of concerns
- Testability
- Explicit interfaces and minimal coupling
```

### Key Architecture Principles Summary

For deeper guidance on writing maintainable code, see the [Code Architecture Principles](https://github.com/link-foundation/code-architecture-principles), which covers:

**Universal Principles:**

- **Modularity**: Split systems into small, testable parts
- **Separation of concerns**: High cohesion, low coupling
- **Abstraction**: Hide implementation details behind stable interfaces
- **Immutability**: Prefer creating new values over mutation
- **Fail fast**: Validate input at system boundaries

**Key Recommendations:**

1. Design APIs that are obvious to use correctly and difficult to misuse
2. Expose functionality to enable extensibility rather than hiding internals
3. Make invalid states impossible through thoughtful data modeling
4. Relocate side effects to system edges; keep core logic pure
5. Use type systems to model valid data shapes
6. Write small, focused functions that do one thing well
7. Prefer composition over inheritance and complexity

## CI/CD Best Practices

CI/CD pipelines are the backbone of AI-driven development quality. When checks are enforced:

- AI solvers are **forced to iterate** until all tests pass
- Code quality is **guaranteed** regardless of human or AI authorship
- Issues are caught **early** before reaching production

See **[CI-CD-BEST-PRACTICES.md](./CI-CD-BEST-PRACTICES.md)** for the full guide, including:

- Running checks only on relevant file changes (save CI costs)
- File size limits and fast-fail job ordering
- Automated formatting, linting, and static analysis
- Changeset-based versioning without merge conflicts
- Fresh merge simulation to validate the actual merged result
- OIDC trusted publishing without long-lived secrets

Ready-to-use templates are available for JavaScript, Rust, Python, Go, C#, and Java.

## Using Subagents

Hive Mind can coordinate multiple AI agents working in parallel. Use subagents for:

### When to Use Subagents

- **Independent parallel research** — One agent searches logs while another reads source code
- **Protecting the main context** — Offload large file reads or long searches to subagents
- **Specialized tasks** — Use a dedicated agent for documentation, another for tests
- **Cross-validation** — Have multiple agents propose solutions independently, then compare

### Subagent Patterns

**Parallel research:**

```
Launch subagents concurrently for:
- Agent 1: Read all source files related to [feature area]
- Agent 2: Search for recent issues and PRs related to this problem
- Agent 3: Read all test files to understand expected behavior
Then synthesize findings before implementing.
```

**Staged work:**

```
Stage 1 (research subagent): Collect and analyze all relevant data
Stage 2 (plan subagent): Design the implementation approach
Stage 3 (implementation): Write and test the solution
Stage 4 (validation subagent): Run all checks and verify requirements
```

**Checklist iteration:**

```
Maintain a checklist of all requirements from the issue.
After each step, check off completed items.
Iterate until the checklist is fully complete and all CI/CD checks pass.
Never mark a task done until it is verified working.
```

## References

- [Code Architecture Principles](https://github.com/link-foundation/code-architecture-principles)
- [CI/CD Best Practices](./CI-CD-BEST-PRACTICES.md)
- [Contributing Guidelines](./CONTRIBUTING.md)
- [Configuration Options](./CONFIGURATION.md)
