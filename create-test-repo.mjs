#!/usr/bin/env node
// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

const crypto = (await import('crypto')).default;

// Generate UUIDv7
function generateUUIDv7() {
  // UUIDv7 has timestamp in the first 48 bits
  const timestamp = Date.now();
  const timestampHex = timestamp.toString(16).padStart(12, '0');

  // Random data for the rest
  const randomBytes = crypto.randomBytes(10);

  // Format as UUID with version 7 (0111) and variant bits (10)
  const uuid = [
    timestampHex.slice(0, 8),
    timestampHex.slice(8, 12),
    '7' + randomBytes.toString('hex').slice(0, 3),
    ((randomBytes[2] & 0x3f) | 0x80).toString(16).padStart(2, '0') + randomBytes.toString('hex').slice(5, 7),
    randomBytes.toString('hex').slice(7, 19)
  ].join('-');

  return uuid;
}

// List of programming languages for random selection
const languages = [
  'Python',
  'JavaScript',
  'TypeScript',
  'Go',
  'Rust',
  'Ruby',
  'Java',
  'C++',
  'C#',
  'Swift',
  'Kotlin',
  'Scala',
  'Haskell',
  'Elixir',
  'Clojure',
  'F#',
  'OCaml',
  'Erlang',
  'Julia',
  'R',
  'PHP',
  'Perl',
  'Lua',
  'Dart',
  'Zig',
  'Nim',
  'Crystal',
  'V',
  'D',
  'Pascal',
  'COBOL',
  'Fortran',
  'Ada',
  'Prolog',
  'Scheme',
  'Racket',
  'Common Lisp',
  'Elm',
  'PureScript',
  'ReasonML'
];

// Select random language
const randomLanguage = languages[Math.floor(Math.random() * languages.length)];

// Generate repository name with UUIDv7
const uuid = generateUUIDv7();
const repoName = `test-hello-world-${uuid}`;

console.log('🚀 Creating test repository for solve.mjs testing');
console.log(`📦 Repository: ${repoName}`);
console.log(`💻 Language: ${randomLanguage}`);
console.log('');

