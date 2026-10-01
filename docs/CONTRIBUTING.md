# Contributing to Hive Mind (languages: en • [zh](CONTRIBUTING.zh.md) • [hi](CONTRIBUTING.hi.md) • [ru](CONTRIBUTING.ru.md))

## Human-AI Collaboration Guidelines

This project leverages AI-driven development with human oversight. Follow these practices:

### Development Workflow

1. **Issue Creation** - Humans create issues with clear requirements
2. **AI Processing** - Hive Mind analyzes and proposes solutions
3. **Human Review** - Code review and architectural decisions
4. **Iterative Refinement** - Collaborative improvement cycles

### Code Standards

- **TypeScript/JavaScript**: Strict typing required
- **File Size**: Maximum 1000 lines per file
- **Testing**: 100% test coverage for critical paths
- **Documentation**: Machine-readable, token-efficient

### Version Management with Changesets

This project uses [Changesets](https://github.com/changesets/changesets) to manage versions and changelogs. This eliminates merge conflicts that occur when multiple PRs bump the version in package.json.

#### Adding a Changeset

When you make changes that affect users, add a changeset:

```bash
npm run changeset
```

This will prompt you to:

1. Select the type of change (patch/minor/major)
2. Provide a summary of the changes

The changeset will be saved as a markdown file in `.changeset/` and should be committed with your PR.

#### Changeset Guidelines

- **Patch**: Bug fixes, documentation updates, internal refactoring
- **Minor**: New features, non-breaking enhancements
- **Major**: Breaking changes that affect the public API

Example changeset summary:

```markdown
Add support for automatic fork creation with --auto-fork flag
```

#### Release Process

1. When a PR with changesets is merged to main, the Release workflow runs `changeset version` and commits the version bump, the updated CHANGELOG.md and the consumed `.changeset/*.md` files **directly to main** as `github-actions[bot]`
2. The same run publishes the package to NPM and creates the GitHub release
3. No "Version Packages" or `release/*` pull request is created: a PR per release added one more PR and one undeletable branch for every version, and a failed run left a stale release PR behind (issue #2402). If a repository rule ever rejects the push, the release fails with the rule's output; fix the rule, do not add a release PR

### The Code Is Not a Changelog

Release history lives in `.changeset/*.md`, the generated `CHANGELOG.md`, GitHub releases, commit messages and code comments. Everything a user reads at runtime describes **what the software does now**. That covers `--help` and usage screens, option descriptions, console output, Telegram bot replies and `src/locales/*.lino`, and the comments, issues and commits the tool posts.

We do not accept code that:

- explains what changed: "old behavior", "the default in newer versions", "now does X", "no longer does Y", "the legacy script has been promoted", "renamed from", "New in vX.Y", "What's new" banners or release notes
- tags a user-facing text with the issue or pull request that introduced it, such as "(issue #1234)", "(#594)" or `Reference: https://github.com/link-assistant/hive-mind/issues/1234`

Write what the option or message does today. Put the history in the changeset, the reason in a code comment, and the issue link in the comment or test that pins the behaviour. Deprecation notices are current guidance, so they stay: they name the replacement ("deprecated; use `--isolated screen`") and do not tell the story of the change. Diagnostic log lines may cite the issue that documents a known failure mode, because that is a troubleshooting pointer, not release history. `tests/no-changelog-in-ui-2402.test.mjs` enforces this for help text, option descriptions, locales and GitHub-posted reports.

### AI Agent Configuration

```typescript
interface AgentConfig {
  model: 'sonnet' | 'haiku' | 'opus';
  priority: 'low' | 'medium' | 'high' | 'critical';
  specialization?: string[];
}

export const defaultConfig: AgentConfig = {
  model: 'sonnet',
  priority: 'medium',
  specialization: ['code-review', 'issue-solving'],
};
```

### Quality Gates

Before merging, ensure:

- [ ] All tests pass
- [ ] File size limits enforced
- [ ] Type checking passes
- [ ] Human review completed
- [ ] AI consensus achieved (if multi-agent)

### Test Suite Entrypoints

Use `npm test` for the default local suite. New tests that should run in the
default suite must mark the test file itself:

```javascript
/**
 * @hive-mind-test-suite default
 */
```

Use a dedicated suite marker, such as `github-integration`, for tests that need
external services or mutate real repositories. Do not append individual
`node tests/...` commands to `package.json` or the main CI test-suite job.

### Communication Protocols

#### Human → AI

```bash
# Clear, specific instructions
./solve.mjs https://github.com/owner/repo/issues/123 --requirements "Security focus, maintain backward compatibility"
```

#### AI → Human

```bash
# Status reports with actionable items
echo "🤖 Analysis complete. Requires human decision on breaking changes."
```

## Testing AI Agents

```typescript
import { testAgent } from './tests/agent-testing.ts';

// Test agent behavior
await testAgent({
  scenario: 'complex-issue-solving',
  expectedOutcome: 'pull-request-created',
  timeout: 300000, // 5 minutes
});
```

## Code Review Process

1. **Automated Review** - AI agents perform initial analysis
2. **Cross-Agent Validation** - Multiple agents verify solutions
3. **Human Oversight** - Final architectural and security review
4. **Consensus Building** - Resolve conflicts through discussion

### Review Checklist

- [ ] Algorithm correctness verified
- [ ] Security vulnerabilities assessed
- [ ] Performance implications considered
- [ ] Documentation completeness
- [ ] Integration test coverage
