---
name: dash
description: Hand coding work to Dash, which runs Claude Code tasks in their own git worktrees across the user's code projects. Use when the user asks to have something built, fixed or reviewed in one of their repositories, to check on a Dash task, or mentions Dash.
---

# Dash

Dash is a desktop app on this machine that runs Claude Code across the user's code projects, each
task in its own git worktree and branch. You don't write the code yourself: you start a Dash task
with a clear prompt, and the person watches and steers it in Dash.

`dashctl` is on your `PATH`. Run `dashctl help` for every command, and
`dashctl <namespace> <verb> --help` for one command's flags. Results are JSON; a refusal goes to
stderr with a non-zero exit.

## Starting work

```sh
dashctl projects list                        # the projects, with their names and paths
dashctl tasks create "Fix the flaky login test" --project dash --prompt - <<'PROMPT'
The login test fails about one run in five on CI. Find out why and fix it.
Keep the fix small; don't touch the session code.
PROMPT
```

- `--project` takes a project's name, path or id.
- `--prompt -` reads the prompt from stdin; without `--prompt` the task starts with none. Write it
  as you would brief a colleague who hasn't seen this conversation, with what's done, what isn't,
  and any links or note paths.
- Check the `session` in the answer. `started`: tell the user the task's name and that it runs in
  Dash. `needs-trust`: Claude Code wants the project's folder trusted first, which only a person can
  accept; ask the user to accept the trust prompt in the task in Dash (`dashctl tasks open
  <task-id>` brings it up). The task starts once they do.

## Following a task

```sh
dashctl tasks list --project dash
dashctl tasks wait <task-id> --until idle --timeout-sec 100   # call again if timedOut
dashctl tasks output <task-id> --lines 80                     # what its terminal shows
dashctl tasks open <task-id>                                  # bring it up in Dash for the person
```

`--until` is `idle`, `waiting` (on a person), `not-working` or `change`. Prefer telling the user
the task is running over waiting on it for long.

## When it fails

- "Dash is not running": ask the user to open Dash.
- "turn on "Let other agents control Dash"": ask the user to switch it on in Dash's settings
  (Settings → Claude → Behavior). Nothing else is needed.
- A usage error prints the command's line; fix the flags and run it again.

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
that you called it from a Holi vault, the Dash version (ask the user: Settings → About in Dash),
and `claude --version`.
