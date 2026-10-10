# Is the mutedit mod legal and allowed?

A mod is a Claude Code plugin with JavaScript code. This code runs inside Claude Code and can change how the screen looks or how Claude Code works. The mutedit mod makes the terminal output after a file edit shorter. Everything below is true for Claude Code 2.1.295 and the Anthropic pages linked below.

## Short answer

| Requirement | Basis | Result |
| --- | --- | --- |
| The mod uses only things that Anthropic documents for Claude Code | Every file and every call matches the public Anthropic mod docs and the API files that come with Claude Code. The Claude Code plugin checker accepts the mod. | OK |
| No Anthropic rule, term or policy forbids or limits the mod | Usage policy, consumer terms, commercial terms, Claude Code legal and compliance page, privacy and data pages, [Claude Code license](https://unpkg.com/@anthropic-ai/claude-code/LICENSE.md) and plugin directory rules: see the table below | OK: no rule on these pages forbids or limits it |
| The mod changes only the screen | The API says that the saved tool result stays untouched. The plugin checker shows that the mod makes no call outside drawing, its own command and its on/off switch. | OK |

## What the mod does

When Claude edits or creates a file, Claude Code normally shows a diff of the change in the terminal. The mod shows one grey line instead:

- edit: file path, number of added lines, number of removed lines;
- new file: file path and number of lines;
- notebook edit: type of change, cell and file path.

If an edit fails, Claude Code shows the normal error. Results of other tools also look normal.

The `/mutedit` command switches the mod on and off. The choice is kept in the mod store of Claude Code.

Only the screen changes. The Claude Code API says that when a mod draws a tool result in a different way, the saved result stays untouched.

## Why this is a supported way to change Claude Code

The public [mods overview](https://code.claude.com/docs/en/plugins/mods/overview.md) says that a mod can "replace or restyle parts Claude Code draws itself, such as a tool call's row". The [render sites table of the mods reference](https://code.claude.com/docs/en/plugins/mods/reference#render-sites) lists the tool result block as one of the screen parts that a mod can draw, and the [mods interface guide](https://code.claude.com/docs/en/plugins/mods/interface#change-what-claude-code-already-draws) shows how a mod changes what Claude Code already draws. The API files that come with Claude Code describe this block as "the result block drawn under a standalone tool row".

The mod follows these docs. It has a plugin manifest, a hooks file that points to the mod code, and code that listens to the drawing event for the tool result block, to the session start and to its own command. To load a plugin folder directly, without a marketplace, you use a command-line flag. The [plugins overview](https://code.claude.com/docs/en/plugins/overview.md), the [mods overview](https://code.claude.com/docs/en/plugins/mods/overview.md) and the [plugin loading reference](https://code.claude.com/docs/en/plugins/loading.md) describe this flag as the way to develop and try a local plugin, loaded for one session. The Claude Code plugin checker reports these events: `session.start`, `command.run{command=mutedit}`, `ui.render{component=ToolResult}`, and these API calls: `$.command.register`, `$.store.get`, `$.store.set`, `$.ui.ask`, `$.ui.resolve`.

## Anthropic rules and policies

On the listed Anthropic pages, no rule forbids or limits a local mod that only changes the screen. These are the closest rules, and why they do not apply:

| Document | Closest rule | Why it does not apply |
| --- | --- | --- |
| [Usage Policy](https://www.anthropic.com/legal/aup) | Do not intentionally bypass or interfere with the capabilities, restrictions or guardrails of Anthropic products. Do not resell, proxy or provide access to Claude through unauthorized means. | The mod does not bypass or interfere with any capability, restriction or guardrail, sends no requests and gives nobody access to Claude |
| [Consumer Terms of Service](https://www.anthropic.com/legal/consumer-terms) | Do not decompile or reverse engineer. No access to the services by bot or script, unless through an API key or with Anthropic's permission. Do not bypass protective measures. | The mod uses a documented extension point inside the official program and sends nothing to Anthropic |
| [Commercial Terms of Service](https://www.anthropic.com/legal/commercial-terms) | Do not reverse engineer or copy the services. Anthropic's indemnity does not apply to claims arising from the customer's modifications to the services or outputs. | The mod does not do the first. The second only limits Anthropic's indemnity and forbids nothing. |
| [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) | Companies that ship Claude Code in their own products must not change the program or remove a login method. Subscription login is for normal use of Anthropic's own apps. | The program and its login do not change. Claude Code itself logs in and sends every request. |
| [Privacy Policy](https://www.anthropic.com/legal/privacy), [Data usage](https://code.claude.com/docs/en/data-usage) | Describe which data goes to Anthropic | The mod does not change any data flow |
| [Anthropic Software Directory Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) and [Terms](https://support.claude.com/en/articles/13145338-anthropic-software-directory-terms) | Apply to software submitted to the Anthropic plugin directory | The mod is not submitted. The [Anthropic marketplaces page](https://code.claude.com/docs/en/plugins/anthropic-marketplaces.md) says that many plugins are not in any Anthropic marketplace. |

The [Anthropic plugin security page](https://code.claude.com/docs/en/plugins/security.md) says that the person who runs a plugin decides whether to trust it. The same page says that an organization admin can turn off loading plugin folders with the flag. On the [page about managing mods for an organization](https://code.claude.com/docs/en/plugins/mods/admin.md), the admin can allow only mods that the organization manages. With either setting, Claude Code itself can stop this mod from loading.

## Limits

- A mod runs with the user's permissions and has no sandbox. Through the API it can read and write files, start processes and use the network. This mod does none of this: the plugin checker shows only the calls listed above. The code must stay this small.
- Claude Code gives each session a scratchpad folder for temporary files. Claude Code 2.1.295 groups edits in this folder into one row before the mod can draw them, so these edits keep the normal view. The docs do not describe this.
- The API files that come with Claude Code say that the mod API is in early access and can change between releases. Run `tests/check.sh --gate` after each Claude Code update.
