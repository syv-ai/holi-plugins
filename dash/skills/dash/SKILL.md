---
name: dash
description: Hand coding work to Dash, which runs Claude Code tasks in their own git worktrees across the user's code projects. Use when the user asks to have something built, fixed or reviewed in one of their repositories, to check on or talk to a Dash task, or mentions Dash.
---

# Dash

Dash is a desktop app on this machine that runs Claude Code across the user's code projects. You
don't write the code yourself: you start a Dash task with a clear prompt, follow it, talk to it
when needed, and the person watches and steers it in Dash.

## How Dash works

- **A project** is a folder the user has opened in Dash, usually a git repository.
  `dashctl projects list` gives each one's name and path, which is how you tell which project a
  repository is.
- **A task** is one piece of work in a project. In a git project it gets its own worktree on a new
  branch by default, so tasks run side by side without touching each other or the user's own
  checkout. In a folder that isn't a git repository, a task runs in place, in the folder itself,
  and there's no branch or history (the `branch` a task reports there is only a placeholder).
  Only one active in-place task can use a folder at a time, git or not.
- **A task's session** is a Claude Code background session, run by Claude Code's supervisor, not
  by Dash. It keeps running when Dash's window closes, and Claude Code puts it to sleep after
  about an hour idle. A task's state is one of `idle`, `working`, `waiting` (on a person),
  `error`, `stopped` or `needs-trust`.
- **You are the orchestrator.** You reach Dash from outside it. The agent inside the task has its
  own Dash skill for what it does there, such as drafting PR reviews and running its dev servers.
  Those are not yours to do.

## dashctl, and everything else

`dashctl` is for what only Dash can do: its projects and tasks, and the agents running in them.
Everything else you do yourself, with the tools you already have. A task's worktree is an ordinary
git checkout on this machine, so you can read it with git, `gh` and the files, as anywhere.

**Changing a task's work is the task's job.** Its agent works from what it knows of its worktree,
branch and PR. A commit, push, rebase or PR made behind its back leaves it working from a stale
picture, and the person sees two accounts of the same work. So ask the task to do it, by message.
Do it yourself only when the task can't be reached (see "When a task can't be reached" below), and
then tell the task what you changed, so it isn't surprised the next time it runs.

You reach Dash with `dashctl`, which is on your `PATH`. Its commands belong to the running Dash, so
this skill doesn't list their flags: `dashctl help` lists every command, and
`dashctl <namespace> <verb> --help` gives one command's flags. Read a command's `--help` before
its first use in a session. Results are JSON on stdout; a refusal goes to stderr with a non-zero
exit, and a usage error prints the command's line.

## Handing over work

- **Find the project** in `dashctl projects list`. If the repository isn't there, ask the user to
  open it in Dash. If it isn't on this machine at all, you can clone it for them first.
- **Start a task** with `dashctl tasks create`. A flag given as `-` reads its value from stdin,
  which is how a prompt of several lines goes in. `--help` covers the choices that matter:
  - **Where it runs:** a new branch (the default in a git project), an existing branch, or in
    place in the project's own folder (the only choice in a folder that isn't a git repository).
    Prefer the default unless the user asked for a branch.
  - **Pushing:** a new branch is not pushed unless you ask. Leave it off unless the user wants it
    on the remote.
  - **Permissions:** a task created by an agent never runs with permission prompts off.
- **Write a complete prompt,** as you would brief a colleague who hasn't seen this conversation:
  what the work is, what's done, what isn't, and what "done" means. Put in the links it needs,
  such as the GitHub issue's URL or a note's content, since the task can't read this vault. Dash
  adds one line before your prompt, telling the task it may run unattended, not to ask questions
  (no `AskUserQuestion`) but to state its assumptions, and to answer messages with `SendMessage`.
  So the task won't ask what you left out: it will guess.
- **Check the answer.** `started`: tell the user the task's name and that it runs in Dash.
  `needs-trust`: Claude Code wants the project's folder trusted, which only a person can accept;
  ask the user to accept it in Dash (`dashctl tasks open` brings the task up). The task starts once
  they do.

## Following a task

- **Wait in rounds.** `dashctl tasks wait` returns after at most 110 seconds, with `timedOut: true`
  if nothing happened; call it again to keep waiting. Prefer telling the user a task is running
  over waiting on it for long.
- **See what it's doing** with `dashctl tasks output`, the last lines of its terminal.
- **See what it changed.** `dashctl tasks get` gives the task's worktree path and branch. In a git
  project, read the changes there with git (`git -C <worktree> log`, `diff`, `status`), and its PR
  with `gh`. In a folder that isn't a git repository there's no history to read: look at the files,
  read `tasks output`, or ask the task. Don't edit or commit in the worktree while the task is
  working: it works there.
- **Hand it to the person** with `dashctl tasks open`, which brings Dash to the front on the task.
  Do that when it waits on a person, or when the user wants to look.

## Talking to a task

Dash doesn't carry messages; Claude Code's own `SendMessage` does.

1. `dashctl tasks wake <task-id>` makes sure the task's session runs and returns its
   `messageAddress`. It returns at once if the session is up; a stopped task is started (with no
   message) and it returns once the session is up. It can time out with `timedOut: true`: call it
   again, as with `wait`.
2. `SendMessage` to that address. The task answers you the same way, so stay in this session
   until the answer comes: an orchestrator that has exited gets nothing back.
3. If the task's `messaging` is `needs-approval`, it runs with permission prompts off, so both
   directions are held. Your message waits until a person clicks Deliver in the task's pane in
   Dash. The task's reply waits for approval in your own session, which a non-interactive session
   (`claude -p`) can't give. Tell the user both.
4. `ENOENT` means the session stopped and its address is gone: `wake` it again for a new one.

### When a task can't be reached

A stopped task is not one of these: `wake` starts it, and it takes messages again. A task can't be
reached when:

- you have no `SendMessage` (you run on another harness than Claude Code);
- it needs trust, or is archived: `wake` is refused until the user accepts trust in Dash, or
  restores it;
- its `messaging` is `needs-approval` and nobody is there to click Deliver, or your session can't
  approve its reply.

Then tell the user, who can message it in Dash. Change its work yourself only if the user wants it
done now, and tell the task afterwards.

## Finishing

- **Pushing and opening a PR:** when the user asks, ask the task to do it, by message. Only if it
  can't be reached, do it yourself with git and `gh` in its worktree, and tell the task.
- **Archive** a task the user is done with (`dashctl tasks archive`): its session sleeps and its
  worktree stays, and it can be restored. Archiving also frees its folder for another in-place
  task.
- **Delete** only when the user asks for it. It removes the session and the worktree for good,
  and with `--delete-branch` also the branch Dash created, on the remote too.

## When it fails

- **Dash asks for access.** The first `dashctl` call, while other agents aren't allowed yet,
  prints "dashctl: asking in Dash for access; waiting for an answer there." and Dash brings its
  window to the front with Allow or Deny. Ask the user to answer it in Dash. The call waits about
  90 seconds. On Allow it goes through, and access stays on.
- "dashctl: not allowed. To allow it, turn on "Let other agents control Dash"…": the user denied
  or didn't answer, or Dash had no window to ask in. Ask the user to switch it on in Dash
  (Settings → Claude → Behavior), or to run the call again and answer Allow.
- "Dash is not running": ask the user to open Dash.

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
