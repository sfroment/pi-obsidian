// SPDX-License-Identifier: GPL-3.0
// pi-obsidian — a Pi extension for the Obsidian CLI.
// Copyright (C) 2026 Sacha Froment

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateTail,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

const baseDir = dirname(fileURLToPath(import.meta.url));
const skillPath = join(baseDir, "skill", "SKILL.md");

/**
 * Commands exposed by the obsidian CLI, grouped for readability.
 * This enum is the single source of truth for the tool's `command` parameter.
 *
 * Keep in sync with `obsidian --help`. Omitted here intentionally:
 *  - developer/dev:* commands (not useful to the agent)
 *  - plugin/theme/snippet/workspace management (rare, UI-centric)
 *  - base:* (Bases are a newer feature; add when needed)
 *
 * `write` is NOT a real obsidian CLI command — it is an alias accepted by this
 * tool and translated to `create` with the `overwrite` flag, because models
 * habitually reach for a `write` command that does not exist.
 */
const COMMANDS = [
	// vault + metadata
	"vaults",
	"vault",
	"version",
	// search
	"search",
	"search:context",
	// read / browse
	"read",
	"files",
	"folders",
	"folder",
	"file",
	"outline",
	"tags",
	"tag",
	"properties",
	"property:read",
	"aliases",
	"recents",
	// graph
	"backlinks",
	"links",
	"orphans",
	"deadends",
	"unresolved",
	// write / edit
	"create",
	"append",
	"prepend",
	"property:set",
	"property:remove",
	"move",
	"rename",
	"delete",
	"unique",
	// daily notes
	"daily:read",
	"daily:path",
	"daily:append",
	"daily:prepend",
	// tasks
	"tasks",
	"task",
	// templates
	"templates",
	"template:read",
	// bookmarks
	"bookmarks",
	"bookmark",
	// misc
	"open",
	"reload",
	"restart",
	// tool-level alias (not a CLI command): `write` → `create` + `overwrite`
	"write",
] as const;

type ObsidianCommand = (typeof COMMANDS)[number];

const RELEVANT_PROMPT =
	/\b(obsidian|vault|my notes?|daily note|backlinks?|wikilinks?|frontmatter|properties|orphan notes?|deadend|unresolved links?)\b/i;

const CLI_NOT_ENABLED = /command line interface is not enabled/i;

/**
 * The obsidian CLI reports some failures (e.g. reading a missing file) on
 * stdout with exit code 0. Without sniffing, these come back as successes.
 * The CLI prints its errors at the START of stdout, so only the first line
 * is tested — matching anywhere would misflag legitimate note bodies that
 * happen to contain "Error:" or "File ... not found" prose.
 */
const CLI_ERROR_PATTERNS = [/^Error:\s+/i, /^File\s+[^\n]*\s+not found\.?/i];

/**
 * Guidance injected into the system prompt when the user's message looks
 * obsidian-related. Kept short — the full reference lives in the SKILL.md.
 */
const OBSIDIAN_GUIDANCE = `## Obsidian guidance

The \`obsidian\` tool calls the local Obsidian CLI directly (NOT an MCP server). The Obsidian desktop app must be running with the CLI enabled (Settings > General > Advanced). If the tool returns "Command line interface is not enabled", tell the user to enable it and restart Obsidian, then fall back to \`rg\` over the vault folder.

Key commands (pass as \`command\`; flags go in \`args\` as key/value):
- Search: \`search\` (filenames) or \`search:context\` (matching lines). Always set \`args.format="json"\` and \`args.limit\`.
- Read a note: \`read\` with \`args.file="<name>"\` (wikilink-style, alias-aware) or \`args.path="folder/note.md"\` (exact).
- Graph: \`backlinks\`, \`links\`, \`orphans\`, \`deadends\`, \`unresolved\` — features \`rg\` cannot provide.
- Write: \`create\`, \`append\`, \`prepend\`, \`property:set\`, \`delete\`. For writes, use the exact \`path\` from a prior search/read to avoid acting on the wrong note. \`write\` is accepted as an alias for \`create\` with \`overwrite\`.
- Daily notes: \`daily:read\`, \`daily:append\`.

Run \`vaults\` (with \`args.verbose\`) first to discover registered vault names. The tool defaults to the active vault when \`vault\` is omitted.`;

export type ObsidianParams = {
	command: ObsidianCommand;
	args?: Record<string, string | number | boolean>;
	vault?: string;
	timeoutSeconds?: number;
};

/**
 * Serialize the args map into the obsidian CLI's `key=value` token format.
 * Each token becomes one argv element, so values with spaces need no shell
 * quoting — the process receives them as a single argument.
 *
 * Booleans become bare flags (e.g. `{ counts: true }` → `"counts"`).
 * Numbers are stringified.
 */
