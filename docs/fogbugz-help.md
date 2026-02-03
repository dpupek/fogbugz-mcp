# FogBugz MCP Helper

## Getting Started
- Configure `FOGBUGZ_BASE` with the full API endpoint, e.g. `https://example.fogbugz.com/api.asp`.
- Set `FOGBUGZ_TOKEN` to a personal API token that has access to the projects you intend to query.
- Avoid hardcoding credentials; prefer environment variables or your MCP client’s secret store.

## Available Tools
- `help`: Returns this guidance document.
- `version`: Returns the MCP server name + version.
- `health`: Checks configuration and verifies FogBugz API connectivity.
- `search_cases`: Run FogBugz query syntax searches. Optional `cols` controls returned columns (comma-separated XML column names).
- `case_events`: Same as `search_cases` but always includes the `events` column (can be very large). Event code reference: https://support.fogbugz.com/article/55756-fogbugz-xml-api-event-codes
- `view_case`: Fetch a specific case with optional `cols`. Set `includeAttachments=true` to add `events` automatically and rewrite attachment URLs with the current token.
- `create_case`: Create a case (`title`, `ixProject` required; supports `event`, `ixArea`, `ixPersonAssignedTo`, `ixBugParent`, `ixFixFor`, `category`, `userStory`, `textType`).
- `edit_case`: Update title, user story (`userStory`), event, or arbitrary FogBugz fields. Optional `textType` (`plain`, `html`, `markdown`) sets `fRichText=1` and converts markdown to HTML.
- `add_comment`: Adds an event comment (`text`) to a case. Optional `textType` (`plain`, `html`, `markdown`) sets `fRichText=1` and converts markdown to HTML.
- `add_comment_with_attachment`: Adds a comment and uploads a single attachment (`filename`, `contentBase64`) in one call. Optional `textType` (`plain`, `html`, `markdown`) for the comment.
- `attach_file`: Uploads a base64-encoded attachment (`contentBase64`) as `filename`.
- `list_children`: Lists child cases. Falls back to a search when `ixBugChildren` is absent.
- `case_outline`: Returns the full descendant tree for a case using the FogBugz `outline:<ixBug>` search syntax (handy for epics/parent tracking).
- `resolve_case`: Resolves a case and optionally posts a comment or extra fields. Supports optional `textType` (`plain`, `html`, `markdown`) for the comment.
- `reactivate_case`: Reopens a case and optionally posts a comment or extra fields. Supports optional `textType` (`plain`, `html`, `markdown`) for the comment.
- `list_categories`: Returns FogBugz categories (`ixCategory`, names, metadata).
- `list_areas`: Lists undeleted areas; pass `ixProject` to scope the results to a single project.
- `list_status`: Lists statuses; optionally filter by `ixCategory` and/or `fResolved`.
- `view_status`: Views a status by `ixStatus` (or by `sStatus` + `ixCategory`).
- `list_milestones`: Lists milestones (FixFors); pass `ixProject` to scope to a project.
- `view_milestone`: Views a milestone by `ixFixFor`.
- `create_milestone`: Creates a milestone (`ixProject`, `sFixFor` required; optional `dtStart`, `dtEnd`).
- `edit_milestone`: Updates a milestone (`ixFixFor` required; optional `ixProject`, `sFixFor`, `dtStart`, `dtEnd`, `fAssignable`, `fDeleted`, `confirmDelete`). Set `confirmDelete=true` when `fDeleted=true`.
- `add_milestone_dependency`: Adds a dependency between milestones (`ixFixFor`, `ixFixForDependsOn`).
- `remove_milestone_dependency`: Removes a dependency between milestones (`ixFixFor`, `ixFixForDependsOn`).
- `create_area`: Creates a new area (`ixProject`, `sArea` required; optional `ixPersonPrimaryContact`).
- `edit_area`: Updates an existing area (`ixArea` required; optional `sArea`, `ixProject`, `ixPersonPrimaryContact`).
- `list_custom_fields`: Returns the custom-field names available on a specific case by querying `plugin_customfield` columns.
- `case_link`: Returns the human-facing FogBugz URL for a case (`https://<base>/f/cases/<ixBug>/`).
- `search_users`: Searches people via `listPeople` with a 5-minute cache and in-memory contains matching (`query`, optional `forceRefresh`).
- Legacy dotted names (e.g., `fogbugz.help`) still work for backward compatibility.

