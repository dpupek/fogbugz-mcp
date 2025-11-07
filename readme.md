# FogBugz MCP Server

A Model Context Protocol (MCP) server that lets **Codex** interact with **FogBugz** over the official XML API. The server exposes curated tools for searching, auditing, and updating cases so agents can stay inside Codex while FogBugz handles the workflow.

---

## 🧭 Overview

The server runs over the MCP stdio transport via `@modelcontextprotocol/sdk`. Every tool call is framed, schema-validated, and logged, so you can reason about FogBugz state while keeping your MCP client stable. The project ships with:

- Canonical tool names (`search_cases`, `case_events`, `view_case`, etc.) mapped to FogBugz XML commands.
- A markdown help resource (`help`) that Codex can read when it needs a refresher.
- Structured logging of outbound FogBugz traffic to simplify debugging.

---

## ⚙️ Setup

### Prerequisites
- Node.js **20.x or newer** (ESM + undici are required).
- npm (ships with Node) and `git`.
- A FogBugz account with access to the projects you plan to touch.
- Codex configured to load MCP servers from `~/.config/codex/config.toml`.

### 1. Clone & install
**macOS/Linux**
```bash
mkdir -p ~/dev && cd ~/dev
git clone https://github.com/dpupek/fogbugz-mcp.git
cd fogbugz-mcp
npm install
chmod +x index.js
```

**Windows (PowerShell)**
```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\dev" | Out-Null
Set-Location "$env:USERPROFILE\dev"
git clone https://github.com/dpupek/fogbugz-mcp.git
Set-Location fogbugz-mcp
npm install
```

Windows doesn’t require `chmod +x`. If you use WSL, follow the Linux steps instead.

Use any workspace path you like; the examples below assume `~/dev/fogbugz-mcp` (or `%USERPROFILE%\dev\fogbugz-mcp` on Windows).

### 2. Pick the values you will embed in the MCP config
Codex can pass environment variables directly to the MCP process via the `env = { ... }` block you define in `config.toml`, so you don’t need to `export` them in your shell. Decide on the following values (but keep them out of git/notes):

| Variable | Required | Description |
| --- | --- | --- |
| `FOGBUGZ_BASE` | ✅ | Full FogBugz API endpoint, e.g. `https://example.fogbugz.com/api.asp`. |
| `FOGBUGZ_TOKEN` | ✅ | Personal API token with permission to read/update the target projects. |
| `FOGBUGZ_MCP_LOG_FILE` | optional | File path for JSON logs (e.g. `/tmp/fogbugz-mcp.log`). |
| `FOGBUGZ_MCP_DEBUG` | optional | Set to `1` for verbose request/response logging. |

Because these values end up in `config.toml`, keep that file outside version control (Codex stores it under your home directory by default). If you sync dotfiles, mask or template the token first.

### 3. Generate a FogBugz token (once per user)
1. Sign in to FogBugz in a browser.
2. Click your avatar ➜ **User Options** (or **Profile** depending on your skin).
3. Open **API Tokens** and click **Create API Token**.
4. Give the token a descriptive label (e.g., “Codex MCP”) and copy the generated value.
5. Store it securely (password manager, OS keychain) and set `FOGBUGZ_TOKEN` in your environment.

Why the fuss? FogBugz tokens grant the same rights as your account—treat them like passwords, rotate them when someone leaves the team, and never paste them into support tickets or commit history.

### 4. Wire the server into Codex
Edit `~/.config/codex/config.toml` (create the file if it does not exist) and add:
```toml
[mcp_servers.fogbugz]
type = "stdio"
command = "node"
args = ["/home/<you>/dev/fogbugz-mcp/index.js"]
startup_timeout_sec = 15
shutdown_timeout_sec = 5
tool_timeout_sec = 60
description = "FogBugz MCP server (search/view/create/edit/comment/attach/children/events)"

env = {  "FOGBUGZ_BASE" = "https://example.fogbugz.com/api.asp",   "FOGBUGZ_TOKEN" = "paste-your-token-here",   "FOGBUGZ_MCP_LOG_FILE" = "/tmp/fogbugz-mcp.log",  "FOGBUGZ_MCP_DEBUG" = "1"}
```
- Keep the `args` path in sync with wherever you cloned the repo.
- Codex injects these env vars when it launches the server, so there is no need to export them globally; treat this block like a private secrets store.
- If Codex reports a handshake timeout, raise `startup_timeout_sec` slightly to give Node more time to boot.
- env property must have no line breaks.

### 5. Smoke test the transport
You can sanity-check the MCP handshake without Codex:
```bash
printf 'Content-Length: 57\r\n\r\n{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node index.js
```
You should see a newline-framed JSON response containing the tool registry. Confirm `help`, `search_cases`, and `case_events` show up.

---

## 🔎 FogBugz query syntax primer
Most tools rely on FogBugz’ search syntax. Highlights:
- `ixBug:207291` finds a single case by ID.
- `assignedto:"Tier 2" status:active` filters by owner and status (use quotes for spaces).
- `project:"NexPort Solutions" opened:"this week"` mixes project filters with date shortcuts.
- `parent:207291` or `children:207291` retrieves hierarchy relationships.
- `outline:207291` returns the full descendant tree (what `case_outline` uses under the hood).
- Use `cols=` to request additional XML columns (comma separated). The MCP server auto-adds safe defaults for each tool.
For the full grammar, see FogBugz’ “Search Syntax” guide or run `fogbugz.help` from Codex for quick reminders.

---

