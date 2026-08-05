# @link-assistant/agent v0.25.5 — verbatim excerpts

## src/cli/event-handler.js (stdin-stream path used by Hive Mind's agent tool)
```js

    if (part.type === 'tool') {
      eventHandler.output({
        type: 'tool_use',
        timestamp: Date.now(),
        sessionID,
        part,
      });

      // If tool failed, also output an error event
      if (part.state?.status === 'error') {
        eventHandler.output({
          type: 'error',
          timestamp: Date.now(),
          sessionID,
          error: part.state.error || 'Tool execution failed',
        });
      }
    }
    onIdle?.();
  }

  // Handle errors
  if (event.type === 'session.error') {
    const props = event.properties;
    if (props.sessionID !== sessionID || !props.error) {
      return;
    }
    onError();
    eventHandler.output({
      type: 'error',
      timestamp: Date.now(),
      sessionID,
      error: props.error,
    });
  }
```

## src/cli/cmd/run.ts (agent run path)
```ts

          if (event.type === 'session.error') {
            const props = event.properties;
            if (props.sessionID !== sessionID || !props.error) continue;
            let err = String(props.error.name);
            if (
              'data' in props.error &&
              props.error.data &&
              'message' in props.error.data
            ) {
              err = String(props.error.data.message);
            }
            errorMsg = errorMsg ? errorMsg + EOL + err : err;
            if (outputJsonEvent('error', { error: props.error })) continue;
            UI.error(err);
          }

```

## src/util/error.ts — NamedError.toObject()
```ts
import z from 'zod';

export abstract class NamedError extends Error {
  abstract schema(): z.core.$ZodType;
  abstract toObject(): { name: string; data: any };

  static create<Name extends string, Data extends z.core.$ZodType>(
    name: Name,
    data: Data
  ) {
    const schema = z
      .object({
        name: z.literal(name),
        data,
      })
      .meta({
        ref: name,
      });
    const result = class extends NamedError {
      public static readonly Schema = schema;

      public override readonly name = name as Name;

      constructor(
        public readonly data: z.input<Data>,
        options?: ErrorOptions
      ) {
        super(name, options);
        this.name = name;
      }

      static isInstance(input: any): input is InstanceType<typeof result> {
        return (
          typeof input === 'object' && 'name' in input && input.name === name
        );
      }

      schema() {
        return schema;
      }

      toObject() {
        return {
          name: name,
          data: this.data,
        };
      }
    };
    Object.defineProperty(result, 'name', { value: name });
    return result;
  }

  public static readonly Unknown = NamedError.create(
    'UnknownError',
    z.object({
      message: z.string(),
    })
  );
}
```

## src/session/processor.ts — Session.Event.Error publishers
```ts
                  // Create a specific error for this case
                  input.assistantMessage.error = {
                    name: 'RetryTimeoutExceededError',
                    data: {
                      message: delayError.message,
                      isRetryable: false,
                      retryAfterMs: delayError.retryAfterMs,
                      maxTimeoutMs: delayError.maxTimeoutMs,
                    },
                  } as MessageV2.Error;
                  Bus.publish(Session.Event.Error, {
                    sessionID: input.assistantMessage.sessionID,
                    error: input.assistantMessage.error,
                  });
                  break;
                }
                    'Try a different model or check the provider status. Use --model <provider>/<model-id> to specify an alternative.',
                  issue: 'https://github.com/link-assistant/agent/issues/208',
                }));
              }
            }

            input.assistantMessage.error = error;
            Bus.publish(Session.Event.Error, {
              sessionID: input.assistantMessage.sessionID,
              error: input.assistantMessage.error,
            });
          }
          const p = await MessageV2.parts(input.assistantMessage.id);
```