> `userStory` arguments automatically map to the FogBugz custom field `plugin_customfields_at_fogcreek_com_userxstoryh815` so you never need to remember the raw XML name.
> `textType` sets the FogBugz `fRichText` flag (HTML events; available on FogBugz On Demand / On Site) and converts markdown to HTML when selected.

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
- **Comment + attachment (single call)**  
  1. Base64-encode the file content.  
  2. Call `add_comment_with_attachment` with `ixBug`, `text`, `filename`, and `contentBase64`.  
  3. Use `textType` to send HTML or markdown in the comment if needed.
- **Create a subcase in a milestone**  
  1. Call `create_case` with `ixBugParent` set to the parent case ID.  
  2. Include `ixFixFor` if the case should start in a specific milestone.  
  3. Add `category` (e.g., `category="Engineering Task"`) to set the case category.  
  4. Provide optional `ixPersonAssignedTo`, `ixArea`, or `userStory` as needed.
- **Resolve a case with context**  
  1. Prepare your resolution comment.  
  2. Call `resolve_case` with `comment` and optional fields like `{ sStatus: "Resolved (Fixed)" }`.
- **Reopen a case**  
  1. Call `reactivate_case` with `comment` describing the regression.  
  2. Follow up with `edit_case` if more fields need adjustment.
- **Post an HTML comment**  
  1. Build an HTML string (e.g., `<p>Update:</p><ul><li>Item 1</li></ul>`).  
  2. Call `add_comment` with `textType="html"` and your HTML in `text`.
- **Post a Markdown comment**  
  1. Write markdown (e.g., `## Update\n- Item 1\n- Item 2`).  
  2. Call `add_comment` with `textType="markdown"` and your markdown in `text` (it will be converted to HTML and sent with `fRichText=1`).
- **Search for a user by name/email**  
  1. Call `search_users` with `query` set to a name or email fragment (e.g., `query="dan"`).  
  2. Set `forceRefresh=true` to clear the 5-minute cache when you need fresh results.  
  3. Read `asof` in the response to see when the cached list was last refreshed.
- **Find all active cases in a milestone**  
  1. Call `search_cases` (or `case_events` if you need history) with `q="status:active fixfor:\"Milestone Name\""`.  
  2. Optionally add columns (`cols="ixBug,sTitle,sPersonAssignedTo"`) to tailor the response.  
  3. Iterate the returned cases or feed them into follow-up tools (`view_case`, `add_comment`, etc.).
- **Bulk edits (by iterating individual calls)**  
  1. Use `search_cases` to collect the target `ixBug` values.  
  2. Call `edit_case`, `resolve_case`, `add_comment`, etc. once per case.  
  3. Throttle your loop (small batches or pauses) to avoid overloading the FogBugz server.
- **Get details for every descendant case**  
  1. Run `case_outline` with `ixBug=<epic-id>`; the result contains `outline` (root) and `forest` (all top-level branches).  
  2. Traverse the `children` arrays directly, or for richer fields call `view_case` on each `ixBug`.  
  3. Combine with `list_children` if you only need a single level of the hierarchy.
  4. Use the cols param to include columns for each child. This way you can pull details for many decendants at once. NOTE: Be careful with the cols, because you could inflect a large data pull that may fail.
- **Include attachments for a case**  
  1. Call `view_case` with `includeAttachments=true` to pull `events` and rewrite attachment URLs with the current token.  
  2. Inspect `case.events` for `rgAttachments` and use the rewritten `sURL` for downloads.
