# Online Research - Issue #916

## Best Practices for Checking PR Comments Before Finalizing

### Key Findings

#### 1. Review Comment Status
PR authors should track comment statuses throughout the review process. Comments can be marked as:
- Active (default for new comments)
- Pending (under review)
- Resolved (issue addressed)

#### 2. Self-Review First
Review your own PRs before submitting to catch common issues like forgotten console.log() statements, which can significantly improve quality and save time.

#### 3. Ensure Timely Response to Comments
Start reviewing code within two hours after first submission to appreciate the work and avoid costly context switches. Prompt reviews, ideally within a couple of hours, keep the developer's momentum going, prevent context switching, and minimize the risk of introducing errors due to forgotten details.

#### 4. Address All Feedback
Developers must invest time drafting the pull request before sending it to ensure the entire process runs smoothly. Before submitting a pull request, ensure that changes do not break the build and pass all the tests successfully.

#### 5. Use Clear, Specific Comments
Clear and precise comments are crucial; vague remarks like "this doesn't look right" are unhelpful, instead articulate specific concerns such as "The use of this algorithm here could lead to performance issues with larger datasets".

#### 6. Check for Unresolved Issues
PRs that are hard to review get fewer comments and recommendations for improvement, often leading to undetected bugs and technical debt; in worst cases, bad PRs are ignored, negating their purpose entirely.

#### 7. Maintain Professional Tone
When giving feedback on errors, adopt a constructive mindset using positive language like "I suggest" or "You could improve X by doing Y," avoiding commands like "Do this".

### Sources
- [Pull Request Best Practices - Codacy](https://blog.codacy.com/pull-request-best-practices)
- [Pull Request Best Practices - Crystallize](https://crystallize.com/blog/pull-request-best-practices)
- [6 Pull Request Best Practices for Developers - Aikido](https://www.aikido.dev/blog/pull-request-best-practices)
- [Best Practices for Reviewing Pull Requests in GitHub - Rewind](https://rewind.com/blog/best-practices-for-reviewing-pull-requests-in-github/)
- [Effective Pull Request Comments: Best Practices for Developers - Graph AI](https://www.graphapp.ai/blog/effective-pull-request-comments-best-practices-for-developers)
- [8 Essential Pull Request Best Practices for 2025 - Sopa](https://www.heysopa.com/post/pull-request-best-practices)

## CI Checks for Uncommitted Changes

### Key Insights

#### GitHub Actions for Checking Uncommitted Changes
There are GitHub actions available specifically for checking if a repository has uncommitted changes, with changes outputted by `git status --porcelain`. One example is a Github Action that checks if there are staged, but uncommitted changes in a CI pipeline.

#### Stashing Uncommitted Changes
You can stash your uncommitted modifications (both staged and unstaged) for later usage and use them back from your working copy, as Git stash is excellent for storing changes temporarily. You should use Git stash with a meaningful message using `$ git stash save "Your meaningful stash message"` to help keep track of what's what easily.

#### CI/CD Integration
Best practices include:
- Protecting your main branch using pull request reviews and CI checks
- Automating with CI/CD using GitHub Actions, GitLab CI, or Jenkins for build and test pipelines
- Using Git with CI/CD helps make sure your code works well and gets to users quickly by testing code automatically and giving quick feedback to developers if there are problems right away

#### Reviewing Uncommitted Changes
It's important to review what you've modified before committing your changes, as this will help spot mistakes or unintended modifications early, reducing the risk of introducing bugs or regressions into your codebase.

#### Managing Uncommitted Changes
To maintain a clean and manageable workflow in Git, consider committing changes often instead of waiting for large and complex updates, as frequent small commits enhance tracking changes and reverting if necessary.

### Sources
- [Git Best Practices: Improving Your Workflow in 2025 - ScriptBinary](https://scriptbinary.com/git/git-best-practices-improving-workflow-2025)
- [Check uncommitted changes - GitHub Marketplace](https://github.com/marketplace/actions/check-uncommitted-changes)
- [How to Track and Manage Git Uncommitted Changes - LabEx](https://labex.io/tutorials/git-how-to-track-and-manage-git-uncommitted-changes-392756)
- [47 Git Best Practices to follow (in 2025) - aCompiler](https://acompiler.com/git-best-practices/)
- [Git Best Practices: Effective Source Control Management - Daily.dev](https://daily.dev/blog/git-best-practices-effective-source-control-management)
- [How to Check for Uncommitted or Unpushed Changes in Git - DEV Community](https://dev.to/msnmongare/how-to-check-for-uncommitted-or-unpushed-changes-in-git-11oh)
