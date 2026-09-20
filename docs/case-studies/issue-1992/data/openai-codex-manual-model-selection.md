### Model selection

Source: [Codex Models](/codex/models.md)

#### Recommended models

For most tasks in Codex, start with
`gpt-5.5`. It is
strongest for complex coding, computer use, knowledge work, and research
workflows. GPT-5.5 is currently available in Codex when you sign in with
ChatGPT or API-key authentication. Use
`gpt-5.4-mini`
when you want a faster, lower-cost option for lighter coding tasks or
subagents. The `gpt-5.3-codex-spark` model is available in research preview
for ChatGPT Pro subscribers and is optimized for near-instant, real-time
coding iteration.

#### Other models

When you sign in with ChatGPT, Codex works best with the recommended models listed above.

You can also point Codex at any model and provider that supports either the [Chat Completions](https://platform.openai.com/docs/api-reference/chat) or [Responses APIs](https://platform.openai.com/docs/api-reference/responses) to fit your specific use case.

Support for the Chat Completions API is deprecated and will be removed in
future releases of Codex.

#### Deprecated Codex models

The `gpt-5.2` and `gpt-5.3-codex` models are deprecated in Codex when you sign in with ChatGPT. If your scripts, configuration files, or `codex exec --model` commands still reference deprecated models, update them to the latest model listed above.

Some models that are deprecated for ChatGPT sign-in may still be available in the API. If your workflow depends on one of those models, use API-key authentication and check the [API models page](/api/docs/models) for current availability.

#### Configuring models

#### Configure your default local model

The Codex CLI and IDE extension use the same `config.toml` [configuration file](/codex/config-basic). To specify a model, add a `model` entry to your configuration file. If you don't specify a model, the Codex app, CLI, or IDE Extension defaults to a recommended model.

```toml
model = "gpt-5.5"
```

#### Choosing a different local model temporarily

In the Codex CLI, you can use the `/model` command during an active thread to change the model. In the IDE extension, you can use the model selector below the input box to choose your model.

To start a new Codex CLI thread with a specific model or to specify the model for `codex exec` you can use the `--model`/`-m` flag:

```bash
codex -m gpt-5.5
```

#### Choosing your model for cloud tasks

Currently, you can't change the default model for Codex cloud tasks.
