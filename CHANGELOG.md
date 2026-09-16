# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `write` command alias: maps to `create` with `overwrite` (the CLI has no `write` command).
- `append`/`prepend` safety guard: requires an explicit non-blank `path` or `file` — without one the CLI silently targets whatever note is active in the app.
- CLI-error sniffing: failures the CLI prints on stdout with exit code 0 (e.g. "File ... not found.") are now flagged `isError` via first-line matching.

### Changed
- Skill/guidance: never construct note paths by hand — search first, then pass the returned path verbatim.
- Removed environment-specific references from docs and packaging (vault names/paths, Homebrew install path, author email domain).
- Made `scripts/link-pi-deps.sh` portable (PI_RUNTIME_DIR override + `npm root -g`, no hardcoded paths).
- Regenerated `bun.lock` against the public npm registry (format v2, no registry URLs); CI and release workflows bumped to bun 1.4 for the new lockfile format.

## [1.0.1] - 2026-08-04

### Changed
- Bump to trigger first npm publish (workflows were added after `v1.0.0` was tagged).

## [1.0.0] - 2026-07-31

### Added
- `obsidian` tool: typed wrapper around the local obsidian CLI with a `command`
  enum, `args` map (booleans → bare flags, no shell quoting), `vault` selector,
  and `timeoutSeconds` clamping.
- Prompt guidance injected when a prompt mentions obsidian / vault / notes.
- Bundled `obsidian` skill documenting every supported command.
- Safety guards: refuses `delete permanent`; detects "CLI not enabled" and
  returns actionable fallback guidance; output truncation.
- 24 tests — pure helpers tested directly, `runObsidian` tested via dependency
  injection at the `pi.exec` system boundary.
- `scripts/link-pi-deps.sh` + `pretest` hook for reproducible test resolution.
- GPL-3.0 license.