export function buildArgv(params: ObsidianParams): string[] {
	// `write` is a tool-level alias: the CLI has no write command, so it maps
	// to `create` with `overwrite` (the CLI's canonical way to replace a note).
	const command = params.command === "write" ? "create" : params.command;
	const argv: string[] = [command];
	const args: Record<string, string | number | boolean> = { ...(params.args ?? {}) };
	if (params.command === "write") {
		// Explicit opt-out — respect it, including wrong-typed variants (a
		// string "false" or 0 must never fall through to forcing overwrite).
		if (args.overwrite === false || args.overwrite === "false" || args.overwrite === 0) {
			delete args.overwrite;
		} else {
			args.overwrite = true;
		}
	}
	for (const [key, value] of Object.entries(args)) {
		if (value === false || value === null || value === undefined) continue;
		if (value === true) {
			argv.push(key);
		} else {
			argv.push(`${key}=${String(value)}`);
		}
	}
	if (params.vault) {
		argv.push(`vault=${params.vault}`);
	}
	return argv;
}

/**
 * Destructive or hard-to-reverse operations. The tool refuses these unless the
 * caller sets the corresponding explicit-opt-in flag in args, which keeps the
 * LLM from nuking a note by accident. For `delete permanent` we additionally
 * surface a clear reason.
 *
 * `append`/`prepend` without an explicit `path`/`file` target whatever note is
 * currently active in the Obsidian app — a silent wrong-note footgun — so the
 * tool requires explicit targeting for them.
 */
export function assertSafeCommand(params: ObsidianParams): void {
	const args = params.args ?? {};
	if (params.command === "delete" && args.permanent === true) {
		throw new Error(
			"Refusing `delete permanent` from the obsidian tool — it skips the trash and is unrecoverable. " +
				"Run the deletion via `bash` with explicit user confirmation, or drop the `permanent` flag " +
				"to use the recoverable trash.",
		);
	}
	if ((params.command === "append" || params.command === "prepend") && !args.path && !args.file) {
		throw new Error(
			`\`${params.command}\` without an explicit \`path\` or \`file\` arg appends to whatever note is currently ` +
				"active in the Obsidian app — often the wrong note. Pass `args.path` (exact) or `args.file` " +
			"(wikilink-style) to target the note explicitly.",
		);
	}
	// Whitespace-only targets pass the truthiness check above but would serialize
	// as an effectively-absent `path=`/`file=` — falling back to the active note.
	if (params.command === "append" || params.command === "prepend") {
		const target = String(args.path ?? args.file ?? "");
		if (!target.trim()) {
			throw new Error(
				`\`${params.command}\` requires a non-blank \`path\` or \`file\` arg — a whitespace-only value ` +
					"would fall back to the note currently active in the Obsidian app.",
			);
		}
	}
}

export function formatOutput(stdout: string, stderr: string): string {
	const chunks: string[] = [];
	if (stdout.trim().length > 0) chunks.push(stdout.trimEnd());
	if (stderr.trim().length > 0) chunks.push(`stderr:\n${stderr.trimEnd()}`);
	return chunks.join("\n\n") || "(no output)";
}

/** Result shape returned by `pi.exec` (and by the injected exec in tests). */
export type ExecResult = { stdout?: string; stderr?: string; code?: number | null; killed?: boolean };

/** System boundary: spawns the obsidian CLI. Injected for testing. */
export type ObsidianExec = (
	command: string,
	args: string[],
	options: { signal?: AbortSignal; timeout?: number },
) => Promise<ExecResult>;

/**
 * Core execution logic, separated from the Pi tool wiring so it can be tested
 * with an injected `exec` (the only system boundary). Returns the same shape
 * as a Pi tool result.
 */