## 🧰 MCP tool catalog
| Tool | Purpose | Key arguments & notes |
| --- | --- | --- |
| `help` | Returns the markdown help/recipes that ships with the server. | No arguments. Useful when Codex needs onboarding text. |
| `search_cases` | Run arbitrary FogBugz searches. | `q` (required) plus optional `cols`. Used for lightweight listings. |
| `case_events` | Same as `search_cases` but forces the `events` column so you get the full event log (can be very large). | Ideal when auditing conversations or history. |
| `view_case` | Fetch one case by ID with optional columns; auto-includes `ixBug`. | Arguments: `ixBug`, optional `cols`. Returns a normalized JSON payload plus raw XML.
| `create_case` | Create a new FogBugz case. Supports parent/milestone/category and the custom `userStory` text. | Required: `title`, `ixProject`. Optional: `event`, `ixArea`, `ixPersonAssignedTo`, `ixBugParent`, `ixFixFor`, `category`, `userStory`.
| `edit_case` | Update an existing case. You can change the title, `userStory`, or any FogBugz XML field via the `fields` map. | Required: `ixBug`. Optional: `event`, `fields`, `title`, `userStory`.
| `add_comment` | Add a comment/event to a case. | `ixBug`, `text`. |
| `attach_file` | Upload an attachment using base64 content. | `ixBug`, `filename`, `contentBase64`. |
| `list_children` | Return the parent case plus its children (ID, title, assignee, timestamps). | `ixBug` (parent). Handles null IDs by coercing response columns. |
| `case_outline` | Build the entire descendant tree using FogBugz `outline:<ixBug>` search. | `ixBug` (required) plus optional `cols`. Returns `outline` (root) and `forest` (all top-level branches). |
| `resolve_case` | Resolve a case with optional closing comment or field edits. | `ixBug`, optional `comment`, `fields`. |
| `reactivate_case` | Re-open a case with optional comment/field payload. | Same schema as `resolve_case`. |
| `list_categories` | Enumerate every FogBugz category and metadata (`sCategory`, workflow flags, etc.). | No arguments; handy for validating the `category` you pass to `create_case`. |
| `list_areas` | List undeleted areas (optionally filtered by project). | `ixProject` optional. Useful before creating cases or editing areas. |
| `list_custom_fields` | Return the custom-field names configured for a specific case. | `ixBug` required. Helps discover field keys like `plugin_customfields_at_fogcreek_com_*`. |
| `case_link` | Build the FogBugz web URL a human can click. | `ixBug` required; uses your `FOGBUGZ_BASE` minus `/api.asp` to form `https://.../f/cases/<ixBug>/`. |

Example MCP call payload:
```json
{
  "name": "create_case",
  "arguments": {
    "title": "Transcript report totals look wrong",
    "ixProject": 27,
    "ixBugParent": 207291,
    "category": "Engineering Task",
    "userStory": "As a registrar..."
  }
}
```

*`userStory` maps to the FogBugz custom field `plugin_customfields_at_fogcreek_com_userxstoryh815`, so you don’t need to remember the raw XML name.*

---

## 🧪 Workflow snippets
- **Search then inspect:** Call `search_cases` with `q="ixBug:207291"`, grab the ID, then call `view_case` for enriched columns.
- **Full audit trail:** Use `case_events` with `cols="sTitle,events"` to stream every change along with event codes (see FogBugz docs for the code legend).
- **Create + comment:** After `create_case` returns the new `ixBug`, immediately call `add_comment` to capture additional context while Codex still has it in memory.
- **Hierarchy review:** `list_children` returns both the parent echo and each child’s `ixBug`, `sTitle`, `sStatus`, `ixPersonAssignedTo`, and `dtLastUpdated`.
- **Epic outline:** Use `case_outline` to pull the entire descendant tree (parent ➜ children ➜ grandchildren) before planning or bulk edits.

---

## 🩺 Troubleshooting
| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `tools/list` returns zero tools | Env vars missing or startup failed before registration. | Check `/tmp/fogbugz-mcp.log` and ensure `FOGBUGZ_BASE`/`FOGBUGZ_TOKEN` are exported before Codex launches. |
| `Unexpected response type` or `Transport closed` when calling a tool | MCP framing mismatch caused by a crash or malformed FogBugz response. | Inspect the log file for the failing tool; run it manually with `node index.js` and re-try with `FOGBUGZ_MCP_DEBUG=1`. |
| Continuous heartbeat but Codex times out | The server never received `initialize` because Codex could not read from stdio. | Confirm stdin/stdout aren’t redirected and that no other process is binding to the same command. |
| `Invalid 'tools[n].name'` error | Tool names contained dots/aliases. | Stick with the canonical names listed above; aliases were removed. |
| Attachments or `case_events` truncated | Large payloads can hit FogBugz or Codex limits. | Narrow your `q` filter, request fewer columns, or avoid event-heavy cases unless needed. |

---

## 🔒 Security notes
- Tokens inherit your FogBugz permissions. Store them in env vars or OS keychains—not in git, Codex transcripts, or screenshots.
- Rotate tokens periodically and immediately after leaving a shared machine.
- Log files can capture request URLs (including tokens if you misconfigure the base URL). Keep them on trusted disks and redact before sharing.
- If you must share logs, strip case content to avoid leaking customer data.

---

## 📜 License
MIT (or internal use). Update if distributing publicly.

---

## 👤 Maintainer
Daniel Pupek — Chief Systems & Software Architect, Advanced Systems Technology, Inc.
