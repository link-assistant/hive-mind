#!/usr/bin/env node

import fs from 'fs/promises';

const updates = [
  // solve.feedback.lib.mjs
  {
    file: 'src/solve.feedback.lib.mjs',
    edits: [
      { line: 69, context: 'check_pr_status', operation: 'fetch_pr_status' },
      { line: 181, context: 'fetch_pr_comments', operation: 'get_pr_comments' },
      { line: 227, context: 'fetch_issue_comments', operation: 'get_issue_comments' },
      { line: 250, context: 'fetch_commit_comments', operation: 'get_commit_comments' },
      { line: 278, context: 'fetch_pr_reviews', operation: 'get_pr_reviews' },
      { line: 299, context: 'fetch_pr_review_comments', operation: 'get_pr_review_comments' },
      { line: 338, context: 'detect_feedback_general', operation: 'detect_and_count_feedback' },
    ],
  },
  // solve.repository.lib.mjs
  {
    file: 'src/solve.repository.lib.mjs',
    edits: [
      { line: 50, context: 'git_clone', operation: 'clone_repository' },
      { line: 379, context: 'cleanup_repository', operation: 'remove_temp_dir' },
    ],
  },
  // solve.results.lib.mjs
  {
    file: 'src/solve.results.lib.mjs',
    edits: [
      { line: 71, context: 'cleanup_claude_file', operation: 'remove_claude_md' },
      { line: 315, context: 'search_existing_pr', operation: 'find_pr_for_issue' },
      { line: 358, context: 'attach_success_log', operation: 'attach_log_to_pr' },
      { line: 374, context: 'close_success_pr', operation: 'close_pull_request' },
    ],
  },
  // solve.validation.lib.mjs
  {
    file: 'src/solve.validation.lib.mjs',
    edits: [
      { line: 143, context: 'environment_validation', operation: 'validate_environment' },
      { line: 147, context: 'create_log_directory', operation: 'mkdir_log_dir' },
    ],
  },
  // solve.watch.lib.mjs
  {
    file: 'src/solve.watch.lib.mjs',
    edits: [
      { line: 35, context: 'check_pr_merged', operation: 'check_merge_status' },
      { line: 52, context: 'check_pr_closed', operation: 'check_close_status' },
      { line: 166, context: 'check_claude_file_exists', operation: 'check_file_in_branch' },
      { line: 192, context: 'recheck_claude_file', operation: 'verify_file_in_branch' },
      { line: 253, context: 'watch_pr_general', operation: 'watch_pull_request' },
    ],
  },
];

async function addReportErrorToFile(filePath, edits) {
  console.log(`Processing ${filePath}...`);

  try {
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.split('\n');

    // Sort edits by line number in reverse order to avoid offset issues
    edits.sort((a, b) => b.line - a.line);

    for (const edit of edits) {
      const lineIndex = edit.line - 1;

      if (lineIndex >= 0 && lineIndex < lines.length) {
        const line = lines[lineIndex];

        // Check if it's a catch block
        if (line.includes('} catch')) {
          // Check if reportError is already there on the next line
          if (lineIndex + 1 < lines.length && !lines[lineIndex + 1].includes('reportError')) {
            // Get the variable name from the catch statement
            const varMatch = line.match(/catch\s*\((\w+)\)/);
            const varName = varMatch ? varMatch[1] : 'error';

            // Get the indentation
            const indentMatch = lines[lineIndex + 1].match(/^(\s*)/);
            const indent = indentMatch ? indentMatch[1] : '    ';

            // Build the reportError call
            const reportCall = `${indent}reportError(${varName}, {
${indent}  context: '${edit.context}',
${indent}  operation: '${edit.operation}'
${indent}});`;

            // Insert after the catch line
            lines.splice(lineIndex + 1, 0, reportCall);
            console.log(`  ✓ Added reportError at line ${edit.line}: ${edit.context}`);
          } else {
            console.log(`  ⊗ Line ${edit.line} already has reportError or invalid`);
          }
        } else {
          console.log(`  ⊗ Line ${edit.line} is not a catch block`);
        }
      }
    }

    // Write back the modified content
    await fs.writeFile(filePath, lines.join('\n'));
    console.log(`  ✓ File updated successfully\n`);
  } catch (error) {
    console.error(`  ✗ Error processing ${filePath}: ${error.message}\n`);
  }
}

async function main() {
  for (const update of updates) {
    await addReportErrorToFile(update.file, update.edits);
  }
  console.log('Done!');
}

main().catch(console.error);
