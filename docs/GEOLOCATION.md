# Geolocation privacy

Location sharing is off by default for Claude, Codex, Agent, OpenCode, Gemini,
and Qwen. This applies to `solve`, `hive` workers, `review`, task splitting,
and the optional agent-commander execution adapter.

```bash
solve https://github.com/owner/repo/issues/123
solve https://github.com/owner/repo/issues/123 --share-geolocation
hive https://github.com/owner/repo --share-geolocation
review https://github.com/owner/repo/pull/456 --share-geolocation
task https://github.com/owner/repo/issues/123 --split --split-count 2 --share-geolocation
```

Default runs receive a system instruction to avoid discovering, inferring, or
disclosing the user's or host's location. It covers IP lookup services, GPS and
browser location permissions, timezone/region probes, and location hints in
search or model requests. It asks agents to pass this preference to delegates
and browser/MCP tools. Places explicitly supplied in the task remain usable as
task content; mentioning a city does not authorize discovering the user's city.

Child tools run with `TZ=UTC` to neutralize automatic local timezone context.
Codex additionally receives a per-invocation configuration override that replaces
the four optional search location fields with empty strings. This redacts
inherited country, region, city, and timezone hints without changing search
availability, domain filters, or search context size. Codex still serializes an
`user_location` object with empty location strings; this carries no user or host location. An empty
TOML table alone would retain inherited values because Codex merges tables.

`--share-geolocation` removes these restrictions for that run. The instruction
then permits location use when the task needs it and asks for the minimum
necessary precision. The tool inherits the operator's timezone and native
location configuration. Hive forwarding and solve resumes preserve the choice.
`--no-share-geolocation` explicitly selects the private default. No global tool
configuration or host timezone is changed.

These defaults reduce location disclosure by the clients. They are not an
operating-system permission boundary or an anonymity service. Model and search
providers still see the network connection's IP address and can infer location
from it or from task content. A prompt cannot enforce the behavior of arbitrary
external plugins, malicious instructions, or independently launched programs.
Existing network, browser permission, and provider privacy controls still apply.
Enabling location sharing does not grant a browser permission or configure GPS.

See the [case study](case-studies/issue-4023/README.md) for the tool audit,
alternatives, source references, and reproducible request-capture experiment.
