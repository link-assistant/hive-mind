# Contributing to Hive Mind

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

1. When PRs with changesets are merged to main, the Release workflow automatically creates a "Version Packages" PR
2. The Version Packages PR updates package.json versions and CHANGELOG.md
3. When the Version Packages PR is merged, the package is automatically published to NPM

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
  specialization: ['code-review', 'issue-solving']
};
```

### Quality Gates

Before merging, ensure:
- [ ] All tests pass
- [ ] File size limits enforced
- [ ] Type checking passes
- [ ] Human review completed
- [ ] AI consensus achieved (if multi-agent)

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
  timeout: 300000 // 5 minutes
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