---
name: obsidian
description: Search, read, browse, and edit an Obsidian vault via the `obsidian` tool (a direct CLI wrapper, not MCP). Use for any question about notes, tags, backlinks, frontmatter, or vault contents — especially when the user references their vault, a note, or asks to find something in Obsidian.
license: GPL-3.0
compatibility: Requires the `obsidian` CLI (https://help.obsidian.md/Extending+Obsidian/Command+line+interface)
---

## When to Use

Use whenever the user asks about anything in their Obsidian vault — finding a note, searching content, reading a note, listing tags/backlinks/properties, or creating/editing notes. Triggers: "search my vault/notes", "find the note about X", "what's in my Obsidian", "read the note", "add to my daily note", "create a note", "show backlinks to", "list my tags".

**IMPORTANT**: The `obsidian` tool calls the local Obsidian CLI directly (installed at `/opt/homebrew/bin/obsidian`). It is **not** an MCP server — do not use the `mcp` gateway. The Obsidian desktop app must be running with the CLI enabled (Settings > General > Advanced > Enable Command Line Interface).

## Tool reference

The `obsidian` tool takes:

- `command` (required, enum) — the CLI subcommand to run.
- `args` (optional object) — key/value flags. Booleans become bare flags (`{counts: true}` → `counts`). Strings/numbers become `key=value` tokens. Use `\n` for newlines and `\t` for tabs inside `content` values.
- `vault` (optional) — target vault by name. Defaults to the active vault. Only `flat` is registered.
- `timeoutSeconds` (optional, default 30, max 120).

### Search

- `search` — filename matches. **Always pass `format: "json"` and `limit`.**
  - `args: { query: "mistral", format: "json", limit: 10, path: "hermes/research" }`
  - `case: true` for case-sensitive; `total: true` for just a count.
- `search:context` — matching lines with surrounding context. Use this to see **why** a note matched.
  - `args: { query: "mistral", format: "json", limit: 10 }`

### Read / browse

- `read` — read a note body.
  - `args: { file: "My Note" }` resolves by name (wikilink-style, alias-aware) — preferred.
  - `args: { path: "folder/note.md" }` is exact.
- `files` — list files (`args: { folder: "hermes", ext: "md", total: true }`).
- `folders` — list folders (`args: { folder: "hermes" }`).
- `outline` — heading tree of one note (`args: { path: "folder/note.md", format: "md" }`; formats: tree|md|json).
- `tags` — all tags (`args: { counts: true, sort: "count", format: "json" }`; `file:` to scope to one note).
- `properties` — all frontmatter keys (`args: { counts: true, sort: "count", format: "json" }`).
- `property:read` — one property value (`args: { name: "status", file: "My Note" }`).
- `aliases` — list aliases in the vault.

### Graph (Obsidian's superpower over plain rg)

- `backlinks` — notes linking TO this one (`args: { file: "My Note", counts: true, format: "json" }`).
- `links` — outgoing links from a note (`args: { file: "My Note" }`).
- `orphans` — notes with no incoming links.
- `deadends` — notes with no outgoing links.
- `unresolved` — wikilinks pointing at non-existent notes (`args: { counts: true, verbose: true }`).

### Write / edit

- `create` — new note (`args: { name: "Title", path: "folder/title.md", content: "...", open: true }`; `overwrite: true` to replace; `template: "name"` to apply a template).
- `append` / `prepend` — add to existing (`args: { file: "My Note", content: "..." }`; `inline: true` skips the trailing newline).
- `property:set` — set frontmatter (`args: { name: "status", value: "done", type: "text", file: "My Note" }`; type: text|list|number|checkbox|date|datetime).
- `property:remove` — remove a frontmatter key.
- `move` — move/rename (`args: { path: "old.md", to: "new-folder/" }`).
- `rename` — rename in place (`args: { file: "My Note", name: "New Name" }`).
- `delete` — trashes by default. **`permanent: true` is refused by the tool** (unrecoverable); run such deletions via `bash` with explicit user confirmation.
- `unique` — create a note with a unique name.

### Daily notes

- `daily:read` — read today's daily note.
- `daily:path` — get the daily note path.
- `daily:append` / `daily:prepend` — add to today's daily note (`args: { content: "..." }`).

### Tasks

- `tasks` — list tasks (`args: { done: true }` for completed, `todo: true` for incomplete, `verbose: true, format: "json" }`).
- `task` — show/update one task (`args: { path: "note.md", line: 12, toggle: true }`; or `done: true` / `todo: true`).

### Vault metadata

- `vaults` — list registered vaults (`args: { verbose: true }`). Run this first to confirm the CLI is alive and to see vault names/paths.
- `vault` — info about the active vault (`args: { info: "path" }`; info: name|path|files|folders|size).
- `version` — Obsidian version.

## Pitfalls

- **Do NOT use the MCP gateway** — there is no MCP server for obsidian. Always use the `obsidian` tool (or `bash` with `obsidian ...`).
- The CLI only works when the Obsidian app is **running** and the CLI is **enabled**. If the tool returns "Command line interface is not enabled", tell the user to enable it (Settings > General > Advanced) and restart the app — then fall back to `rg` over the vault folder. Do NOT retry the CLI in a loop.
- Only `flat` is a registered vault. `hermes`, `Lx`, `work` are **folders** inside it — target them with `args.path: "hermes/..."`, NOT `vault: "hermes"`.
- `file` resolves by name (wikilink/alias aware) and may match **multiple** notes — check the output for ambiguity. `path` is exact. For write operations (property:set, delete, move) always use the exact `path` from a prior search to avoid acting on the wrong note.
- Search defaults to `text` format which is hard to parse; always pass `format: "json"` for structured results, or use `search:context` when you need to see the matching line.
- `delete permanent` is refused by the tool. Use default `delete` (recoverable) or run via `bash` with explicit user confirmation.
- `search` returns filenames; to read the matched note you need a second `read` call with the returned path/name.

## Fallback (CLI down or app not running)

The vault is a plain markdown folder, so `rg` works directly. Vault root: `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/flat/`. Wikilinks look like `[[Note Name]]` or `[[Note Name|alias]]`; frontmatter is YAML between `---` fences. This gives text search + read but **not** graph traversal (backlinks/links/orphans) — for those, the CLI must be alive.

## Verification

1. `obsidian` tool with `command: "vaults", args: { verbose: true }` exits 0 and lists the `flat` vault.
2. A known search returns hits: `command: "search", args: { query: "Mistral", vault: "flat", limit: 3, format: "json" }`.
3. `command: "read", args: { file: "<name>", vault: "flat" }` returns the note body for a name returned by search.
4. For write ops, re-read the note with `command: "read", args: { path: "<path>" }` to confirm the change landed before reporting success.
