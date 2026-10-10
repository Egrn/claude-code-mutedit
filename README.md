# mutedit

[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/egrn/claude-code-mutedit/badge)](https://scorecard.dev/viewer/?uri=github.com/egrn/claude-code-mutedit)
[![CodeQL](https://github.com/egrn/claude-code-mutedit/actions/workflows/codeql.yml/badge.svg)](https://github.com/egrn/claude-code-mutedit/actions/workflows/codeql.yml)

**Hey, Muted it! Ditch the diff cut the riff, no more edits less of credits**

A Claude Code mod that mutes edit diffs. When Claude edits or creates a file, the terminal shows one grey summary line instead of the full diff:

```
updated · src/app.js · +2 −1
created · notes.txt · 4 lines
```

Only the screen changes. The saved tool result and what the model sees stay the same.

## Install

Mods need Claude Code v2.1.287 or later. Pick one of two ways.

**1. From a local copy** Claude Code reads the mod from the `plugin/` folder of your copy, so after you change it, run `/reload-plugins`.

```
git clone https://github.com/egrn/claude-code-mutedit
claude plugin marketplace add ./claude-code-mutedit
claude plugin install mutedit@mutedit
```

**2. Into the Claude Code plugin folder** Claude Code downloads the mod from GitHub into its own folder. Update it with `claude plugin update mutedit@mutedit`.

```
claude plugin marketplace add egrn/claude-code-mutedit
claude plugin install mutedit@mutedit
```

Start a new Claude Code session after either way. Remove the mod with `claude plugin uninstall mutedit@mutedit`.

## About

Tested with Claude Code 2.1.295 on Linux. Node.js is not needed: the mod runs inside Claude Code. The checks also need tmux (tested 3.6).

The mod uses only the public Claude Code mod API, and no Anthropic rule forbids it: see [legacy.md](legacy.md) with sources. License: [MIT](LICENSE). Security reports: [SECURITY.md](SECURITY.md).

## What it shows

| Tool | Summary line |
| --- | --- |
| Edit | `updated · <path> · +<added> −<removed>` |
| Write, new file | `created · <path> · <lines> lines` |
| Write, existing file | `updated · <path> · +<added> −<removed>` |
| NotebookEdit | `<mode> cell <id> · <path>` |

A failed edit shows the normal error. Other tools look normal.

The path is shown as it really is. Characters that can move the cursor, break the line, hide text or turn it right-to-left are shown as escapes, for example `\x1b`, `\n`, `\u202e`. A path longer than 1000 characters is cut in the middle with `…`.

## Switch it on and off

| Command | What it does |
| --- | --- |
| `/mutedit` | shows the state and a short help, then asks On or Off |
| `/mutedit on` | one summary line for new edit results, answers `mutedit: on` |
| `/mutedit off` | full diff for new edit results, answers `mutedit: off` |

The choice is saved and kept in new sessions. It changes only edit results drawn after it: results already on the screen keep their look.

## Warning

The mod hides what Claude changed. A bad or unwanted change is not visible on the screen. Read the changes with `git diff` or in your editor before you trust them.

## Limits

- In the manual permission mode Claude Code shows the diff in the permission dialog before the edit. A mod cannot change this dialog.
- Checked live only in the terminal. The VS Code extension and the desktop app are not checked.
- Claude Code groups edits in the session scratchpad folder into one row before the mod can draw them, so these edits keep the normal view.
- A file name can contain text that looks like the summary, for example `a.ts · +0 −0`. The mod does not detect this.
- A new file with only `\r` (old Mac) line breaks counts as one line.
- The mod API is in early access. After a Claude Code update, run the gate (see below).

## Develop

The repository is for development. Users get only the `plugin/` folder: the marketplace file points there.

```
plugin/          what users install: manifest, hooks module, readme, license
tests/check.sh   all checks and the gate
tests/unit/      unit tests
```

Run Claude Code with the mod loaded from your copy:

```
claude --plugin-dir /path/to/claude-code-mutedit/plugin
```

The first such session creates `plugin/.claude-plugin/types/` and `plugin/tsconfig.json` (the mod API types, not in git). Until then the root `tsconfig.json` has nothing to extend, and the editor shows a config error.

## Why

Claude Code has no setting to hide edit diffs. Requests for one:

- [#25060](https://github.com/anthropics/claude-code/issues/25060) Add setting to hide/collapse file diff output in chat
- [#33412](https://github.com/anthropics/claude-code/issues/33412) Add global setting to suppress verbose diff/edit output
- [#5740](https://github.com/anthropics/claude-code/issues/5740) Implement `--summary` mode for concise execution overview
- [#13065](https://github.com/anthropics/claude-code/issues/13065) Add setting to control Edit tool output verbosity
- [#21520](https://github.com/anthropics/claude-code/issues/21520) Add diffDisplay setting to control Edit tool output verbosity
- [#72788](https://github.com/anthropics/claude-code/issues/72788) Add option to suppress file diff output

## Tests and the gate

One script runs all checks: `tests/check.sh`. Without flags it prints its help.

| Call | Needs | What it does | Time |
| --- | --- | --- | --- |
| `tests/check.sh --unit` | claude | static check + unit tests | ~3 s |
| `tests/check.sh --live` | claude, tmux | static check + live check in a real terminal, no model | ~40 s |
| `tests/check.sh --live --baseline` | claude, tmux | the above + the same session without the mod, to compare | ~45 s |
| `tests/check.sh --gate` | claude, tmux | the gate: static check + unit tests + live check with baseline | ~50 s |
| add `--keep` to a live run | | keeps the temp folder and the session copy | |

Flags combine. Exit code is 0 only when every check passes. Output goes to `tests/results/`.

**Static check** `claude plugin validate` must report exactly these hooks: `session.start`, `command.run{command=mutedit}`, `ui.render{component=ToolResult}`, and these calls: `$.command.register`, `$.store.get`, `$.store.set`, `$.ui.ask`, `$.ui.resolve`. No files, no network, no processes. A mod runs with your permissions, so this list must stay this short.

**Unit tests** (139, `claude plugin test`, each one on the terminal and the desktop surface where it draws):

| Class | Tests | What it checks |
| --- | --- | --- |
| summary line | 26 | the line for every tool and case, line count of new files |
| broken input | 20 | broken patch, wrong field types: no crash |
| control characters | 46 | escapes, bidi and zero-width chars, broken UTF-16, cut of long paths |
| stock drawing kept | 18 | errors, other tools, empty output go to the normal drawing |
| command | 11 | `/mutedit on/off`, unknown and hostile arguments |
| dialog | 5 | On, Off, Esc, free text |
| switch keeps rows | 4 | rows drawn before a switch keep their look |
| broken store | 7 | bad saved values, failed read and save |
| speed | 2 | time limits from 10 lines to 1 million lines, 100 000 rows |

`claude plugin test` finds tests only inside the plugin folder, so the script copies `plugin/` and `tests/unit/` to a temp folder and runs them there.

**Live check** The script builds a made-up saved session: every permission mode, every file tool, errors, a user rejection, a plan file, a parallel group, bad paths. Then it opens the session with `claude --resume` in a hidden tmux window. Claude Code draws the saved results again through the mod, and the script reads the screen. It also drives `/mutedit` and its dialog and checks that the choice is kept in a new session. Nothing is sent to the model. Your own on/off state is read first and put back at the end.

**The gate** After every code change run:

```
tests/check.sh --gate
```

Do not ship when it fails.
