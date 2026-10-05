/** Load token-free CLI capabilities through the shared read-through catalogue cache. */
import { resolveCodexReasoningEffort } from './codex.options.lib.mjs';
import { buildDefaultCatalogueFetchers, loadModelCatalogue } from './model-catalogue.lib.mjs';
import { fetchCodexCliCatalogue } from './model-catalogue-fetch.lib.mjs';

export const resolveRuntimeCodexReasoningEffort = async (argv, { getCatalogue = loadModelCatalogue, env = process.env, log = null, maxEffort = null, ...options } = {}) => {
  let catalogue;
  const binary = argv?.codexPath || env.CODEX_PATH || 'codex';
  const routed = argv?.useRouter || /^(1|true|yes)$/i.test(String(env.HIVE_MIND_USE_ROUTER ?? ''));
  try {
    catalogue = await getCatalogue({
      ...options,
      tool: 'codex',
      env,
      codexBinary: binary,
      // Runtime selection must not start a router container or request vendor APIs.
      sourceIds: [...(routed ? ['router'] : []), 'codex-cli', 'models-dev', 'bundled'],
      cacheOnlySourceIds: ['router', 'models-dev'],
      fetchers: options.fetchers ?? {
        ...buildDefaultCatalogueFetchers(),
        'codex-cli': () => fetchCodexCliCatalogue({ binary }),
      },
    });
  } catch (error) {
    if (log) await log(`Codex effort metadata unavailable: ${error.message}`, { verbose: true });
  }
  const result = resolveCodexReasoningEffort(argv, { catalogue, maxEffort });
  if (log) await log(`Codex reasoning effort: ${result.reasoningEffort ?? 'model default'} (${result.source})`, { verbose: true });
  return result;
};
