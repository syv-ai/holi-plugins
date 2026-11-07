---
name: dash
description: Hand coding work to Dash, which runs Claude Code tasks in their own git worktrees across the user's code projects. Use when the user asks to have something built, fixed or reviewed in one of their repositories, to check on or talk to a Dash task, or mentions Dash.
---

# Dash

Dash is a desktop app on this machine that runs Claude Code across the user's code projects. You
don't write the code yourself: you start a Dash task with a clear prompt, follow it, talk to it
when needed, and the person watches and steers it in Dash.

## How Dash works

- **A project** is a git repository the user has opened in Dash. `dashctl projects list` gives
  each one's name and path, which is how you tell which project a repository is.
- **A task** is one piece of work in a project. By default it gets its own git worktree on a new
  branch, so tasks run side by side without touching each other or the user's own checkout.
- **A task's session** is a Claude Code background session, run by Claude Code's supervisor, not
  by Dash. It keeps running when Dash's window closes, and Claude Code puts it to sleep after
  about an hour idle. A task's state is one of `idle`, `working`, `waiting` (on a person),
  `error`, `stopped` or `needs-trust`.
- **You are the orchestrator.** You reach Dash from outside it. The agent inside the task has its
  own Dash skill for what it does there, such as drafting PR reviews and running its dev servers.
  Those are not yours to do.

## The commands

You reach Dash with `dashctl`, which is on your `PATH`. Its commands belong to the running Dash, so
this skill doesn't list their flags: `dashctl help` lists every command, and
`dashctl <namespace> <verb> --help` gives one command's flags. Read a command's `--help` before
its first use in a session. Results are JSON on stdout; a refusal goes to stderr with a non-zero
exit, and a usage error prints the command's line.

## Handing over work

- **Find the project** in `dashctl projects list`. If the repository isn't there, ask the user to
  open it in Dash; you can't add one.
- **Start a task** with `dashctl tasks create`. A flag given as `-` reads its value from stdin,
  which is how a prompt of several lines goes in. `--help` covers the choices that matter:
  - **Where it runs:** a new branch (the default), an existing branch, or in place in the
    project's own folder. Prefer the default unless the user asked for a branch.
  - **Pushing:** a new branch is not pushed unless you ask. Leave it off unless the user wants it
    on the remote.
  - **Permissions:** a task created by an agent never runs with permission prompts off.
- **Write the prompt** as you would brief a colleague who hasn't seen this conversation: what the
  work is, what's done, what isn't, and what "done" means. Put in the links it needs, such as the
  GitHub issue's URL or a note's content, since the task can't read this vault. Dash adds one line
  before your prompt, telling the task it may run unattended and should answer messages with
  `SendMessage`.
- **Check the answer.** `started`: tell the user the task's name and that it runs in Dash.
  `needs-trust`: Claude Code wants the project's folder trusted, which only a person can accept;
  ask the user to accept it in Dash (`dashctl tasks open` brings the task up). The task starts once
  they do.

## Following a task

- **Wait in rounds.** `dashctl tasks wait` returns after at most 110 seconds, with `timedOut: true`
  if nothing happened; call it again to keep waiting. Prefer telling the user a task is running
  over waiting on it for long.
- **See what it's doing** with `dashctl tasks output`, the last lines of its terminal.
- **See what it changed.** `dashctl tasks get` gives the task's branch and worktree path. Read the
  changes there with git (`git -C <worktree> log`, `diff`) and leave the worktree as it is: the task
  works in it.
- **Hand it to the person** with `dashctl tasks open`, which brings Dash to the front on the task.
  Do that when it waits on a person, or when the user wants to look.

## Talking to a task

Dash doesn't carry messages; Claude Code's own `SendMessage` does.

1. `dashctl tasks wake <task-id>` makes sure the task's session runs and returns its
   `messageAddress`. It returns at once if the session is up, otherwise it starts it, with no
   message.
2. `SendMessage` to that address. The task answers you the same way, so stay in this session
   until the answer comes: a session that has ended can't receive it.
3. If the task's `messaging` is `needs-approval`, it runs with permission prompts off, so your
   message waits until a person clicks Deliver in the task's pane in Dash. Tell the user.
4. `ENOENT` means the session stopped and its address is gone: `wake` it again for a new one.

`wake` is refused while the task needs trust or is archived. If you have no `SendMessage`, you
can't talk to a task: tell the user to message it in Dash.

## Finishing

- **Pushing and opening a PR** are not `dashctl` commands: the person does them, in Dash or with
  git, unless you pushed the branch when creating the task.
- **Archive** a task the user is done with (`dashctl tasks archive`): its session sleeps and its
  worktree stays, and it can be restored.
- **Delete** only when the user asks for it. It removes the session and the worktree for good,
  and with `--delete-branch` also the branch Dash created, on the remote too.

## When it fails

- "Dash is not running": ask the user to open Dash.
- "turn on "Let other agents control Dash"": ask the user to switch it on in Dash
  (Settings → Claude → Behavior). Nothing else is needed.

## Feedback about Dash

When you miss something in `dashctl` or Dash, or the user has something to say about Dash itself,
draft a GitHub issue on https://github.com/syv-ai/dash and show it to the user first. The
repository is public: nothing from the vault goes in it.

`kind` is one of `Something is missing`, `Something is broken`,
`A skill or instruction is unclear or wrong`, `Other`. In `context`, name the command involved,
that you called it from a Holi vault, `dashctl version` and `claude --version`.

Then one of two ways:

- **A link the user submits (the default).** Give the user this link with each value
  percent-encoded, so the **Agent feedback** form opens filled in:

  ```
  https://github.com/syv-ai/dash/issues/new?template=agent-feedback.yml&title=<title>&kind=<kind>&feedback=<feedback>&context=<context>
  ```

- **`gh`, when the user asks you to file it.** Only if `gh auth status` succeeds, and only after
  the user has approved the text:

  ```sh
  gh issue create -R syv-ai/dash --label agent-feedback --title '<title>' --body-file <draft.md>
  ```
