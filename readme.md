# FogBugz MCP Server

A Model Context Protocol (MCP) server that lets **Codex** interact with **FogBugz** cases — search, view, create, edit, resolve, reactivate, and attach files — all over the official FogBugz XML API.

---

## 🧭 Overview

This server bridges Codex and FogBugz through the MCP stdio protocol.

- Written in **Node.js (ESM)**
- Uses **FogBugz XML API**
- Exposes structured tools:
  - `help`
  - `search_cases`
  - `case_events`
  - `view_case`
  - `create_case`
  - `edit_case`
  - `add_comment`
  - `attach_file`
  - `list_children`
  - `resolve_case`
  - `reactivate_case`

`create_case` accepts the FogBugz custom user-story field (`21_UserStory`) along with the standard fields. `edit_case` exposes top-level `title` and `21_UserStory` arguments, and `case_events` mirrors `search_cases` but forces the `events` column so you can retrieve the full event log (see [FogBugz event codes](https://support.fogbugz.com/article/55756-fogbugz-xml-api-event-codes)).

---

## ⚙️ Setup

### 1. Clone or create the project

```bash
mkdir -p ~/dev/fogbugz-mcp && cd ~/dev/fogbugz-mcp
````

### 2. Add these files

**package.json**

```json
{
  "name": "fogbugz-mcp",
  "version": "1.0.0",
  "type": "module",
  "bin": { "fogbugz-mcp": "./index.js" },
  "dependencies": {
    "form-data": "^4.0.0",
    "undici": "^6.19.8",
    "xml2js": "^0.6.2"
  }
}
```

**index.js**

> (Full MCP implementation from the developer guide.)

### 3. Install dependencies

```bash
npm install
chmod +x index.js
```

---

## 🔧 Configure Codex

In your `~/.config/codex/config.toml`:

```toml
[mcp_servers.fogbugz]
type = "stdio"
command = "node"
args = ["/home/<you>/dev/fogbugz-mcp/index.js"]
startup_timeout_ms = 10000
tool_timeout_ms    = 60000
description = "FogBugz MCP server (search/view/new/edit/comment/attach/children/resolve/reactivate)"

env = {
  FOGBUGZ_BASE = "https://<YOUR>.fogbugz.com/api.asp",
  FOGBUGZ_TOKEN = "7m5anarttjnu5o8gokr13hguod9q68"
}
```

Replace `<you>` and `<YOUR>` with your environment details.

---

## 🚀 Test

You can sanity check the MCP handshake manually:

```bash
printf 'Content-Length: 57\r\n\r\n{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node index.js
```

Expected output: a list of canonical tools (e.g., `search_cases`, `view_case`).

---

## 🧰 Tool Examples

**Search:**

```json
{ "name": "search_cases", "arguments": { "q": "assignedto:me status:active" } }
```

**Case Events:**

```json
{ "name": "case_events", "arguments": { "q": "ixbug:207291" } }
```

**Create:**

```json
{ "name": "create_case", "arguments": { "title": "Login timeout bug", "ixProject": 1 } }
```

**Resolve:**

```json
{ "name": "resolve_case", "arguments": { "ixBug": 42, "comment": "Fixed in build 2025.11.06" } }
```

**Reactivate:**

```json
{ "name": "reactivate_case", "arguments": { "ixBug": 42, "comment": "Regression detected" } }
```

**List Children:**

```json
{ "name": "list_children", "arguments": { "ixBug": 1001 } }
```

---

## 🩺 Troubleshooting

| Symptom                               | Likely Cause                       | Fix                                            |
| ------------------------------------- | ---------------------------------- | ---------------------------------------------- |
| `tools/call failed: Transport closed` | Server crashed or token invalid    | Check `FOGBUGZ_BASE` / token and restart Codex |
| “Invalid FogBugz response”            | API URL incorrect                  | Use full `/api.asp` endpoint                   |
| Empty children list                   | Server lacks `ixBugChildren`       | Fallback query `parent:<id>` auto-applies      |
| Attach fails                          | file too large or token permission | confirm file size < FogBugz upload limit       |

---

## 🔒 Security Notes

* Never hardcode API tokens in the repo.
* Scope your FogBugz token to the minimal permissions needed.
* If sharing with teammates, provide the token via their own environment, not `config.toml` in source control.

---

## 📜 License

MIT (or internal use). Update if distributing publicly.

---

## 👤 Maintainer

Daniel Pupek — Chief Systems & Software Architect
Advanced Systems Technology, Inc.
