---
name: dash
description: Hand coding work to Dash, which runs Claude Code tasks in their own git worktrees across the user's code projects. Use when the user asks to have something built, fixed or reviewed in one of their repositories, to check on a Dash task, or mentions Dash.
---

# Dash

Dash is a desktop app on this machine that runs Claude Code across the user's code projects, each
task in its own git worktree and branch. You don't write the code yourself: you start a Dash task
with a clear prompt, and the person watches and steers it in Dash.

You reach Dash with `dashctl`, which is on your `PATH`. Its commands belong to the running Dash, so
this skill doesn't list them: `dashctl help` does, and `dashctl <namespace> <verb> --help` gives one
command's flags. Results are JSON; a refusal goes to stderr with a non-zero exit, and a usage error
prints the command's line.

## Before the first command

Run `dashctl version`. If it answers with a version, go on. If it says there is no such command,
this Dash is older than this skill: ask the user to update Dash, and don't guess at its commands.

## Handing over work

- Find the project with `dashctl projects list`, then start a task with `dashctl tasks create`. A
  flag given as `-` reads its value from stdin, which is how a prompt of several lines goes in.
- Write the prompt as you would brief a colleague who hasn't seen this conversation: what's done,
  what isn't, and any links or note paths.
- The answer says whether the task's session started. If it needs trust, Claude Code wants the
  project's folder trusted first, which only a person can accept: ask the user to accept it in
  Dash (`dashctl tasks open` brings the task up). Otherwise tell the user the task's name and that
  it runs in Dash.
- Prefer telling the user a task is running over waiting on it for long.

## When it fails

- "Dash is not running": ask the user to open Dash.
- "turn on "Let other agents control Dash"": ask the user to switch it on in Dash
  (Settings → Claude → Behavior). Nothing else is needed.

## Feedback about Dash

When you miss something in `dashctl` or Dash, or the user has something to say about Dash itself,
draft a GitHub issue on https://github.com/syv-ai/dash and show it to the user first. The
repository is public: nothing from the vault goes in it. Give the user this link with each value
percent-encoded, so the **Agent feedback** form opens filled in for them to submit:

```
https://github.com/syv-ai/dash/issues/new?template=agent-feedback.yml&title=<title>&kind=<kind>&feedback=<feedback>&context=<context>
```

`kind` is one of `Something is missing`, `Something is broken`,
`A skill or instruction is unclear or wrong`, `Other`. In `context`, name the command involved,
that you called it from a Holi vault, `dashctl version` and `claude --version`.
