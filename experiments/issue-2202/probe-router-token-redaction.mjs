import { fetchRouterCatalogue, fetchRouterCatalogueViaExec } from '../../src/model-catalogue-fetch.lib.mjs';
import { ROUTER_ROUTE_DIALECTS } from '../../src/router-routes.lib.mjs';

const token = 'router-lease-token-abcdef123456';
const run = async (file, args) => {
  const error = new Error(`Command failed: ${file} ${args.join(' ')}\nError response from daemon: No such container`);
  error.stderr = 'Error response from daemon: No such container';
  error.code = 1;
  throw error;
};
console.log('dialects:', JSON.stringify(ROUTER_ROUTE_DIALECTS));
try {
  await fetchRouterCatalogueViaExec({ url: 'https://link-assistant-router/v1/models', token, run });
} catch (error) {
  console.log('viaExec message:', error.message);
}
for (const dialect of Object.values(ROUTER_ROUTE_DIALECTS)) {
  const result = await fetchRouterCatalogue({ baseUrl: 'https://link-assistant-router', dialect, token, tool: 'claude', transport: 'exec', run });
  console.log(dialect, '->', JSON.stringify(result));
}
