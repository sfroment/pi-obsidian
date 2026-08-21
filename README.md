# pi-obsidian

[![CI](https://github.com/sfroment/pi-obsidian/actions/workflows/ci.yml/badge.svg)](https://github.com/sfroment/pi-obsidian/actions/workflows/ci.yml)
[![Release](https://github.com/sfroment/pi-obsidian/actions/workflows/release.yml/badge.svg)](https://github.com/sfroment/pi-obsidian/actions/workflows/release.yml)
[![npm version](https://img.shields.io/npm/v/@sfroment/pi-obsidian.svg?cacheSeconds=120)](https://www.npmjs.com/package/@sfroment/pi-obsidian)
[![npm downloads](https://img.shields.io/npm/dm/@sfroment/pi-obsidian.svg?cacheSeconds=120)](https://www.npmjs.com/package/@sfroment/pi-obsidian)
[![npm bundle size](https://img.shields.io/bundlephobia/min/@sfroment/pi-obsidian.svg?cacheSeconds=120)](https://bundlephobia.com/package/@sfroment/pi-obsidian)
[![GitHub Release](https://img.shields.io/github/v/release/sfroment/pi-obsidian.svg?cacheSeconds=120)](https://github.com/sfroment/pi-obsidian/releases)
[![GitHub stars](https://img.shields.io/github/stars/sfroment/pi-obsidian.svg?cacheSeconds=120)](https://github.com/sfroment/pi-obsidian/stargazers)
[![GitHub last commit](https://img.shields.io/github/last-commit/sfroment/pi-obsidian.svg?cacheSeconds=120)](https://github.com/sfroment/pi-obsidian/commits)
[![GitHub commits since latest release](https://img.shields.io/github/commits-since/sfroment/pi-obsidian/latest.svg?cacheSeconds=120)](https://github.com/sfroment/pi-obsidian/releases)
[![license](https://img.shields.io/npm/l/@sfroment/pi-obsidian.svg?cacheSeconds=120)](https://github.com/sfroment/pi-obsidian/blob/main/LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-fd4b3a?logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/lang-TypeScript-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

A [Pi](https://github.com/earendil-works/pi-coding-agent) extension for the [Obsidian](https://obsidian.md) CLI — search, read, browse, and edit an Obsidian vault through a typed tool that calls the local `obsidian` CLI directly (**not** via an MCP server).

## Why

Pi can already shell out to the `obsidian` CLI via `bash`, but a bare skill describing CLI flags is easy to misuse: the model reaches for the `mcp` gateway (there is no obsidian MCP server), forgets to set `format=json`, or runs `delete permanent` by accident. This extension packages the CLI behind a typed tool with:

- a **`command` enum** so the model can't typo a subcommand
- an **`args` map** that serializes to the CLI's `key=value` token format (booleans → bare flags, no shell quoting needed)
- **prompt guidance** injected when a prompt mentions obsidian / vault / notes
- a **bundled skill** documenting every command
- **safety guards** — refuses `delete permanent`, detects "CLI not enabled" and returns actionable fallback guidance
- **output truncation** consistent with Pi's built-in tools

## Requirements

- The [`obsidian`](https://help.obsidian.md/Extending+Obsidian/Command+line+interface) CLI on your `PATH` (Settings > General > Advanced > Enable Command Line Interface)
- The Obsidian desktop app running with the CLI enabled

When the CLI is unavailable, the skill instructs the agent to fall back to `rg` over the vault folder.

## Install

### As a Pi package (recommended)

```bash
pi install npm:@sfroment/pi-obsidian
```

Or pin a version:

```bash
pi install npm:@sfroment/pi-obsidian@1.0.0
```

Then `/reload` in Pi. The package appears in the [pi.dev gallery](https://pi.dev/packages) because it's tagged `pi-package` on npm.

### From git

```bash
pi install git:github.com:sfroment/pi-obsidian@v1.0.0
```

### Manually

Copy or symlink this directory into `~/.pi/agent/extensions/obsidian/`, then `/reload`.

## Tool reference

The `obsidian` tool takes:

| param | type | description |
| --- | --- | --- |
| `command` | enum (required) | CLI subcommand: `search`, `search:context`, `read`, `files`, `folders`, `outline`, `tags`, `properties`, `property:read`, `property:set`, `backlinks`, `links`, `orphans`, `deadends`, `unresolved`, `create`, `append`, `prepend`, `move`, `rename`, `delete`, `daily:read`, `daily:append`, `tasks`, `vaults`, `vault`, … |
| `args` | object | Key/value flags. Booleans become bare flags (`{counts: true}` → `counts`). Strings/numbers become `key=value` tokens. Use `\n` for newlines and `\t` for tabs inside `content`. |
| `vault` | string | Target vault by name. Defaults to the active vault. |
| `timeoutSeconds` | int | Default 30, max 120. |

### Examples

```jsonc
// search notes
{ "command": "search", "args": { "query": "mistral", "format": "json", "limit": 10 } }

// read a note (wikilink-style name resolution)
{ "command": "read", "args": { "file": "My Note" } }

// backlinks with counts
{ "command": "backlinks", "args": { "file": "My Note", "counts": true, "format": "json" } }

// append to today's daily note
{ "command": "daily:append", "args": { "content": "- did a thing\n" } }
```

## Develop

```bash
git clone git@github.com:sfroment/pi-obsidian.git
cd pi-obsidian
bun install
bun test
```

The tests mock only the system boundary (`pi.exec`) via dependency injection — `runObsidian(params, exec)` takes the exec function as a parameter, so tests pass a fake that records argv and returns canned results. Internal helpers (`buildArgv`, `assertSafeCommand`, `formatOutput`) are pure and tested directly.

The `pretest` script (`scripts/link-pi-deps.sh`) symlinks the pi runtime packages (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `typebox`) into `node_modules/` so Bun can resolve the extension's imports during tests.

## License

Licensed under the [GNU General Public License v3.0](LICENSE).

## Links

- **Author:** [Sacha Froment](https://sacha42.com)
- **Source:** <https://github.com/sfroment/pi-obsidian>
- **Issues:** <https://github.com/sfroment/pi-obsidian/issues>
