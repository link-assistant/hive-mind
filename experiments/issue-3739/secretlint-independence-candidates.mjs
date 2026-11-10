// Finite synthetic candidates; only boolean/count results are printed.
import { sanitizeCredentialText } from '../../src/credential-sanitization-core.lib.mjs';
import { detectSecretsWithSecretlint } from '../../src/token-sanitization.lib.mjs';
const candidates = {
  shopify: `shpat_synthetic${'0'.repeat(23)}`,
  notion: `ntn_${'a'.repeat(46)}`,
  linear: `lin_api_${'a'.repeat(40)}`,
  cloudflare: `CLOUDFLARE_API_TOKEN=${'a'.repeat(40)}`,
  tailscale: `tskey-api-${'a'.repeat(20)}-${'a'.repeat(32)}`,
  figma: `figd_${'a'.repeat(40)}`,
  onepassword: `ops_${'a'.repeat(43)}`,
  vercel: `vcp_${'a'.repeat(24)}`,
  vault: `hvs.${'a'.repeat(24)}`,
  databricks: `dapi${'a'.repeat(32)}`,
};
for (const [name, value] of Object.entries(candidates)) {
  const text = `rotating store credential ${value} for storefront sync`;
  console.log(JSON.stringify({ name, coreChanged: sanitizeCredentialText(text, { includeEnvironmentCredentials: false }) !== text, secretlintFindings: (await detectSecretsWithSecretlint(text, { required: true })).length }));
}
