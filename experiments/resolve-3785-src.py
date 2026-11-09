import re
def resolve(path, resolutions):
    s = open(path).read()
    hunks = list(re.finditer(r'^<<<<<<< HEAD\n(.*?)^=======\n(.*?)^>>>>>>> origin/main\n', s, flags=re.S|re.M))
    assert len(hunks) == len(resolutions), (path, len(hunks), len(resolutions))
    out, pos = [], 0
    for m, r in zip(hunks, resolutions):
        out.append(s[pos:m.start()])
        out.append(r(m.group(1), m.group(2)) if callable(r) else r)
        pos = m.end()
    out.append(s[pos:])
    open(path, 'w').write(''.join(out))

ours = lambda a, b: a
theirs = lambda a, b: b

resolve('src/agent.lib.mjs', [
"""      const validationEnv = { ...process.env, ...getAgentModelOverlayEnv({ mappedModel }), ...buildGeolocationEnv() }; // Issue #2625: models Agent's provider table lacks
      await assertSharedToolData({ tool: 'agent', env: validationEnv });
      assertRouterTaskAuthentication({ tool: 'agent', env: { ...validationEnv, ...(options.useRouter === true ? { HIVE_MIND_USE_ROUTER: '1' } : {}) } });
      const runValidation = createRouterConnectionRunner({ $, tool: 'agent', useRouter: options.useRouter, log, env: () => validationEnv });
      const testResult = await runValidation`printf %s ${promptText('prompt.templates.connection.greeting', {}, { locale: 'en' })} | timeout ${Math.floor(timeouts.opencodeCli / 1000)} agent --model ${mappedModel}`;
""",
"""    const agentEnv = { ...process.env, ...buildGeolocationEnv(argv) };
    await assertSharedToolData({ tool: 'agent', env: agentEnv });
""",
"""    Object.assign(agentEnv, toolInvocation.env, buildGeolocationEnv(argv));
    await assertSharedToolData({ tool: 'agent', env: agentEnv });
""",
])
resolve('src/claude.connection.lib.mjs', [
"""        checkRouter();
        result = await runConnection`printf hi | claude --model ${mappedModel} -p --append-system-prompt ${withGeolocationPolicy('')}`;
""",
"""          checkRouter();
          result = await runConnection`timeout ${Math.floor(timeouts.claudeCli / 1000)} claude --model ${mappedModel} -p ${promptText('prompt.templates.connection.greeting', {}, { locale: 'en' })} --append-system-prompt ${withGeolocationPolicy('')}`;
""",
])
resolve('src/claude.lib.mjs', [lambda a, b: a.replace('...toolInvocation.env };', '...toolInvocation.env, ...buildGeolocationEnv(argv) };')])
resolve('src/codex.lib.mjs', [
"""    const connectionEnv = { ...getCodexExecEnv(verbose), ...buildGeolocationEnv() };
    checkRouter(connectionEnv);
    const geolocationArgs = buildCodexGeolocationConfigArgs();
    const runValidation = createRouterConnectionRunner({ $, tool: 'codex', useRouter, log, env: () => connectionEnv });
    const testResult = await runValidation`printf "echo hi" | timeout ${Math.floor(timeouts.codexCli / 1000)} codex exec --model ${mappedModel} --json --skip-git-repo-check ${reasoningArgs} ${geolocationArgs} --dangerously-bypass-approvals-and-sandbox`;
""",
"""    Object.assign(codexEnv, buildGeolocationEnv(argv));
    const { reasoningEffort, source: reasoningEffortSource, rolloutTokenBudget } = await resolveRuntimeCodexReasoningEffort({ ...argv, model: mappedModel, codexPath }, { log, env: codexEnv });
    let isResumeMode = !!argv.resume;
""",
])
resolve('src/formal-ai-version.lib.mjs', [theirs])
resolve('src/gemini.lib.mjs', [
"""    const command = await admittedCommand();
    const testResult = await runConnection`printf %s ${promptText('prompt.templates.connection.greeting', {}, { locale: 'en' })} | timeout ${Math.floor(timeouts.geminiCli / 1000)} ${command} --prompt ${promptText('prompt.templates.connection.gemini')} --output-format json --model ${mappedModel}`;
""",
"""  const { tempDir, workspaceTmpDir, branchName, prompt, systemPrompt: originalSystemPrompt, argv, log, formatAligned, getResourceSnapshot, forkedRepo, feedbackLines, geminiPath, $, waitForRetryDelay = waitWithCountdown } = params;
  const systemPrompt = withGeolocationPolicy(originalSystemPrompt, argv);
  const initialStorage = await admitNativeGeminiStorage({ command: geminiPath, useRouter: argv?.useRouter, expected: params[nativeStorageAdmission] });
  const recheckStorage = () => admitNativeGeminiStorage({ command: geminiPath, useRouter: argv?.useRouter, expected: initialStorage });
""",
lambda a, b: a.replace('const geminiEnv = { ...process.env, ...toolInvocation.env };', 'const geminiEnv = { ...process.env, ...toolInvocation.env, ...buildGeolocationEnv(argv) };'),
])
resolve('src/opencode.lib.mjs', [
"""      assertRouterTaskAuthentication({ tool: 'opencode', env: guardEnv() });
      const testResult = await runConnection`printf %s ${promptText('prompt.templates.connection.greeting', {}, { locale: 'en' })} | timeout ${Math.floor(timeouts.opencodeCli / 1000)} opencode run --format json --model ${mappedModel}`;
""",
"""    const opencodeEnv = { ...process.env, ...buildGeolocationEnv(argv) };
    await assertSharedToolData({ tool: 'opencode', env: opencodeEnv });
""",
"""    Object.assign(opencodeEnv, toolInvocation.env, buildGeolocationEnv(argv));
    await assertSharedToolData({ tool: 'opencode', env: opencodeEnv });
""",
])
resolve('src/qwen.lib.mjs', [ours])
resolve('src/use-with-retry.lib.mjs', [theirs])
