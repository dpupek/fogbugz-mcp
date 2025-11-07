# FogBugz MCP Helper

## Getting Started
- Configure `FOGBUGZ_BASE` with the full API endpoint, e.g. `https://example.fogbugz.com/api.asp`.
- Set `FOGBUGZ_TOKEN` to a personal API token that has access to the projects you intend to query.
- Avoid hardcoding credentials; prefer environment variables or your MCP client’s secret store.

## Available Tools
- `help`: Returns this guidance document.
- `search_cases`: Run FogBugz query syntax searches. Optional `cols` controls returned columns (comma-separated XML column names).
- `case_events`: Same as `search_cases` but always includes the `events` column (can be very large). Event code reference: https://support.fogbugz.com/article/55756-fogbugz-xml-api-event-codes
- `view_case`: Fetch a specific case with optional `cols`.
- `create_case`: Create a case (`title`, `ixProject` required; supports `event`, `ixArea`, `ixPersonAssignedTo`, `ixBugParent`, `ixFixFor`, `category`, `21_UserStory`).
- `edit_case`: Update title, user story (`21_UserStory`), event, or arbitrary FogBugz fields.
- `add_comment`: Adds an event comment (`text`) to a case.
- `attach_file`: Uploads a base64-encoded attachment (`contentBase64`) as `filename`.
- `list_children`: Lists child cases. Falls back to a search when `ixBugChildren` is absent.
- `resolve_case`: Resolves a case and optionally posts a comment or extra fields.
- `reactivate_case`: Reopens a case and optionally posts a comment or extra fields.
- `case_events`: Same as `search_cases` but always includes the `events` column (can be large).
- `list_categories`: Returns FogBugz categories (`ixCategory`, names, metadata).
- Legacy dotted names (e.g., `fogbugz.help`) still work for backward compatibility.

### Query Syntax Tips
- Combine filters with spaces (each term narrows results): `project:"Support" status:active assignedto:"Jane Smith"`.
- Use `ixbug:<id>` for exact matches; `parent:<id>` returns children.
- Phrase searches require quotes (`"memory leak"`); prefix match with `~` (`title:~sync*`).
- Boolean operators and parentheses (`(project:"API" or project:"CLI") and not status:closed`).
- Date filters: `opened:"last 7 days"`, `edited:"this week"`, `due:>2024-12-01`.
- Metadata filters: `type:"Bug"`, `priority:"High"`, `milestone:"Q4 Release"`, `tag:"ui"`.
- Append `cols=field1,field2` to control returned columns (our tools preload a rich default set).
- Test queries in the FogBugz search UI; MCP uses the same syntax/engine.

### Category Notes
- `category` accepts either a FogBugz category ID or one of the friendly names: Bug, Enhancement, Engineering Task, New Feature.
- For custom categories, provide the numeric ID returned by FogBugz (e.g., via `cols="ixCategory"`).

## Error Handling
- FogBugz API errors return their numeric codes and messages. Fix the offending request before retrying.
- Network or parsing failures yield code `-32000`; reattempt after verifying connectivity or credentials.
- Unexpected XML formats throw an "Invalid FogBugz response" error—usually indicates a bad endpoint or HTML error page.

## Recipes
- **Find & inspect a case**  
  1. Call `search_cases` with `q="project:\"My Project\" status:active"`.  
  2. Take the desired `ixBug` and call `view_case` with `cols="sTitle,sLatestTextSummary,ixPersonAssignedTo"`.
- **Add a comment to a case**  
  1. Call `add_comment` with `ixBug` and `text`.  
  2. Optionally follow with `view_case` to verify `sLatestTextSummary`.
- **Attach diagnostics**  
  1. Base64-encode the file content.  
  2. Call `attach_file` with `ixBug`, `filename`, and the encoded string.  
  3. Confirm via `view_case` with `cols="ixAttachments"` if needed.
- **Create a subcase in a milestone**  
  1. Call `create_case` with `ixBugParent` set to the parent case ID.  
  2. Include `ixFixFor` if the case should start in a specific milestone.  
  3. Add `category` (e.g., `category="Engineering Task"`) to set the case category.  
  4. Provide optional `ixPersonAssignedTo` or `ixArea` as needed.
- **Resolve a case with context**  
  1. Prepare your resolution comment.  
  2. Call `resolve_case` with `comment` and optional fields like `{ sStatus: "Resolved (Fixed)" }`.
- **Reopen a case**  
  1. Call `reactivate_case` with `comment` describing the regression.  
  2. Follow up with `edit_case` if more fields need adjustment.
