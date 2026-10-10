# Security policy

## Supported versions

Only the latest version on the `main` branch gets fixes.

## Report a problem

Please do not open a public issue for a security problem. Report it privately through GitHub: the **Security** tab of this repository → **Report a vulnerability**.

Write what you saw, how to repeat it, and which Claude Code version you use.

## Scope

mutedit only changes how Edit, Write and NotebookEdit results are drawn in the terminal. It does not run commands or send data anywhere; the only thing it keeps is its own on/off switch. Things that matter here: a file name or tool result that makes the mod print raw control characters, break the screen, throw an error, or hide a change the user should see.