try {
  // Get current GitHub user
  const userResult = await $`gh api user --jq .login`;
  const githubUser = userResult.stdout.toString().trim();
  console.log(`👤 User: ${githubUser}`);

  // Define repoUrl at the beginning
  const repoUrl = `https://github.com/${githubUser}/${repoName}`;

  // Create the repository with initial README to avoid empty repo
  process.stdout.write('📝 Creating repository with initial README... ');

  // Create a temporary directory for initial setup
  const tempDir = `/tmp/${repoName}-init`;
  const fs = (await import('fs')).promises;

  try {
    // Create the repository (will fail if it already exists, that's OK)
    const createResult =
      await $`gh repo create ${repoName} --public --description "Test repository for automated issue solving" --clone=false 2>&1`;
    if (createResult.code === 0) {
      console.log('created new repository... ');
    } else if (createResult.stderr && createResult.stderr.toString().includes('already exists')) {
      console.log('repository already exists... ');
    } else {
      throw new Error('Failed to create repository: ' + createResult.stderr);
    }

    // Create temp directory and clone
    const mkdirResult = await $`mkdir -p ${tempDir}`;
    if (mkdirResult.code !== 0) {
      throw new Error('Failed to create temp directory');
    }

    // Try to clone, if it fails (empty repo), initialize git
    const cloneResult = await $`git clone ${repoUrl} ${tempDir} 2>&1`;
    if (cloneResult.code !== 0) {
      // Clone failed (probably empty repo), initialize git locally
      const initResult = await $`cd ${tempDir} && git init`;
      if (initResult.code !== 0) {
        throw new Error('Failed to initialize git repository');
      }

      // Add remote
      const remoteResult = await $`cd ${tempDir} && git remote add origin ${repoUrl}`;
      if (remoteResult.code !== 0) {
        throw new Error('Failed to add git remote');
      }
    }

    // Always create README to ensure non-empty repo
    const readmeContent = `# ${repoName}

This is a test repository for automated issue solving.

## Purpose
This repository is used to test the \`solve.mjs\` script that automatically solves GitHub issues.

## Test Issue
An issue will be created asking to implement a "Hello World" program in ${randomLanguage}.

## Repository Status
- **Created**: ${new Date().toISOString()}
- **Language**: ${randomLanguage}
- **Type**: Test repository
`;

    const readmePath = `${tempDir}/README.md`;
    await fs.writeFile(readmePath, readmeContent);

    // Verify README was created
    try {
      await fs.access(readmePath);
    } catch (e) {
      throw new Error('Failed to create README file');
    }

    // Set up git authentication using gh
    process.stdout.write('Setting up git authentication... ');
    const authSetupResult = await $`cd ${tempDir} && gh auth setup-git 2>&1`;
    if (authSetupResult.code !== 0) {
      console.log('⚠️  gh auth setup-git had issues');
      console.log('Output:', authSetupResult.stdout.toString());
    } else {
      console.log('✅');
    }

    // Check if we need to create initial branch
    process.stdout.write('Checking branch status... ');
    const branchCheck = await $`cd ${tempDir} && git branch --show-current 2>/dev/null || echo ""`;
    const currentBranch = branchCheck.stdout.toString().trim();

    if (!currentBranch) {
      // No branch exists, create main branch
      const createBranchResult = await $`cd ${tempDir} && git checkout -b main`;
      if (createBranchResult.code !== 0) {
        throw new Error('Failed to create main branch');
      }
      console.log('created main branch ✅');
    } else {
      console.log(`on branch ${currentBranch} ✅`);
    }

    // Verify we're on a branch
    const verifyBranchResult = await $`cd ${tempDir} && git branch --show-current`;
    if (verifyBranchResult.code !== 0 || !verifyBranchResult.stdout.toString().trim()) {
      throw new Error('Failed to verify git branch');
    }

    // Add README
    process.stdout.write('Adding README to git... ');
    const addResult = await $`cd ${tempDir} && git add README.md`;
    if (addResult.code !== 0) {
      throw new Error('Failed to add README to git');
    }
    console.log('✅');

    // Commit README
    process.stdout.write('Committing README... ');
    const commitResult = await $`cd ${tempDir} && git commit -m "Initial commit with README"`;
    if (commitResult.code !== 0) {
      // Check if already committed
      const statusResult = await $`cd ${tempDir} && git status --porcelain`;
      if (statusResult.stdout.toString().trim()) {
        throw new Error('Failed to commit README');
      }
      console.log('already committed ✅');
    } else {
      console.log('✅');
    }

    // Push to remote
    process.stdout.write('Pushing to remote... ');

    // First, ensure we have the latest remote URL
    const remoteCheckResult = await $`cd ${tempDir} && git remote -v`;
    if (remoteCheckResult.code !== 0 || !remoteCheckResult.stdout.toString().includes('origin')) {
      // Re-add the remote if missing
      await $`cd ${tempDir} && git remote remove origin 2>/dev/null || true`;
      await $`cd ${tempDir} && git remote add origin https://github.com/${githubUser}/${repoName}.git`;
    }

    // Use execSync to avoid command-stream issues with git push
    // command-stream seems to interfere with git push authentication
    const { execSync } = await import('child_process');
    try {
      const pushCommand = `cd ${tempDir} && git push -u origin main 2>&1`;
      const pushOutput = execSync(pushCommand, { encoding: 'utf8' });
      console.log('Push output:', pushOutput);

      // Check if push actually did anything
      if (!pushOutput.includes('[new branch]') && !pushOutput.includes('->')) {
        console.log('⚠️  Push may not have succeeded - no branch update detected');
      } else {
        console.log('✅');
      }
    } catch (pushError) {
      console.log('❌ Push failed');
      console.log('Error:', pushError.message);
      throw new Error('Failed to push to remote: ' + pushError.message);
    }

    // Wait a moment for GitHub to process the push
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify the push succeeded by checking if repo is non-empty
    process.stdout.write('Verifying repository is non-empty... ');
    let verifyResult = await $`gh repo view ${githubUser}/${repoName} --json isEmpty --jq .isEmpty`;
    let isEmpty = verifyResult.stdout.toString().trim();

    // Retry once if still showing as empty (GitHub might need a moment)
    if (isEmpty === 'true') {
      console.log('waiting for GitHub to update...');
      await new Promise(resolve => setTimeout(resolve, 3000));
      verifyResult = await $`gh repo view ${githubUser}/${repoName} --json isEmpty --jq .isEmpty`;
      isEmpty = verifyResult.stdout.toString().trim();
    }

    if (isEmpty === 'true') {
      console.log('❌ Still empty!');
      // Try to get more debug info
      const branchesResult = await $`cd ${tempDir} && git branch -r`;
      console.log('Remote branches:', branchesResult.stdout.toString());
      const logResult = await $`cd ${tempDir} && git log --oneline -n 5`;
      console.log('Local commits:', logResult.stdout.toString());
      throw new Error('Repository is still empty after push');
    }
    console.log('✅');

    console.log('All repository setup complete! ✅');

    // Clean up temp directory
    await $`rm -rf ${tempDir}`;

    // Now set up branch protection
    process.stdout.write('🔒 Setting up branch protection... ');

    try {
      // Get default branch
      const defaultBranchResult = await $`gh api repos/${githubUser}/${repoName} --jq .default_branch`;
      const defaultBranch = defaultBranchResult.stdout.toString().trim() || 'main';

      // Try to enable branch protection (may fail for free accounts)
      const protectionRules = {
        required_status_checks: null,
        enforce_admins: false,
        required_pull_request_reviews: {
          dismiss_stale_reviews: false,
          require_code_owner_reviews: false,
          required_approving_review_count: 0
        },
        restrictions: null,
        allow_force_pushes: false,
        allow_deletions: false
      };

      // Write rules to a temp file to avoid shell escaping issues
      const rulesFile = `/tmp/protection-rules-${Date.now()}.json`;
      await fs.writeFile(rulesFile, JSON.stringify(protectionRules, null, 2));

      const protectResult = await $`gh api \
        --method PUT \
        repos/${githubUser}/${repoName}/branches/${defaultBranch}/protection \
        --input ${rulesFile} 2>/dev/null`;

      await fs.unlink(rulesFile);

      if (protectResult.code === 0) {
        console.log('✅');
      } else {
        console.log('⚠️  (requires admin rights or paid plan)');
      }
    } catch (protectError) {
      console.log('⚠️  (requires admin rights or paid plan)');
    }
  } catch (error) {
    console.log('❌ Failed!');
    console.error('Error:', error.message);
    process.exit(1);
  }

  // Create the issue
  process.stdout.write('🎯 Creating issue... ');

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
- The GitHub Actions workflow should be in \`.github/workflows/\` directory
- The workflow should have a meaningful name like \`test-hello-world.yml\`

## Definition of Done
- [ ] Program file created with correct extension
- [ ] Code prints "Hello, World!" exactly
- [ ] Code is properly commented
- [ ] Code follows ${randomLanguage} conventions
- [ ] Instructions for running the program are included (if needed)
- [ ] GitHub Actions workflow created and passing
- [ ] CI badge showing build status (optional but recommended)`;

  let createIssueResult;
  let issueUrl;

  try {
    // Write issue body to a temp file to avoid shell escaping issues
    const fs = (await import('fs')).promises;
    const issueBodyFile = `/tmp/issue-body-${Date.now()}.md`;
    await fs.writeFile(issueBodyFile, issueBody);

    // IMPORTANT: Workaround for command-stream quoting issue
    // Problem: command-stream adds extra single quotes around interpolated strings
    // When we use: await $`gh issue create --title "${issueTitle}"`
    // The title becomes: 'Implement Hello World in X' (with single quotes included!)
    //
    // This is a known issue with command-stream library (see command-stream-issues/issue-09-auto-quoting.mjs)
    // The library appears to "over-escape" by adding its own single quotes around the interpolated value
    // when it detects double quotes in the template literal.
    //
    // WORKAROUND: Use Node.js native child_process.execSync instead of command-stream
    // This gives us direct control over the command string without unexpected quote additions

    // Using execSync to avoid command-stream's automatic quote addition
    const { execSync } = await import('child_process');
    const command = `gh issue create --repo ${repoUrl} --title "${issueTitle}" --body-file ${issueBodyFile}`;
    const output = execSync(command, { encoding: 'utf8', cwd: '/tmp' });
    createIssueResult = { stdout: Buffer.from(output) };

    // Note: If GitHub CLI had a --title-file option (like --body-file), we would use that instead
    // to completely avoid shell escaping issues

    // Clean up temp file
    await fs.unlink(issueBodyFile);

    // Extract issue URL from the output
    const issueOutput = createIssueResult.stdout.toString().trim();
    issueUrl = issueOutput.split('\n').pop(); // Last line contains the URL
  } catch (issueError) {
    console.log('❌ Failed!');
    console.error('Error:', issueError.message);
    process.exit(1);
  }

  if (!issueUrl || !issueUrl.includes('github.com')) {
    console.log('❌ Failed to extract issue URL');
    process.exit(1);
  }

  console.log('✅');
  console.log('');

  // Output summary
  console.log('✨ Test environment created successfully!');
  console.log('');
  console.log('📦 Repository:');
  console.log(`   ${repoUrl}`);
  console.log('');
  console.log('🎯 Issue:');
  console.log(`   ${issueUrl}`);
  console.log('');
  console.log('🚀 Test with:');
  console.log(`   ./solve.mjs "${issueUrl}"`);
} catch (error) {
  console.log('');
  console.error('❌ Error:', error.message);
  process.exit(1);
}
