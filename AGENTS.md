# FogBugz MCP Agent Notes

## Environment
- **Server binary**: `node index.js`
- **Required env vars**:
  - `FOGBUGZ_BASE` (e.g., `https://example.fogbugz.com/api.asp`).
  - `FOGBUGZ_TOKEN` (personal API token with project access).
  - `FOGBUGZ_MCP_DEBUG` (optional, set to `1` for verbose logging).
  - `FOGBUGZ_MCP_LOG_FILE` (optional log file path).
- **Transport**: MCP stdio, framed and validated by `@modelcontextprotocol/sdk`.

## Behavior
- Uses `McpServer`/`StdioServerTransport` from `@modelcontextprotocol/sdk` for JSON-RPC framing, initialization, and tool routing.
- Tool inputs validated via shared Zod schema shapes.
- Each tool returns a single `text` content block containing pretty-printed JSON so Codex can parse or display it.
- `fbCall` helper handles FogBugz POSTs, logs requests/responses when debug logging is enabled, parses XML, and normalizes errors.
- `view_case` auto-falls back to `search ixbug:<id>` when FogBugz `view` returns an empty response; default column set always includes `ixBug`, `sFixFor`, parent/child info, latest summary, project/area, etc.
- Legacy alias names are not registered; only canonical tool names are exposed (see below).

## Registered Tools
- `help` – Returns the guidance markdown (same as the static `help` resource).
- `search_cases` – FogBugz `search` wrapper (`q`, optional `cols`).
- `view_case` – Fetch case details (`ixBug`, optional `cols`), with fallback search when `view` fails.
- `create_case` – Create new case (`title`, `ixProject`, plus optional `event`, `ixArea`, `ixPersonAssignedTo`, `ixBugParent`, `ixFixFor`, `category`, `userStory`).
- `edit_case` – Edit title, `userStory`, event, or arbitrary FogBugz fields on an existing case (`ixBug`, optional `event`, `fields`).
- `case_events` – Search cases but always include the FogBugz `events` column (large payload). 
- `list_categories` – List FogBugz categories (`ixCategory`, metadata) via `cmd=listCategories`.
- `list_areas` – List undeleted areas, optionally filtered by `ixProject` via `cmd=listAreas`.
- `list_custom_fields` – Discover custom-field names on a case by running a `search` with `cols=plugin_customfield`.
- `case_link` – Produce the human-facing FogBugz URL for a case using the base URL (e.g., `https://example.fogbugz.com/f/cases/<ixBug>/`).
- `search_users` – Search people via cached `listPeople` results with in-memory contains matching (`query`, optional `forceRefresh`).
- `add_comment` – Add a comment (`ixBug`, `text`).
- `attach_file` – Attach base64 file body (`ixBug`, `filename`, `contentBase64`).
- `list_children` – List child cases of a parent (`ixBug`). Uses `view` first, falls back to `search parent:<id>`.
- `case_outline` – Generate the full descendant tree for a case via `outline:<ixBug>` search (useful for epic/parent reviews).
- `resolve_case` – Resolve a case (`ixBug`, optional `comment`, `fields`).
- `reactivate_case` – Reactivate/reopen a case (`ixBug`, optional `comment`, `fields`).

## Help Resource
- Static markdown stored at `docs/fogbugz-help.md` registered both as a tool (`help`) and resource (`help`).

## Debugging Tips
- Set `FOGBUGZ_MCP_DEBUG=1` and optionally `FOGBUGZ_MCP_LOG_FILE=/path/to/log` to capture request/response traces.
- Default column list ensures answers always include key metadata even when callers forget to specify `cols`.
- `fbCall` logs the first 200 characters of every XML response; if FogBugz misbehaves (HTML login page, etc.), the snippet will show it.
- Since `@modelcontextprotocol/sdk` handles framing, Codex compatibility issues now typically stem from FogBugz data/credentials, not transport.
