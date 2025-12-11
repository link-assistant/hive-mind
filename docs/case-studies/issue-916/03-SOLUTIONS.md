# Solutions - Issue #916

## Proposed Solutions and Recommendations

### Solution Overview

Add two new hints to the "Preparing pull request" section in both `agent.prompts.lib.mjs` and `claude.prompts.lib.mjs`:

1. **Check for recent comments before finalizing**
2. **Verify no uncommitted changes remain**

Both hints should follow the established style: "When x do y." with gentle guidance, not commands.

### Solution 1: Add Final Comment Check

#### For agent.prompts.lib.mjs

**Location**: Lines 153-161, "Preparing pull request" section, within "When you finalize the pull request:" subsection

**Proposed Addition** (after line 156, before "double-check that all changes..."):
```javascript
      check for latest comments on the issue and pull request to ensure no recent feedback was missed,
```

**Full Context**:
```javascript
   - When you finalize the pull request:
      follow style from merged prs for code, title, and description,
      make sure no uncommitted changes corresponding to the original requirements are left behind,
      make sure the default branch is merged to the pull request's branch,
      make sure all CI checks passing if they exist before you finish,
      check for latest comments on the issue and pull request to ensure no recent feedback was missed,
      double-check that all changes in the pull request answer to original requirements of the issue,
      make sure no new bugs are introduced in pull request by carefully reading gh pr diff,
      make sure no previously existing features were removed without an explicit request from users via the issue description, issue comments, and/or pull request comments.
```

#### For claude.prompts.lib.mjs

**Location**: Lines 169-177, "Preparing pull request" section, within "When you finalize the pull request:" subsection

**Proposed Addition** (after line 173, before "double-check that all changes..."):
```javascript
      check for latest comments on the issue and pull request to ensure no recent feedback was missed,
```

**Full Context**:
```javascript
   - When you finalize the pull request:
      follow style from merged prs for code, title, and description,
      make sure no uncommitted changes corresponding to the original requirements are left behind,
      make sure the default branch is merged to the pull request's branch,
      make sure all CI checks passing if they exist before you finish,
      check for latest comments on the issue and pull request to ensure no recent feedback was missed,
      double-check that all changes in the pull request answer to original requirements of the issue,
      make sure no new new bugs are introduced in pull request by carefully reading gh pr diff,
      make sure no previously existing features were removed without an explicit request from users via the issue description, issue comments, and/or pull request comments.
```

### Solution 2: Add Uncommitted Changes Check

#### For agent.prompts.lib.mjs

**Location**: Lines 176-179, "Self review" section

**Proposed Addition** (as new line before "When you finalize"):
```javascript
   - When you check your solution draft, verify git status shows a clean working tree with no uncommitted changes.
```

**Full Context**:
```javascript
Self review.
   - When you check your solution draft, run all tests locally.
   - When you check your solution draft, verify git status shows a clean working tree with no uncommitted changes.
   - When you compare with repo style, use gh pr diff [number].
   - When you finalize, confirm code, tests, and description are consistent.
```

#### For claude.prompts.lib.mjs

**Location**: Lines 191-194, "Self review" section

**Proposed Addition** (as new line before "When you finalize"):
```javascript
   - When you check your solution draft, verify git status shows a clean working tree with no uncommitted changes.
```

**Full Context**:
```javascript
Self review.
   - When you check your solution draft, run all tests locally.
   - When you check your solution draft, verify git status shows a clean working tree with no uncommitted changes.
   - When you compare with repo style, use gh pr diff [number].
   - When you finalize, confirm code, tests, and description are consistent.
```

### Alternative Considerations

#### Alternative 1: More Explicit Command
Instead of gentle hint, provide explicit command:
```
check for latest comments using: gh api repos/${owner}/${repo}/issues/${issueNumber}/comments --jq 'reverse | .[0:5]'
```

**Pros**: More actionable, exact command provided
**Cons**: Deviates from "gentle hints" style requested in issue
**Decision**: Use gentle hint as requested

#### Alternative 2: Add to Initial Research Only
Keep comment checking only in "Initial research" section, don't add to finalization.

**Pros**: Simpler, less repetition
**Cons**: Doesn't solve the temporal workflow gap
**Decision**: Add to finalization as this is when the gap occurs

#### Alternative 3: Separate Todo List Hint
Add hint to create todo item for checking comments:
```
When you start, add a todo item to check for recent comments before finalizing
```

**Pros**: Aligns with todo list workflow
**Cons**: Adds indirection; easier to forget
**Decision**: Add direct hint in finalization section for immediate action

### Implementation Strategy

#### Phase 1: Update System Messages (Current PR)
1. Add comment check hint to finalization sections in both files
2. Add git status check hint to self review sections in both files
3. Maintain consistent formatting and style with existing content
4. Preserve all existing hints and structure

#### Phase 2: Validation (In PR Review)
1. Review changes match the "When x do y" style
2. Verify hints are in correct sections
3. Test with actual agent/claude commands to ensure prompts work
4. Check that changes don't break existing functionality

#### Phase 3: Documentation (Future Enhancement)
Consider adding to contributing guidelines:
- Document the importance of checking comments before finalizing
- Add git status check to PR checklist template
- Create examples of good finalization workflow

### Expected Impact

**Immediate Benefits**:
- Agents will check for feedback before marking PRs ready
- Reduced risk of missing reviewer comments
- Cleaner working trees at PR completion
- Better alignment with industry best practices

**Long-term Benefits**:
- Improved collaboration between AI and human reviewers
- Fewer follow-up PRs needed to address missed feedback
- More complete and polished PRs
- Better user experience for maintainers

### Testing Recommendations

After implementation, test with:

1. **Comment Check Test**:
   - Create test issue with existing comments
   - Run `solve <issue> --tool agent`
   - Add new comment during agent work
   - Verify agent checks for new comment before finalizing

2. **Uncommitted Changes Test**:
   - Create test scenario that generates temporary files
   - Verify agent checks git status and handles uncommitted changes
   - Confirm working tree is clean before marking PR ready

3. **Style Consistency Test**:
   - Verify prompts still use "When x do y" gentle hint style
   - Check formatting matches existing patterns
   - Ensure no commands or imperatives introduced

### Alignment with Requirements

✅ **Style**: "When x do y." gentle hints, not commands
✅ **Scope**: Addresses both comment checking and uncommitted changes
✅ **Location**: Changes in correct prompt library files
✅ **Documentation**: Case study created with timeline, root causes, solutions
✅ **Research**: Online best practices researched and cited
✅ **Data**: All issue/PR data downloaded to case study folder

## Recommended Implementation

Proceed with Solution 1 and Solution 2 as described above:
- Add comment check hint to "Preparing pull request" finalization sections
- Add git status check hint to "Self review" sections
- Use gentle "When x do y" style as requested
- Maintain consistency across both agent and claude prompt libraries
