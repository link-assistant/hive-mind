# Case Study: `--keep-tool-context-in-repository` Option (Issue #981)

## Summary

- **Problem**: AI coding assistants like Claude Code, Codex, and OpenCode start each session with zero context, losing all accumulated knowledge about decisions, patterns, and project-specific learnings from previous sessions.
- **Impact**: Developers waste time re-explaining context, AI makes inconsistent decisions, and valuable session learnings are lost forever.
- **Proposed Solution**: Implement a `--keep-tool-context-in-repository` option to automatically synchronize AI session logs/contexts to a repository folder, enabling persistent knowledge accumulation across sessions.

## Timeline

| Date | Event |
|------|-------|
| 2025-11-03 | Issue #661 opened requesting auto-restart with session resume for cost optimization |
| 2025-11-03 | PR #662 created with comprehensive case study on session resume patterns |
| 2025-12-24 | Issue #981 opened requesting `--keep-tool-context-in-repository` option |
| 2025-12-26 | Issue #964 opened about discussions not loaded to AI context |
| 2025-12-27 | PR #1012 created (this case study) for architectural exploration |

## Background Research

### Inspiration: ProverCoderAI/context-doc

The issue references [ProverCoderAI/context-doc](https://github.com/ProverCoderAI/context-doc), a tool that:

1. **Synchronizes AI conversation histories** from Claude, Codex, and Qwen to a `.knowledge` folder in the project repository
2. **Matches sessions to projects** using repository URL and working directory normalization
3. **Preserves session logs** in JSONL format organized by tool:
   - `.knowledge/.codex/sessions/` - Codex sessions
   - `.knowledge/.qwen/` - Qwen sessions
   - `.knowledge/.claude/` - Claude sessions (planned)

**Key Technical Details** (from context-doc source):
- Uses Effect-TS for functional composition
- Matches projects via `buildProjectLocator()` - normalizes repo URLs and cwds
- Copies relevant JSONL files while preserving directory structure
- CLI command: `npx @prover-coder-ai/context-doc`

### Industry Context: AI Coding Tool Memory Challenges

According to research, this is a widespread problem:

1. **Claude Code officially supports memory** through hierarchical `CLAUDE.md` files, but this is limited to static instructions, not dynamic session learnings ([Anthropic Engineering](https://www.anthropic.com/engineering/claude-code-best-practices))

2. **Users report significant pain points**:
   - [Issue #2954](https://github.com/anthropics/claude-code/issues/2954): Context persistence across sessions - major workflow disruption
   - [Issue #14227](https://github.com/anthropics/claude-code/issues/14227): Feature request for persistent memory between sessions
   - [Issue #2545](https://github.com/anthropics/claude-code/issues/2545): Severe session memory loss

3. **Community workarounds** include:
   - Multi-agent collaborative systems (62+ agents) to compensate for context loss
   - External memory proxies that intercept API calls and inject context
   - Neo4j-compatible graph storage for project context

### Existing Hive-Mind Capabilities

The hive-mind codebase already has foundational infrastructure:

1. **Session ID extraction** (`src/claude.lib.mjs:977-979`):
   ```javascript
   if (!sessionId && data.session_id) {
     sessionId = data.session_id;
     await log(`📌 Session ID: ${sessionId}`);
   }
   ```

2. **Session resume support** (`src/claude.lib.mjs:900`):
   ```javascript
   claudeArgs = `--resume ${argv.resume} ${claudeArgs}`;
   ```

3. **Token calculation from session files** (`src/claude.lib.mjs:670-678`):
   ```javascript
   const sessionFile = path.join(homeDir, '.claude', 'projects', projectDirName, `${sessionId}.jsonl`);
   ```

4. **Session documentation** (`docs/dependencies-research/claude-sessions/README.md`):
   - Session IDs can be extracted from JSON output
   - `--resume <session-id>` restores conversation context
   - Session data stored in `~/.claude/projects/[project-path]/[session-id].jsonl`

## Related Issues

| Issue | Title | Status | Relevance |
|-------|-------|--------|-----------|
| [#661](https://github.com/link-assistant/hive-mind/issues/661) | Auto-restart with session resume for cost optimization | Open | Session management foundation |
| [#964](https://github.com/link-assistant/hive-mind/issues/964) | Discussions not loaded to AI context | Open | Context completeness |
| [#448](https://github.com/link-assistant/hive-mind/issues/448) | Support entire organization clone for full local context | Open | Organization-wide context |

## Root Cause Analysis

### The Core Problem

AI coding tools operate in a **stateless paradigm** where each session:
1. Starts with zero accumulated knowledge
2. Reads static configuration files (CLAUDE.md, codex.md)
3. Performs work and generates learnings
4. **Discards all learnings when session ends**

This creates a **knowledge accumulation gap** where:
- Project-specific patterns are forgotten
- Decision rationale is lost
- Debugging insights are not preserved
- Consistent coding style is hard to maintain

### Current Storage Locations

| Tool | Session Storage Location |
|------|-------------------------|
| Claude | `~/.claude/projects/[project-path]/[session-id].jsonl` |
| Codex | `~/.codex/sessions/[session-id].jsonl` |
| OpenCode | `~/.opencode/conversations/` (structure varies) |

These locations are:
- **Local to the developer machine** (not shared)
- **Scattered across home directories** (not organized)
- **Not version controlled** (not preserved)
- **Not project-specific** (mixed with other projects)

## Proposed Solution Architecture

### Option 1: Post-Session Sync (Like context-doc)

**Approach**: After each solve.mjs session, copy relevant session files to `.knowledge/` folder in the repository.

**Implementation**:
```
.knowledge/
├── .claude/
│   └── sessions/
│       ├── 2025-12-27-fix-auth-bug.jsonl
│       └── 2025-12-26-add-feature-x.jsonl
├── .codex/
│   └── sessions/
│       └── ...
└── .opencode/
    └── conversations/
        └── ...
```

**Pros**:
- Simple implementation
- Preserves full session context
- Compatible with all tools
- No changes to AI tool behavior

**Cons**:
- Large file sizes (JSONL files can be 100KB+ each)
- Contains potentially sensitive information
- Git repository bloat over time
- May need cleanup/rotation policy

### Option 2: Extracted Summaries

**Approach**: Use AI to summarize each session's key learnings before storing.

**Implementation**:
```
.knowledge/
├── summaries/
│   ├── 2025-12-27-fix-auth-bug.md
│   └── 2025-12-26-add-feature-x.md
├── patterns/
│   └── coding-patterns.md
└── decisions/
    └── architectural-decisions.md
```

**Pros**:
- Much smaller storage footprint
- Human-readable summaries
- Can be curated and edited
- Safe to commit to public repos

**Cons**:
- Loses detailed context
- Requires additional AI processing
- Summarization may miss important details
- Added latency and cost

### Option 3: Hybrid Approach (Recommended)

**Approach**: Store both raw session files (excluded from git) and extracted summaries (committed).

**Implementation**:
```
.knowledge/
├── raw/                    # gitignored
│   ├── .claude/
│   └── .codex/
├── summaries/              # committed
│   └── *.md
├── patterns.md             # committed - accumulated patterns
├── decisions.md            # committed - key decisions
└── .gitignore              # ignores raw/ folder
```

**Pros**:
- Full context available locally
- Clean summaries in repository
- No git bloat
- Balances completeness vs cleanliness

**Cons**:
- More complex implementation
- Requires sync between raw and summaries

### Option 4: MCP-Based Knowledge Store

**Approach**: Use Claude's Model Context Protocol (MCP) to connect to a persistent knowledge store.

**Implementation**: Create MCP server that:
1. Captures session learnings in real-time
2. Stores in structured database (SQLite, Neo4j, etc.)
3. Injects relevant context into new sessions

**Pros**:
- Most powerful solution
- Real-time context accumulation
- Intelligent context retrieval
- Cross-session learning

**Cons**:
- Most complex implementation
- Requires MCP infrastructure
- Tool-specific (Claude only initially)
- Additional maintenance burden

## Recommended Implementation Plan

### Phase 1: Foundation (Option 3 - Hybrid)

1. Add `--keep-tool-context-in-repository` flag to solve.mjs config
2. After session completion, copy session JSONL to `.knowledge/raw/`
3. Add `.knowledge/raw/` to `.gitignore`
4. Create session summary using AI and save to `.knowledge/summaries/`

### Phase 2: Pattern Extraction

1. Periodically analyze accumulated summaries
2. Extract recurring patterns to `.knowledge/patterns.md`
3. Record architectural decisions to `.knowledge/decisions.md`
4. Update CLAUDE.md to reference `.knowledge/` files

### Phase 3: Cross-Tool Support

1. Extend to Codex sessions
2. Extend to OpenCode sessions
3. Normalize session formats for consistency
4. Add cleanup/rotation policies

### Phase 4: MCP Integration (Future)

1. Create MCP server for knowledge retrieval
2. Enable real-time context injection
3. Implement intelligent relevance filtering
4. Add cross-project learning (optional)

## Cost-Benefit Analysis

### Benefits

| Benefit | Impact |
|---------|--------|
| Reduced context re-explanation | Save 5-10 min per session |
| More consistent decisions | Fewer rework cycles |
| Preserved debugging insights | Faster bug resolution |
| Team knowledge sharing | Better collaboration |
| AI learning accumulation | Improved quality over time |

### Costs

| Cost | Mitigation |
|------|------------|
| Storage overhead | Rotation policies, gitignore raw files |
| Implementation effort | Phase-based rollout |
| Summarization tokens | Use efficient models (haiku) |
| Maintenance | Automated cleanup scripts |

## References

### External Resources
- [Claude Code Best Practices](https://www.anthropic.com/engineering/claude-code-best-practices)
- [Context Engineering for Claude Code](https://thomaslandgraf.substack.com/p/context-engineering-for-claude-code)
- [Async Code Research with Coding Agents](https://simonwillison.net/2025/Nov/6/async-code-research/)
- [Claude Code Memory Documentation](https://code.claude.com/docs/en/memory)

### Related Hive-Mind Documentation
- `docs/dependencies-research/claude-sessions/README.md` - Session management research
- `docs/case-studies/issue-661-session-resume-cost-optimization/` - Session resume case study (PR #662)

### External Repositories
- [ProverCoderAI/context-doc](https://github.com/ProverCoderAI/context-doc) - Inspiration for this feature
- [anthropics/claude-code Issues](https://github.com/anthropics/claude-code/issues) - Community feedback on context persistence

## Conclusion

The `--keep-tool-context-in-repository` option addresses a fundamental limitation in current AI coding tools: the lack of persistent learning across sessions. By implementing a hybrid approach that stores raw sessions locally and commits summaries to the repository, we can:

1. **Preserve valuable session context** for future reference
2. **Enable AI to learn from past decisions** in subsequent sessions
3. **Share project-specific knowledge** across team members
4. **Build towards more intelligent context management** via MCP

This feature aligns with industry trends toward persistent AI memory and addresses documented pain points in the developer community.

## Next Steps

1. **Gather feedback** on proposed architecture
2. **Prototype Option 3** (Hybrid approach) in a feature branch
3. **Test with real sessions** to validate summarization quality
4. **Iterate based on usage** patterns and team feedback

---

*This case study was compiled on 2025-12-27 as part of the architectural exploration for issue #981.*
