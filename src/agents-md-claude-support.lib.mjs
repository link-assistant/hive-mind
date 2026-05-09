const AGENTS_MD_FILENAMES = Object.freeze(['AGENTS.md', 'agents.md']);
const CLAUDE_MD_FILENAME = 'CLAUDE.md';

const noopLog = async () => {};
const fallbackFormatAligned = (_icon, label, value) => `${label} ${value}`;

const readFileIfExists = async (fs, filePath) => {
  try {
    return { exists: true, content: await fs.readFile(filePath, 'utf8') };
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, content: null };
    throw error;
  }
};

export const userInputMentionsClaudeMd = input => /\bCLAUDE\.md\b/i.test(String(input || ''));

export const findAgentsMdFile = async ({ tempDir, fs, path }) => {
  for (const fileName of AGENTS_MD_FILENAMES) {
    const filePath = path.join(tempDir, fileName);
    const result = await readFileIfExists(fs, filePath);
    if (result.exists) return { fileName, filePath, content: result.content };
  }
  return null;
};

export const prepareAgentsMdAsClaudeMd = async params => {
  const { tempDir, argv, prompt = '', fs, path, log = noopLog, formatAligned = fallbackFormatAligned } = params;
  const state = {
    enabled: !!argv?.autoSupportAgentsMdAsClaudeMd,
    created: false,
    cleanupCandidate: false,
    userInputMentionsClaudeMd: userInputMentionsClaudeMd(prompt),
    claudePath: path.join(tempDir, CLAUDE_MD_FILENAME),
    agentsPath: null,
  };

  if (!state.enabled) return state;

  const tool = argv?.tool || 'claude';
  if (tool !== 'claude') {
    await log('   AGENTS.md as CLAUDE.md support skipped: only supported for --tool claude', { verbose: true });
    return { ...state, skippedReason: 'non-claude-tool' };
  }

  const agentsFile = await findAgentsMdFile({ tempDir, fs, path });
  if (!agentsFile) {
    await log('   AGENTS.md as CLAUDE.md support enabled, but no AGENTS.md file was found', { verbose: true });
    return { ...state, skippedReason: 'missing-agents-md' };
  }

  state.agentsPath = agentsFile.filePath;
  const claudeFile = await readFileIfExists(fs, state.claudePath);
  if (claudeFile.exists) {
    if (claudeFile.content === agentsFile.content) {
      state.cleanupCandidate = !state.userInputMentionsClaudeMd;
      const action = state.cleanupCandidate ? 'will remove it after Claude exits' : 'leaving it untouched because user input mentions CLAUDE.md';
      await log(`   CLAUDE.md already matches AGENTS.md; ${action}`, { verbose: true });
      return { ...state, skippedReason: 'claude-md-already-matches-agents-md' };
    }
    await log('   Existing CLAUDE.md differs from AGENTS.md; leaving it untouched', { verbose: true });
    return { ...state, skippedReason: 'claude-md-differs' };
  }

  await fs.writeFile(state.claudePath, agentsFile.content);
  state.created = true;
  await log(formatAligned('AGENTS.md', 'Temporary CLAUDE.md:', `created from ${agentsFile.fileName}`));
  return state;
};

const gitStatusForClaudeMd = async ({ $, tempDir }) => {
  if (!$) return '';
  const result = await $({ cwd: tempDir })`git status --porcelain -- ${CLAUDE_MD_FILENAME} 2>&1`;
  return result.stdout?.toString().trim() || '';
};

const isClaudeMdTracked = async ({ $, tempDir }) => {
  if (!$) return false;
  const result = await $({ cwd: tempDir })`git ls-files --error-unmatch -- ${CLAUDE_MD_FILENAME} 2>&1`;
  return result.code === 0;
};

const removeTrackedClaudeMd = async ({ $, tempDir }) => {
  if (!$) return { code: 1, stdout: '', stderr: 'No git runner provided' };
  return await $({ cwd: tempDir })`git rm -f -- ${CLAUDE_MD_FILENAME} 2>&1`;
};

const commitClaudeMdRemoval = async ({ $, tempDir }) => {
  const message = 'Remove temporary CLAUDE.md copy from AGENTS.md';
  return await $({ cwd: tempDir })`git commit -m ${message} -- ${CLAUDE_MD_FILENAME} 2>&1`;
};

export const cleanupAgentsMdAsClaudeMd = async params => {
  const { state, tempDir, branchName, fs, path, $, log = noopLog, formatAligned = fallbackFormatAligned } = params;
  if (!state?.created && !state?.cleanupCandidate) return { action: 'skipped' };

  const claudePath = state.claudePath || path.join(tempDir, CLAUDE_MD_FILENAME);
  const claudeFile = await readFileIfExists(fs, claudePath);
  if (!claudeFile.exists) return { action: 'already-removed' };

  const agentsFile = await findAgentsMdFile({ tempDir, fs, path });
  if (!agentsFile || claudeFile.content !== agentsFile.content) {
    await log('   Temporary CLAUDE.md changed or AGENTS.md is missing; leaving it untouched', { verbose: true });
    return { action: 'left-modified' };
  }

  const status = await gitStatusForClaudeMd({ $, tempDir });
  const tracked = await isClaudeMdTracked({ $, tempDir });
  const isUntracked = status.split('\n').some(line => line.startsWith('??'));

  if (isUntracked || (!tracked && !status)) {
    await fs.rm(claudePath, { force: true });
    await log(formatAligned('AGENTS.md', 'Temporary CLAUDE.md:', 'removed'));
    return { action: 'removed-untracked' };
  }

  if (state.userInputMentionsClaudeMd) {
    await log('   Temporary CLAUDE.md matches AGENTS.md but user input mentions CLAUDE.md; leaving it untouched', { verbose: true });
    return { action: 'left-user-mentioned-claude-md' };
  }

  const rmResult = await removeTrackedClaudeMd({ $, tempDir });
  if (rmResult.code !== 0) {
    await log(`   Warning: could not remove temporary CLAUDE.md from git: ${rmResult.stderr || rmResult.stdout}`, { verbose: true });
    return { action: 'remove-failed' };
  }

  const postRemoveStatus = await gitStatusForClaudeMd({ $, tempDir });
  if (!postRemoveStatus) {
    await log(formatAligned('AGENTS.md', 'Temporary CLAUDE.md:', 'removed from git index'));
    return { action: 'removed-staged-addition' };
  }

  const commitResult = await commitClaudeMdRemoval({ $, tempDir });
  if (commitResult.code !== 0) {
    await log(`   Warning: temporary CLAUDE.md was removed locally but commit failed: ${commitResult.stderr || commitResult.stdout}`, { verbose: true });
    return { action: 'removed-uncommitted' };
  }

  if (branchName) {
    const pushResult = await $({ cwd: tempDir })`git push origin ${branchName} 2>&1`;
    if (pushResult.code !== 0) {
      await log(`   Warning: temporary CLAUDE.md removal commit was created but push failed: ${pushResult.stderr || pushResult.stdout}`, { verbose: true });
    }
  }

  await log(formatAligned('AGENTS.md', 'Temporary CLAUDE.md:', 'removed from committed changes'));
  return { action: 'removed-committed-copy' };
};

export const withAgentsMdAsClaudeMd = async (params, execute) => {
  const state = await prepareAgentsMdAsClaudeMd(params);
  try {
    return await execute();
  } finally {
    await cleanupAgentsMdAsClaudeMd({ ...params, state });
  }
};
