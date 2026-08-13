# Credential sanitization

Hive Mind generated terminal output, logs, error reports, development-log artifacts और GitHub mutations को संभावित credential-bearing content मानता है।

यह control Hive Mind के अपने output paths से accidental disclosure कम करता है। यह autonomous agent या internet-connected host को सुरक्षित नहीं बनाता: agent अभी भी data access कर सकता है और इन sinks के बाहर के channels से communicate कर सकता है। Isolated environment में short-lived, least-privilege credentials उपयोग करें और हर संभावित exposed credential को rotate करें।

## Contract

सभी maintained sinks `src/token-sanitization.lib.mjs` के sanitizer का उपयोग करते हैं।

- 12 characters से लंबे values में ठीक पहले और अंतिम तीन characters रहते हैं: `abc…xyz`।
- 12 characters या कम के values `[REDACTED]` बन जाते हैं।
- असंबंधित text और structural context जहाँ संभव हो सुरक्षित रहते हैं।
- एक line पर मौजूद अनेक values सहित credential की हर occurrence sanitize होती है।
- Terminal stdout/stderr record buffer उपयोग करता है, इसलिए child-process chunks में बँटा credential scan होने से पहले emit नहीं होता।
- Credential की encoded copies भी plain की तरह sanitize होती हैं, और masking contract encoding के आर-पार बना रहता है। देखें [Encoded credentials](#encoded-credentials)।
- GitHub comments, PR/issue bodies और titles, releases, log uploads, gists, development-log repository copies और Sentry payloads exact outbound boundary पर scan होते हैं।
- Publication fail-closed है। Maintained scanner, Secretlint या residual scan विफल होने पर external mutation `ERR_CREDENTIAL_SANITIZATION` के साथ block होती है।
- Temporary publication files और local audit sources केवल owner-readable (`0600`) होते हैं; temporary upload directories `0700` होते हैं।
- `--development-log` raw local audit sources को unchanged रखता है और केवल sanitized copies stage करता है।

Dependency-free synchronous core terminal और local log paths की सुरक्षा करता है। Publication boundaries इसके बाद core, known-active-token matching, Secretlint और residual rescan चलाते हैं। Dangerous local-output compatibility switches publication boundaries को bypass नहीं करते।

## Covered forms

Maintained patterns ये cover करते हैं:

- GitHub, GitLab, OpenAI, Anthropic, AWS, Google/GCP, Azure, Slack, Discord, Telegram, Stripe, Twilio, SendGrid, npm, PyPI, Docker और common CI credential formats;
- OAuth access/refresh tokens, JWT/JWS tokens, webhook URLs, HTTP Authorization headers और Cookie/Set-Cookie values;
- JSON, YAML, TOML, INI, XML, environment/shell assignments, CLI flags, sensitive query parameters, connection-string passwords और PEM private keys;
- active credential environment variables और local GitHub authentication से मिले exact values।

External boundaries पर detection जानबूझकर conservative है। False positive credential-जैसे value को mask कर सकता है; scanner failure original bytes भेजने के बजाय publication block करता है।

Implementation review ने Gitleaks और detect-secrets जैसे external scanners की तुलना project के existing Secretlint integration से की। Secretlint publication scanner बना रहता है क्योंकि उसका maintained rule set Node.js process में बिना Go या Python runtime dependency जोड़े चलता है। Synchronous maintained rules उन terminal paths को cover करते हैं जहाँ asynchronous scanner नहीं चल सकता, जबकि Secretlint और residual rescan independent publication check देते हैं।

## Encoded credentials

Pattern scanner उन्हीं bytes से match करता है जो उसे दिए जाते हैं, इसलिए जो credential log में केवल encoded रूप में पहुँचता है वह हर surface-text rule के लिए एक साथ अदृश्य रहता है। यह कोई काल्पनिक evasion नहीं है: सामान्य tooling बिना कुछ छिपाने के इरादे के लगातार encode करती है, और issue [#2156](https://github.com/link-assistant/hive-mind/issues/2156) ठीक इसी वजह से हुआ leak है — registry के token endpoint ने दिए गए credential को base64-encoded रूप में JSON body के अंदर वापस लौटा दिया, वह log हुआ, publish हुआ, और GitHub के scanner ने उसे revoke कर दिया। पूरा विश्लेषण [case study](./case-studies/issue-2156/README.md) में है।

इसलिए `src/encoded-credential-detection.lib.mjs` match करने से पहले decode करता है:

- Bounded base64, base64url, hex, percent-encoded, byte-escape और HTML-entity runs decode होते हैं, और decoded text पर plaintext rules चलते हैं।
- Base64 तीनों byte alignments पर पढ़ा जाता है, इसलिए किसी बड़े blob के बीच में बैठा credential भी मिल जाता है। Line-wrapped blobs को केवल base64 वाली lines के लगातार groups के रूप में scan किया जाता है, क्योंकि हर common wrapper output को fold करता है (MIME के लिए 76 columns, PEM के लिए 64) और folded blob में match करने योग्य कोई single-line run बचता ही नहीं।
- Masked payload फिर से encode होता है और substitution से पहले round trip verify होता है। केवल वही run वापस रखा जाता है जो decode होकर ठीक वही देता है जो publish करना था; अन्यथा पूरा run `[REDACTED]` बन जाता है। यही `abc…xyz` contract को encoding के आर-पार बनाए रखता है: `{"token":"gho_…"}` valid base64 ही रहता है और decode होकर `{"token":"gho…999"}` देता है, इसलिए आसपास की structure और credential के दोनों सिरे पढ़े जा सकते हैं।
- Stream sanitizer अंत में आई केवल-base64 lines के group को तब तक रोके रखता है जब तक ऐसी line न आए जो उस blob का हिस्सा नहीं हो सकती। उन्हें एक-एक करके छोड़ना sanitizer को byte-misaligned slices थमाना होगा।
- Secretlint भी decoded payloads पर चलता है, हर run अलग से scan होता है, और वही decoder walk साझा होता है जो synchronous core उपयोग करता है। Detectors के बीच redundancy इसलिए काम की है कि उनकी vocabulary अलग है — Secretlint ऐसे formats जानता है जो maintained rules में नहीं हैं — पर वह decoder के पीछे रखने पर ही मदद करती है। Incident log पर मापने पर Secretlint का recommended preset पूरे 16.9 MB में शून्य findings देता है; देखें [library survey](./case-studies/issue-2156/data/library-survey-output.txt)।
- User-supplied content के लिए carve-outs surface-level हैं और जानबूझकर decoder से पहले रुक जाते हैं। वे उन literal spans को नाम देते हैं जिन्हें छोड़ना है, और encoded run में वे spans होते ही नहीं, इसलिए caller की exclusion list इस layer में छेद नहीं कर सकती। Encoded blob को ज़रूरत से ज़्यादा redact करने की कीमत log की एक line है; उल्टी गलती की कीमत एक credential है।

Encoded payloads में हुई detections verbose sanitization summary में अलग से, fire हुए rule identifiers के साथ report होती हैं, ताकि इस class की अगली घटना log से ही attribute की जा सके।

## Format जोड़ना या बदलना

1. Vendor के current official security या authentication documentation में format verify करें। किसी live credential को issue, test, log या commit में paste न करें।
2. केवल synthetic examples `tests/test-credential-sanitization-2111.mjs` में जोड़ें। जहाँ लागू हो standalone, structured assignment, multiple-per-line और chunk-split forms cover करें।
3. `src/credential-sanitization-core.lib.mjs` में maintained pattern जोड़ें या बदलें।
4. Focused security tests और default suite चलाएँ:

   ```bash
   node tests/test-credential-sanitization-2111.mjs
   node tests/test-encoded-credential-leak-2156.mjs
   node tests/test-encoded-secretlint-layer-2156.mjs
   node tests/test-require-sanitized-output-rule.mjs
   npm test
   npm run lint
   ```

5. नए outbound sink के लिए `sanitizeForPublication`, `writeSanitizedPublicationFile` या पहले से sanitize करने वाला helper उपयोग करें। ऐसा static-rule test जोड़ें जो unsanitized equivalent को reject करे।
6. Pull request में source, test cases और false-positive tradeoff record करें।

Vendor inventory को कम से कम quarterly और provider के authentication change announce करने पर review करें। उपयोगी primary references में [GitHub authentication overview](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github), [GitLab token guidance](https://docs.gitlab.com/security/tokens/), [AWS IAM identifiers](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html), [Slack token types](https://api.slack.com/concepts/token-types), [Stripe API keys](https://docs.stripe.com/keys), [Twilio API keys](https://www.twilio.com/docs/iam/api-keys), [npm access tokens](https://docs.npmjs.com/about-access-tokens/) और [PyPI secret reporting format](https://docs.pypi.org/api/secrets/) शामिल हैं।

## Incident response

Sanitization revocation नहीं है। यदि real credential terminal capture, repository, GitHub object, upload, telemetry event या किसी external system तक पहुँचा:

1. उसे तुरंत revoke या rotate करें;
2. affected artifact तक access सीमित करें;
3. platform support होने पर exposed value को current content और retained history से हटाएँ;
4. misuse के लिए provider audit logs जाँचें;
5. publication restore करने से पहले missed format या sink के लिए synthetic regression जोड़ें।
