# Security policy

## Supported versions

Only the latest version on the `main` branch gets fixes.

## Report a problem

Please do not open a public issue for a security vulnerability. Report it privately through GitHub: the **Security** tab of this repository → **Report a vulnerability**, or directly at https://github.com/egrn/claude-code-mutedit/security/advisories/new.

Write what you saw, how to repeat it, and which Claude Code version you use.

## Disclosure

A confirmed vulnerability is fixed on `main` first. Then a GitHub security advisory describes the problem, the fixed version and the reporter, if the reporter agrees.

## Scope

mutedit only changes how Edit, Write and NotebookEdit results are drawn in the terminal. It does not run commands or send data anywhere; the only thing it keeps is its own on/off switch. Things that matter here: a file name or tool result that makes the mod print raw control characters, break the screen, throw an error, or hide a change the user should see.
