# मॉडल-विशिष्ट व्यवहार

हर मॉडल — Formal AI हो या कोई LLM, किसी भी `--tool` के साथ — prompt, system prompt, restart feedback, draft/ready बदलाव, loop breakers, विफलता वर्गीकरण और pull request body के लिए एक ही code path से गुज़रता है ([#2319](https://github.com/link-assistant/hive-mind/issues/2319))। खाली diff वाला session किसी भी मॉडल के लिए विफल session है: pull request draft में रहता है और restart loop feedback के साथ फिर से प्रयास करता है।

मॉडल-विशिष्ट व्यवहार अब केवल नीचे की तालिका तक सीमित है। `git grep -c isFormalAiModel -- src` ठीक इन्हीं फ़ाइलों को दिखाता है।

| व्यवहार                       | कहाँ                                                                                                                                  | यह सामान्य क्यों नहीं हो सकता                                                                                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint और credential wiring | `formal-ai.lib.mjs`, `formal-ai-sidecar.lib.mjs`, `solve.validation.lib.mjs`, `agent.lib.mjs` (न्यूनतम agent संस्करण)                 | Formal AI को `formal-ai serve` चलाता है, tool का vendor नहीं: हर tool को उसी endpoint पर भेजना होता है, और vendor login से auth विफलता ठीक नहीं होती।                                                                              |
| Tool संगतता                   | `models/index.mjs`, `formal-ai-model.lib.mjs`                                                                                         | Formal AI एक ही मॉडल है जिसे हर tool चला सकता है; vendor मॉडल केवल अपने tools में चलते हैं।                                                                                                                                        |
| संस्करण और provenance पंक्ति  | `session-runtime-provenance.lib.mjs`                                                                                                  | Session log, tool संस्करण की तरह Formal AI backend का संस्करण भी दर्ज करता है, ताकि विफलता को किसी release से जोड़ा जा सके।                                                                                                        |
| Attribution trailers          | `formal-ai-attribution.lib.mjs`                                                                                                       | `--attribution auto` Formal AI runs के लिए Formal AI commit trailers और evidence चालू करता है ([#2230](https://github.com/link-assistant/hive-mind/issues/2230))।                                                                  |
| मूल्य डेटा                    | `formal-ai-pricing.lib.mjs`, `agent.lib.mjs`, `codex.lib.mjs`, `gemini.lib.mjs`, `qwen.lib.mjs`, `anthropic-cost-accumulator.lib.mjs` | Formal AI मुफ़्त है। Tool जो लागत बताता है, वह उस मॉडल की vendor कीमत है जो चला ही नहीं, इसलिए उसे अनदेखा किया जाता है। सार्वजनिक अनुमान एक बार दिखाया जाता है ([#2318](https://github.com/link-assistant/hive-mind/issues/2318))। |

## हटाए गए अंतर

| पहले का Formal AI path                                              | अब                                                                                                                                                                       |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| बदला हुआ prompt और खाली system prompt (`formal-ai-prompt.lib.mjs`)  | हर मॉडल जैसा ही prompt ([#2313](https://github.com/link-assistant/hive-mind/issues/2313))                                                                                |
| Formal AI के लिए Playwright MCP छोड़ा जाता था                       | हर मॉडल के लिए एक ही default। Repeated-tool-call breaker किसी भी adapter के लिए browser loop रोकता है ([#2316](https://github.com/link-assistant/hive-mind/issues/2316)) |
| `classifyFormalAiToolResult` द्वारा `planned_not_executed` को बदलना | सामान्य अनुबंध: खाली diff होने पर PR draft में रहता है और feedback के साथ restart होता है ([#2312](https://github.com/link-assistant/hive-mind/issues/2312))             |
| केवल Formal AI के लिए repeated-call breaker                         | हर adapter के लिए एक breaker ([#2316](https://github.com/link-assistant/hive-mind/issues/2316))                                                                          |

## End-to-end जाँच

`.github/workflows/e2e-hello-world-matrix.yml` (मैनुअल `workflow_dispatch`) एक नए Hello World task पर `solve` चलाता है: `--tool claude`, `agent` और `codex` के साथ `--model formal-ai`, और नियंत्रण के रूप में एक LLM मॉडल। हर पंक्ति के लिए यह नीचे की सभी बातें जाँचता है:

- pull request review के लिए तैयार है;
- diff में केवल program, workflow और एक test script है;
- program ठीक `Hello, World!` छापता है;
- workflow हरा है;
- body में agent का पूरा किया गया विवरण है;
- कोई `🛑 Automation stopped` टिप्पणी नहीं है।

ये जाँचें `scripts/e2e-hello-world.lib.mjs` में हैं और `tests/e2e-hello-world-matrix-2319.test.mjs` उनकी unit testing करता है।

इस workflow को secret `E2E_GITHUB_TOKEN` चाहिए, जो test user का ऐसा token होना चाहिए जो repositories बना सके। चलाने के बाद बनाई गई repositories को `cleanup-test-repos.yml` से हटा दें।
