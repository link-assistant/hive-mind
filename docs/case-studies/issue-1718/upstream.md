# Upstream / third-party considerations

## yargs (`yargs@17.7.2`)

The hive CLI uses yargs to parse the argv passed by the user before it
auto-forwards solve options. For the option

```js
'working-session-live-progress': {
  type: 'string',
  default: false,
}
```

yargs preserves the boolean `false` as the runtime value of
`argv.workingSessionLiveProgress` because the user did not supply the flag.
This is **expected and documented yargs behaviour** — `default` is returned
verbatim if the option is absent. yargs does *not* coerce defaults to the
declared `type`.

There is therefore **no upstream bug to file**. The fix lives entirely in our
forwarder and (optionally, in a future PR) in the option declarations. We
mention this here so future maintainers do not waste time diffing yargs
versions.

## start-command (the `$` wrapper)

The Telegram bot uses `start-command` to spawn `hive` inside `screen`. The
issue's screenshot shows start-command picking up `exitCode 0` and rendering
"Work session finished successfully". start-command is doing exactly what is
expected — relaying the wrapped process' exit code. No change needed there.
Once `hive` itself exits non-zero (SP-1), start-command will automatically
flip the envelope to its failure variant and Telegram will render the
red banner. No upstream report required.
