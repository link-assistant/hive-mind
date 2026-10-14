"""One-off helper (#3215): annotate the deliberate `no-await-in-loop` sites
listed by `npm run lint` (file:line per row in the sites file)."""
import sys, collections
sites = collections.defaultdict(list)
for row in open(sys.argv[1]):
    f, l = row.strip().rsplit(':', 1)
    sites[f].append(int(l))

FILE_LEVEL = {
    'src/telegram-merge-queue.lib.mjs': 'the merge queue handles one pull request at a time and polls GitHub between steps',
    'src/telegram-solve-queue.lib.mjs': 'the consumer polls on an interval and edits queue messages one at a time under the Telegram rate limit',
    'src/bot-logger.lib.mjs': 'log lines reach the file in order, one append at a time',
    'src/telegram-safe-reply.lib.mjs': 'message chunks are sent in order',
    'src/telegram-merge-branch-gate.lib.mjs': 'each round waits for target-branch CI before re-checking it',
    'src/telegram-accept-invitations.lib.mjs': 'invitations are accepted one at a time so the progress message counts up and GitHub is not flooded',
    'src/telegram-rate-limit.lib.mjs': 'the governor waits before each retry by design',
    'src/telegram-merge-wait.lib.mjs': 'a poll loop: wait, then check again',
    'src/telegram-bot-launcher.lib.mjs': 'launch attempts are retried one after another with a delay',
}
LINE_LEVEL = {
    'src/telegram-bot.mjs': 'startup validation and owner DMs run one chat at a time; neither is on the update path',
    'src/telegram-models-command.lib.mjs': 'one catalogue reply per tool, in the order asked',
    'src/telegram-subscribers.lib.mjs': 'subscribers are notified one at a time under the Telegram rate limit',
    'src/telegram-command-args.lib.mjs': 'stops at the first invalid --model',
    'src/telegram-terminal-watch-command.lib.mjs': 'a short retry while the session registers',
    'src/telegram-tokens-command.lib.mjs': 'stops at the first chat the user owns',
    'src/telegram-solve-queue-command.lib.mjs': 'status chunks are sent in order',
    'src/telegram-auth-command.lib.mjs': 'stops at the first chat the user owns',
}
for f, lines in sites.items():
    src = open(f).read().split('\n')
    if f in FILE_LEVEL:
        at = 1 if src[0].startswith('#!') else 0
        src.insert(at, f'/* eslint-disable no-await-in-loop -- {FILE_LEVEL[f]} */')
    elif f in LINE_LEVEL:
        for l in sorted(set(lines), reverse=True):
            line = src[l - 1]
            indent = line[: len(line) - len(line.lstrip())]
            src.insert(l - 1, f'{indent}// eslint-disable-next-line no-await-in-loop -- {LINE_LEVEL[f]}')
    else:
        raise SystemExit(f'no reason for {f}')
    open(f, 'w').write('\n'.join(src))
