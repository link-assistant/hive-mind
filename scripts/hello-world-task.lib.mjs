/** One task definition for both repository and orphan-branch fixtures. */
export function helloWorldReadme({ repoName, randomLanguage, createdAt = new Date().toISOString() }) {
  return `# ${repoName}

This is a test repository for automated issue solving.

## Purpose
This repository is used to test the \`solve.mjs\` script that automatically solves GitHub issues.

## Test Issue
An issue will be created asking to implement a "Hello World" program in ${randomLanguage}.

## Repository Status
- **Created**: ${createdAt}
- **Language**: ${randomLanguage}
- **Type**: Test repository
`;
}

/**
 * #3332: `workflowDir` is `ci/` when the row's token cannot push
 * `.github/workflows` (the default `GITHUB_TOKEN`); the harness then copies the
 * workflow into place and runs it with act.
 */
export function helloWorldIssue(randomLanguage, { workflowDir = '.github/workflows/' } = {}) {
  const staged = workflowDir !== '.github/workflows/';
  const issueTitle = `Implement Hello World in ${randomLanguage}`;
  const issueBody = `## Task
Please implement a "Hello World" program in ${randomLanguage}.

## Requirements
1. Create a file with the appropriate extension for ${randomLanguage}
2. The program should print exactly: \`Hello, World!\`
3. Add clear comments explaining the code
4. Ensure the code follows ${randomLanguage} best practices and idioms
5. If applicable, include build/run instructions in a comment at the top of the file
6. **Create a GitHub Actions workflow that automatically runs and tests the program on every push and pull request**

## Expected Output
When the program runs, it should output:
\`\`\`
Hello, World!
\`\`\`

## GitHub Actions Requirements
The CI/CD workflow should:
- Trigger on push to main branch and on pull requests
- Set up the appropriate ${randomLanguage} runtime/compiler
- Run the Hello World program
- Verify the output is exactly "Hello, World!"
- Show a green check mark when tests pass

Example workflow structure:
- Checkout code
- Setup ${randomLanguage} environment
- Run the program
- Assert output matches expected string

## Additional Notes
- The implementation should be simple and straightforward
- Focus on clarity and correctness
- Use the standard library only (no external dependencies unless absolutely necessary for ${randomLanguage})
- The GitHub Actions workflow should be in \`${workflowDir}\` directory
- The workflow should have a meaningful name like \`test-hello-world.yml\`${staged ? `\n- Save the workflow as \`${workflowDir}test-hello-world.yml\`, not under \`.github/workflows/\`: this repository's token cannot push workflow files, so the test harness copies it there and runs it` : ''}

## Definition of Done
- [ ] Program file created with correct extension
- [ ] Code prints "Hello, World!" exactly
- [ ] Code is properly commented
- [ ] Code follows ${randomLanguage} conventions
- [ ] Instructions for running the program are included (if needed)
- [ ] GitHub Actions workflow created and passing
- [ ] CI badge showing build status (optional but recommended)`;
  return { title: issueTitle, body: issueBody };
}