export async function runObsidian(
	params: ObsidianParams,
	exec: ObsidianExec,
	signal?: AbortSignal,
): Promise<{
	content: { type: "text"; text: string }[];
	details: Record<string, unknown>;
	isError: boolean;
}> {
	if (!params.command) {
		throw new Error("Pass an obsidian command, for example `command: 'vaults'` or `command: 'search'`.");
	}
	assertSafeCommand(params);

	const argv = buildArgv(params);
	const timeoutSeconds = Math.min(Math.max(params.timeoutSeconds ?? 30, 1), 120);

	let result: ExecResult;
	try {
		result = await exec("obsidian", argv, { signal, timeout: timeoutSeconds * 1000 });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to run obsidian CLI. Is it installed and on PATH? ${message}`);
	}

	const stdout = result.stdout ?? "";
	const stderr = result.stderr ?? "";
	const code = result.code;

	// Detect the common "CLI not enabled" failure and give actionable guidance.
	if (code !== 0 && (CLI_NOT_ENABLED.test(stdout) || CLI_NOT_ENABLED.test(stderr))) {
		return {
			content: [
				{
					type: "text",
					text:
						"Obsidian CLI is not enabled. The Obsidian desktop app must be running with the CLI enabled " +
						"(Settings > General > Advanced > Enable Command Line Interface), then restart Obsidian.\n\n" +
						"Until then, you can fall back to `rg` over the vault folder on disk (the vault filesystem path " +
						"is shown in the Obsidian app settings, or via the `vault` command with `info: \"path\"` once the CLI is back). " +
						"That gives text search + read, but not graph features (backlinks, links, orphans).",
				},
			],
			details: { command: params.command, code, cliNotEnabled: true },
			isError: true,
		};
	}

	// Some CLI failures print "Error: ..." (e.g. "File ... not found.") on stdout
	// while still exiting 0. Sniff the FIRST LINE ONLY so they are not reported
	// as success — while note bodies that merely mention errors stay successes.
	const firstLine = stdout.split("\n", 1)[0] ?? "";
	const cliErrorMatch = CLI_ERROR_PATTERNS.some((re) => re.test(firstLine));

	const output = formatOutput(stdout, stderr);
	const truncation = truncateTail(output, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	});
	const commandLine = `obsidian ${argv.join(" ")}`;
	const codeText = code === null || code === undefined ? "unknown" : String(code);
	let text = `Command: ${commandLine}\nExit code: ${codeText}${result.killed ? " (killed)" : ""}\n\n${truncation.content}`;
	if (truncation.truncated) {
		text += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).]`;
	}

	return {
		content: [{ type: "text", text }],
		details: {
			command: params.command,
			argv,
			code,
			killed: result.killed,
			truncated: truncation.truncated,
			cliErrorDetected: cliErrorMatch || undefined,
		},
		isError: code !== 0 || cliErrorMatch,
	};
}

export default function obsidianExtension(pi: ExtensionAPI) {
	// Make the bundled SKILL.md discoverable as a skill.
	pi.on("resources_discover", () => ({
		skillPaths: [skillPath],
	}));

	// Inject concise guidance when the prompt looks obsidian-related.
	pi.on("before_agent_start", (event) => {
		if (!RELEVANT_PROMPT.test(event.prompt)) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${OBSIDIAN_GUIDANCE}\n`,
		};
	});

	pi.registerTool({
		name: "obsidian",
		label: "Obsidian",
		description:
			"Call the local Obsidian CLI to search, read, browse, and edit an Obsidian vault. " +
			"This is a direct command-line tool (NOT an MCP server). The Obsidian desktop app must be running with the CLI enabled. " +
			"Pass the CLI command as `command` and its key=value flags as `args`. " +
			"Examples: search notes (`command: 'search'`, `args: {query: 'design', format: 'json', limit: 10}`), " +
			"read a note (`command: 'read'`, `args: {file: 'My Note'}`), " +
			"list backlinks (`command: 'backlinks'`, `args: {file: 'My Note', counts: true, format: 'json'}`).",
		promptSnippet:
			"Search, read, browse, and edit an Obsidian vault via the local obsidian CLI (direct, not MCP).",
		promptGuidelines: [
			"Use the `obsidian` tool when the user asks about their Obsidian vault — notes, tags, backlinks, frontmatter, daily notes. It calls the local obsidian CLI directly, not an MCP server.",
			"Always pass `args.format = 'json'` for search/tags/properties/backlinks so results are structured; the default text format is hard to parse.",
			"Use `args.file = '<name>'` for wikilink-style resolution (alias-aware) and `args.path = 'folder/note.md'` for exact paths. For write operations, use the exact `path` from a prior search to avoid acting on the wrong note.",
			"If the tool reports the CLI is not enabled, tell the user to enable it in Obsidian Settings > General > Advanced and restart the app, then fall back to `rg` over the vault folder.",
		],
		parameters: Type.Object({
			command: StringEnum(COMMANDS, {
				description:
					"Obsidian CLI command to run. Common: search, search:context, read, files, folders, outline, tags, properties, property:read, property:set, backlinks, links, orphans, deadends, unresolved, create, append, prepend, move, rename, delete, daily:read, daily:append, tasks, vaults, vault. `write` is an alias for `create` with `overwrite: true` (pass `overwrite: false` to opt out). Run `obsidian help <command>` via bash for full flag reference.",
			}),
			args: Type.Optional(
				Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean()]), {
					description:
						"Command flags as a key/value map. Booleans become bare flags (e.g. `{counts: true}` → `counts`). Strings become `key=value` tokens (e.g. `{query: 'design', format: 'json', limit: 10}`). Use `file` for wikilink-style name resolution, `path` for exact paths, `vault` is handled separately. Use `\\n` for newlines and `\\t` for tabs inside `content` values.",
				}),
			),
			vault: Type.Optional(
				Type.String({
					description:
						"Target vault by name. Defaults to the active/last-opened vault. Run `vaults` with `args.verbose` to list registered vaults.",
				}),
			),
			timeoutSeconds: Type.Optional(
				Type.Integer({
					minimum: 1,
					maximum: 120,
					default: 30,
					description: "Command timeout in seconds (default 30, max 120).",
				}),
			),
		}),
		async execute(_toolCallId, params: ObsidianParams, signal) {
			return runObsidian(params, (cmd, args, opts) => pi.exec(cmd, args, opts), signal);
		},
	});
}
