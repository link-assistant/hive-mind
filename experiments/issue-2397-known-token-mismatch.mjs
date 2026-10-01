// Secondary hazard: env vars that containsKnownToken() treats as secrets but the
// masking passes never mask (name does not match SENSITIVE_ENV_NAME and
// sanitizeOutput's known-token step only uses GitHub tokens).
process.env.TELEGRAM_OWNER_CHAT_ID = '123456789';
const { default: tsl } = await import('../src/token-sanitization.lib.mjs');
for (const text of ['upload size 9123456789 bytes', 'chat id 123456789']) {
  try {
    await tsl.sanitizeForPublication(text);
    console.log('OK  ', text);
  } catch (e) {
    console.log('FAIL', JSON.stringify(text), '| cause:', e.cause?.message, '| known hits:', JSON.stringify(await tsl.containsKnownToken(text)));
  }
}
process.exit(0);
