    console.log(`[VERBOSE] isolation-runner: Using $ binary at: ${binPath}`);
    console.log(`[VERBOSE] isolation-runner: Backend: ${backend}, Session ID: ${sessionId}`);
  }
  // Issue #2146 / PR #2147 review: a Formal AI task gets its own sidecar,
  // started on demand and reachable only over an internal Docker network. The
  // lease is taken before the container is launched so the endpoint is known
  // when the task's environment is built, and released again if the launch
  // fails. Fail closed — a Formal AI task must never start without Formal AI.
  const hostEnv = options.env || process.env;
  const { sidecar, error: sidecarError } = await acquireFormalAiSidecarForTask({ backend, args, model: options.model ?? null, tool: options.tool ?? null, sessionId, env: hostEnv, verbose });
  if (sidecarError) return failLaunch(sidecarError);
  const taskEnv = sidecar ? { ...hostEnv, HIVE_MIND_FORMAL_AI_BASE_URL: sidecar.baseUrl } : hostEnv;
  const effectiveOptions =
    backend === 'docker'
      ? {
          ...options,
          env: await resolveFormalAiIsolationEnv(taskEnv),
        }
      : options;
  const startCommandArgs = buildStartCommandArgs(command, args, { ...effectiveOptions, sessionId });
  if (verbose) {
    console.log(`[VERBOSE] isolation-runner: ${[binPath, ...startCommandArgs].map(shellQuote).join(' ')}`);
    if (backend === 'docker') {
      const env = effectiveOptions.env || process.env;
      const image = getDockerIsolationImage({ env });
      const mounts = getDockerIsolationAuthMounts({ tool: effectiveOptions.tool, env, homeDir: effectiveOptions.homeDir || os.homedir(), existsSync: effectiveOptions.existsSync || fs.existsSync });
      console.log('[VERBOSE] isolation-runner: Docker isolation backend: native ($ --isolated docker)');
      console.log(`[VERBOSE] isolation-runner: Docker isolation image: ${image}`);
      console.log(`[VERBOSE] isolation-runner: Docker isolation privileged: ${shouldRunPrivilegedDockerIsolation(image, env)}`);
      console.log('[VERBOSE] isolation-runner: Docker isolation pull: reuse local image if present, pull only if missing (start-command default)');
      console.log(`[VERBOSE] isolation-runner: Docker isolation mounts: ${mounts.map(m => m.target).join(', ') || '(none)'}`);
      const gitIdentityMounted = mounts.some(m => m.target === path.join(DOCKER_CONTAINER_HOME, '.gitconfig') || m.target === path.join(DOCKER_CONTAINER_HOME, '.config', 'git'));
      console.log(`[VERBOSE] isolation-runner: Docker isolation git identity propagated: ${gitIdentityMounted ? 'yes' : 'no (host ~/.gitconfig missing — child may fail with "Git identity not configured", issue #1939)'}`);
    }
  }
  const result = await runStartCommand(binPath, startCommandArgs);
  if (verbose) {
    const stream = result.success ? console.log : console.error;
    stream(`[VERBOSE] isolation-runner: Output: ${result.output.substring(0, 500)}`);
    if (result.error) stream(`[VERBOSE] isolation-runner: Error: ${result.error}`);
  }
  let containerFilesystemStartBytes = null;
  let formalAiAttachError = null;
  if (result.success && backend === 'docker') {
    try {
      containerFilesystemStartBytes = await getDockerContainerWritableLayerSize(sessionId, verbose);
      // The task command is still held by the start gate — the only safe
      // moment to add a second network. `docker network connect` is additive;
      // a single `docker run --network` would replace the default bridge and
      // cut the task off from GitHub (issue #2146). start-command 0.32.0+
      // could attach both networks at launch (repeatable `--network`,
      // start#156), but it implements that with this very create → connect →
      // start sequence, and doing it here keeps the attach fail-closed on any
      // installed version instead of silently one-network on older parsers.
      formalAiAttachError = await attachFormalAiTaskContainer({ sidecar, sessionId, verbose });
    } finally {
      await releaseDockerContainerStartGate(sessionId, verbose);
    }
  }
  if (sidecar && (!result.success || formalAiAttachError)) {
    // Fail closed: without the internal network the task cannot reach Formal
    // AI, and issue #2146 forbids falling back to another model.
    if (formalAiAttachError) await removeDockerContainer(sessionId, verbose);
    await releaseFormalAiSidecarForTask({ sidecar, sessionId, env: hostEnv, verbose });
    if (formalAiAttachError) {
      return failLaunch(`Formal AI task container could not be attached to the internal Formal AI network, so the task was stopped instead of falling back to another model (issue #2146): ${formalAiAttachError}`, { output: result.output });
    }
  }
  // Issue #1939: capture the freshly-launched docker session's reported status
  // and the live container state together, so the next iteration has the data to
  // diagnose a premature "executed/-1" status (problem #1) or a surprise image
