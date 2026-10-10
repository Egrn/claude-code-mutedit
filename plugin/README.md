# mutedit

A Claude Code mod that mutes edit diffs. When Claude edits or creates a file, the terminal shows one grey summary line instead of the full diff:

```
● Update(src/app.js)
  ⎿  Muted it: updated · src/app.js · +2 −1
● Write(notes.txt)
  ⎿  Muted it: created · notes.txt · 4 lines
```

When a Bash command changes files, its output stays and the diff becomes one line per file, such as `deleted · old.txt · 3 lines`, or `changed · graph.mmd` for a file too large to diff.

Only the screen changes. The saved tool result and what the model sees stay the same. A failed edit or command shows the normal error, and other tools look normal.

## Commands

- `/mutedit` shows the state and asks On or Off.
- `/mutedit on` turns on the summary line for new edit results.
- `/mutedit off` turns on the full diff again.

The choice is kept in new sessions.

## What it runs and sends

The mod draws tool results, registers the `/mutedit` command and keeps its on/off switch in the Claude Code mod store. It does not run commands, read or write files, or send data anywhere.

## Warning

The mod hides what Claude changed. Read the changes with `git diff` or in your editor before you trust them.

Source, tests and limits: https://github.com/egrn/claude-code-mutedit

Why the mod is allowed: https://github.com/egrn/claude-code-mutedit/blob/main/legacy.md
