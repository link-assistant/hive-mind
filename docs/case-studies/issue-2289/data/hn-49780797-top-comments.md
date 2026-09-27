# Hacker News item 49780797: AX – Google’s Open Agentic Orchestrator

URL: https://news.ycombinator.com/item?id=49780797 — 666 points, submitted 2026-09-20T22:32:43.000Z.
Fetched from https://hn.algolia.com/api/v1/items/49780797 on 2026-09-27. Top-level comments ranked by number of direct replies; text truncated to 500 characters.

## sigbottle (2026-09-21, 20 direct replies)

> Could someone explain to me what the general workflow is now that people are converging to? I haven't really been catching up with the AI ecosystem but I was looking into agent sandboxes and VM's recently and there's a ton of these startups and tools now. Is giving the agent a temporary scratchbox really that valuable? I've been still just like, making VM's with proxmox, then putting my agent in the machine and letting it run free (with my dotfiles setup script making dev env pretty much free, t…

## alembic_fumes (2026-09-21, 10 direct replies)

> So on one hand the page says > We want to make dealing with agentic infrastructure easier so you can focus on your work. AX is designed with an uncompromising focus on ergonomics, rapid iteration, and joyful workflows for both application developers and AI researchers. On the the other hand, the readme quickstart section says > You need a Kubernetes cluster, ko (brew install ko), a container registry your cluster can pull from, and a reachable Agent Substrate Control API (in-cluster default: api…

## Mond_ (2026-09-20, 8 direct replies)

> The reality with releases like this is that I'm 90% sure most Google bigwigs have never heard of it, and it's misleading to label it as "Google's" in the title. Yes, it was developed by Google employees, that does not imply it has the full backing of Google, or Deepmind, or GCP. Notably, the website doesn't seem to claim this either.

## mcoliver (2026-09-21, 8 direct replies)

> I have been happy with Google's Antigravity harness and Jules so looking forward to playing with this. Thanks for sharing. Simultaneously I am looking to also revisit local offline models. While I feel like I have a decent understanding of the model landscape I'm feeling a bit lost at which agentic harness to leverage for local models. Hermes, Cline, Aider, Qwen Code, Goose, Pi, OpenCode, something else? I live in the terminal so Desktop UX is a bonus but not a must have. Can I modify the antigr…

## srcreigh (2026-09-21, 5 direct replies)

> So the agent-substrate checks a _ton_ of boxes. Almost all of the things it offers should be table stakes for everywhere we run not only agents but most software. https://github.com/agent-substrate/substrate (For context I built something very similar to this the past 2 weeks for my homelab, trying to solve many of these problems. This comment is an edited version of an unreleased blog post I wrote last week.) - Run code in secure microVMs or gVisor. Docker is not good enough. Qemu is not good e…

## weedfroglozenge (2026-09-21, 5 direct replies)

> Nobody has a use for this, and anybody who can look at this website and work out what it's for is kidding themselves. Even the demo gif playing just has them pausing a task and resuming the task.

## aleksandrm (2026-09-21, 5 direct replies)

> I looked at the website, and I still don't understand the purpose.

## jmathai (2026-09-20, 4 direct replies)

> I'm not sure why, exactly. But I don't pay any attention to news like this from Google. I don't know if there's some marketing which has me writing them off or if it's something else. What I do know is that the Gemini integration into sheets is surprisingly incapable of performing basic tasks. This is where I expect Google to really shine. I expected Sheets + Gemini to be magical like Google Photos was. I hardly try anymore besides some basic math questions when I don't feel like inputting the f…

## kundi (2026-09-20, 4 direct replies)

> Why kubernetes? Seems like an overload

## TomGarden (2026-09-20, 3 direct replies)

> Question: What is Google's track record for where their open source releases end up over time? Genuinely not knowledgeable here

## DanMcInerney (2026-09-20, 3 direct replies)

> I really don't think any of these SOTA labs are doing agentic engineering correctly. Skills are the universal language of all agent harnesses. If you abstract the taste and prescription out of the skills and into guidance docs, then leave the skills as basically just workflow scaffolding, you can build task-specific workflows that work with any harness like Claude Code, Codex, Antigravity, etc. Technically, you only really need 2 skills, work and review, and with these you can build infinitely c…

## anentropic (2026-09-21, 3 direct replies)

> Is the logo a cheerful little parasitic skin mite?

## jauntywundrkind (2026-09-20, 2 direct replies)

> I'd evaluated both Google's Agent Substrate (that underlies Ax) and their Scion project. I really enjoy how Scion operates with existing tools really well. Ax/Agent Substrate is much more a greenfield independent effort, it's own thing. I think Scion has so much more mature a disosition: you could write OpenCode plugins that enhance the runner, and use that locally, and use it in Scion. With Ax/Agent Substrate, you are opting in to a pretty huge stack that is just Agent Substrate, that is their …

## nullbio (2026-09-21, 2 direct replies)

> People can afford to run billions of concurrent agents?

## dmix (2026-09-21, 2 direct replies)

> > Task declares the container image and command, compute requests and limits, environment variables [...] Declares listeners the task exposes and an egress allowlist of hosts and ports the sandbox may reach. Use it to restrict an agent to, say, your LLM provider and your Git host. I'm planning to buy a whole linux mini-PC to run my agents/code servers for more isolation. Codex/Claude Code let you run prompts on code over ssh (same with most IDEs) even on the desktop apps. I wonder if that's goin…

## Mizza (2026-09-20, 1 direct replies)

> k8sification of AI was always inevitable, if only as a form of salary justification.

## pianopatrick (2026-09-20, 1 direct replies)

> I can understand why it was chosen, but I'm not a fan of writing a bunch of yaml.

## mentalgear (2026-09-20, 1 direct replies)

> I don't see a meaningful difference to the 100s of other 'agentic frameworks' that promise to be the one to all solution for all your troubles. Would be about time we get benchmarks for these ... so these can also be gamified just like with the LLMs.

## guluarte (2026-09-20, 1 direct replies)

> I just have a tmux session acting as the orchestrator, and I tell it to report back and direct the other agents working in separate tmux sessions.

## prng2021 (2026-09-21, 1 direct replies)

> Can someone clarify the use case for this? What's the benefit over this: https://openai.com/index/introducing-the-agents-api/

