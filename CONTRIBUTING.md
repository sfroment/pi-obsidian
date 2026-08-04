# Contributing to pi-obsidian

Thanks for your interest in contributing! This is a small extension, so the process is lightweight.

## Development setup

```bash
git clone git@github.com:sfroment/pi-obsidian.git
cd pi-obsidian
bun install
bun test
```

`bun install` pulls in `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, and `typebox` as devDependencies for type resolution. Locally (where pi is installed globally), `scripts/link-pi-deps.sh` runs as a `pretest` hook and symlinks the global copies into `node_modules/` if the npm-installed ones are missing — in CI it's a no-op.

## Before opening a PR

1. **Tests pass:** `bun test` (all existing tests green, new behavior covered).
2. **Compiles:** `bun build index.ts --no-bundle --outfile /tmp/build.js` succeeds.
3. **No MCP references:** the obsidian CLI is a direct command-line tool, not an MCP server. Don't add `mcp({server: "obsidian", ...})` calls.
4. **License header:** new `.ts` files start with the SPDX header:
   ```ts
   // SPDX-License-Identifier: GPL-3.0
   // pi-obsidian — <short description>. Copyright (C) 2026 Sacha Froment
   ```
5. **Conventional commits:** `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.

## Testing philosophy

Tests mock only the system boundary (`pi.exec`) via dependency injection — `runObsidian(params, exec)` takes the exec function as a parameter. Pure helpers (`buildArgv`, `assertSafeCommand`, `formatOutput`) are tested directly. Don't mock internal collaborators.

## Licensing

By contributing, you agree your contributions are licensed under the [GPL-3.0](LICENSE).

