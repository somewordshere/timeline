# Chat Timeline

A date timeline that sits in a pane beside your Claude Code conversation. Every message you sent is listed, oldest at the top: each new day starts with its date, and under it every message has its time with its first words beneath.

```
━ 28 October
│ 19:10
│ claude plugin validate ./<plugin-folder>
│ 19:12
│ wait, who is the dev?
```

- **Click** a time to jump the chat to that message. Hovering a time shows `← go to message`.
- When a long chat has more messages than the pane has rows, neighbouring messages share a row.
- Run `/timeline` to open the pane again after you close it.

## Settings

Change them with `/timeline <setting> <value>`, or in a terminal session with `/plugin configure chat-timeline`. `/timeline settings` shows what is set now and `/timeline help` lists every choice.

| Setting | `/timeline` command | Choices | Default |
| - | - | - | - |
| Message preview | `/timeline preview on\|off\|hover` | below each time, hidden, or only in the hover card | below each time |
| Message size | `/timeline messages small\|medium\|large` | the preview's size | medium |
| Month names | `/timeline months full\|short` | October or Oct | full |
| Clock | `/timeline clock 24\|12` | 16:41 or 4:41 PM | 24-hour |
| Text size | `/timeline size normal\|large` | the dates' and times' size | normal |
| Hover card | `/timeline card on\|off` | a card with the full date under a hovered time | off |

## Requirements

- Claude Code, in the terminal or in the Claude desktop app's Code tab. It is a mod (a change to Claude Code's own interface), so it does nothing in claude.ai chat or Cowork.
- **Click-to-jump in the desktop app needs Windows.** The timeline itself works everywhere. In the terminal, a click scrolls Claude Code's own fullscreen transcript on any system. In the desktop app on macOS and Linux, a click says it could not find the message instead of scrolling.

## Install

```bash
/plugin marketplace add somewordshere/timeline
```

```bash
/plugin install chat-timeline@timeline-mods
```

Then run `/reload-plugins` or open a new session.

## What it reads, runs and writes

Everything stays on your computer. The plugin sends nothing over the network and uses no MCP servers, credentials or API keys.

**Reads**
- The current session's transcript file under your Claude config folder (`CLAUDE_CONFIG_DIR`, or `~/.claude`), `projects/<project>/<session id>.jsonl`, to list your own messages with their times. It reads the environment variables `CLAUDE_CONFIG_DIR`, `HOME` and `USERPROFILE` only to find that folder.
- When a transcript is larger than 4 MiB, it reads only the message lines through a local command instead: `Get-Content` in PowerShell on Windows, `grep` elsewhere.

**Runs (Windows, desktop app only, when you click a time)**
- `hooks/jump.ps1` in PowerShell with `-NoProfile -ExecutionPolicy Bypass`. The script uses Windows UI Automation, the accessibility interface screen readers use, on the Claude window only. It finds the row the chat announces as "You said: …", presses the chat's own "Load earlier messages" button until older messages are loaded, steps the chat down a page at a time, and scrolls that row into view. It sends no keystrokes, does not touch the clipboard, and puts the chat back where it was if the message is not found. The opening words of the clicked message are passed to it on standard input.

**Writes**
- Its own settings, when you change one with `/timeline <setting> <value>`: saved by Claude Code in your user settings, as the settings menu saves them.
- `jump.log` in the plugin's own folder, only when a click fails to land. It holds the time, the opening words of the clicked message and the script's output, and is overwritten on each failed click.
- The plugin's own state (the list of message times and previews) inside Claude Code for the session.

## Files

| File | What it is |
| - | - |
| `hooks/register.tsx` | The mod: the pane, the `/timeline` command and its settings, reading the transcript |
| `hooks/jump.ps1` | The Windows script that scrolls the desktop chat |
| `types/index.d.ts` | The types of the plugin's state |
| `tests/timeline.test.ts` | Tests for the pane and the settings |

## License

MIT, see [LICENSE](LICENSE).
