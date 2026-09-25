// SPDX-License-Identifier: GPL-3.0
// pi-obsidian — tests. Copyright (C) 2026 Sacha Froment

import { describe, expect, test, mock } from "bun:test";
import {
	assertSafeCommand,
	buildArgv,
	formatOutput,
	normalizeObsidianParams,
	runObsidian,
	type ExecResult,
	type ObsidianExec,
	type ObsidianParams,
} from "./index.ts";

/**
 * Fake exec: returns a canned ExecResult, recording the call so tests can
 * assert on the argv that was built. This is the only system boundary mocked
 * (per the TDD mocking skill — mock at boundaries, never internal collaborators).
 */
function makeFakeExec(result: ExecResult): ObsidianExec & { calls: Parameters<ObsidianExec>[] } {
	const calls: Parameters<ObsidianExec>[] = [];
	const fn = mock(async (_cmd: string, args: string[], opts) => {
		calls.push([_cmd, args, opts]);
		return result;
	}) as unknown as ObsidianExec & { calls: Parameters<ObsidianExec>[] };
	fn.calls = calls;
	return fn;
}

describe("normalizeObsidianParams", () => {
	test("args passed as a JSON object string is parsed to a record", () => {
		const params = normalizeObsidianParams({
			command: "search",
			args: '{"query":"design","format":"json","limit":3}',
		});
		expect(params).toEqual({
			command: "search",
			args: { query: "design", format: "json", limit: 3 },
		});
	});

	test("args passed as key=value text is parsed to a record", () => {
		const params = normalizeObsidianParams({
			command: "search",
			args: "query=my design format=json",
		});
		expect(params).toEqual({
			command: "search",
			args: { query: "my design", format: "json" },
		});
	});

	test("a bare leading token in key=value text becomes a boolean flag", () => {
		const params = normalizeObsidianParams({
			command: "vaults",
			args: "verbose",
		});
		expect(params).toEqual({ command: "vaults", args: { verbose: true } });
	});

	test("command nested inside args is hoisted to top level", () => {
		const params = normalizeObsidianParams({
			args: { command: "create", args: { path: "notes/a.md", content: "x" } },
		});
		expect(params).toEqual({ command: "create", args: { path: "notes/a.md", content: "x" } });
	});

	test("flags inline next to a nested command are kept as args", () => {
		const params = normalizeObsidianParams({
			args: { command: "create", path: "notes/a.md", content: "x" },
		});
		expect(params).toEqual({ command: "create", args: { path: "notes/a.md", content: "x" } });
	});

	test("an unknown nested command value throws a clear error", () => {
		expect(() => normalizeObsidianParams({ args: { command: "explode", path: "a.md" } })).toThrow(
			/unknown command "explode"/i,
		);
	});

	test("property:set flattens a properties object into sibling args", () => {
		const params = normalizeObsidianParams({
			command: "property:set",
			args: { file: "note-123", properties: { assignee: "[[Author]]", issue: "note-123" } },
		});
		expect(params).toEqual({
			command: "property:set",
			args: { file: "note-123", assignee: "[[Author]]", issue: "note-123" },
		});
	});

	test("edit with content maps to the write alias", () => {
		const params = normalizeObsidianParams({
			command: "edit",
			args: { file: "notes/a.md", content: "new body" },
		});
		expect(params).toEqual({ command: "write", args: { file: "notes/a.md", content: "new body" } });
	});

	test("edit with old_string/new_string and no content throws guidance toward write", () => {
		expect(() =>
			normalizeObsidianParams({ command: "edit", args: { file: "n.md", old_string: "a", new_string: "b" } }),
		).toThrow(/read.*write|write/i);
	});
});

describe("buildArgv", () => {
	test("command alone produces single-element argv", () => {
		expect(buildArgv({ command: "vaults" })).toEqual(["vaults"]);
	});

	test("string args become key=value tokens", () => {
		const argv = buildArgv({
			command: "search",
			args: { query: "design", format: "json", limit: 10 },
		});
		expect(argv).toEqual(["search", "query=design", "format=json", "limit=10"]);
	});

	test("boolean true becomes a bare flag", () => {
		const argv = buildArgv({
			command: "backlinks",
			args: { file: "My Note", counts: true, format: "json" },
		});
		expect(argv).toContain("counts");
		expect(argv).not.toContain("counts=true");
		expect(argv).toEqual(["backlinks", "file=My Note", "counts", "format=json"]);
	});

	test("boolean false is omitted", () => {
		const argv = buildArgv({
			command: "tags",
			args: { counts: false, format: "json" },
		});
		expect(argv).not.toContain("counts");
		expect(argv).not.toContain("counts=false");
	});

	test("values with spaces need no shell quoting (argv boundary)", () => {
		const argv = buildArgv({
			command: "read",
			args: { file: "My Cool Note" },
		});
		expect(argv).toEqual(["read", "file=My Cool Note"]);
	});

	test("vault is appended as vault=<name> after args", () => {
		const argv = buildArgv({
			command: "search",
			args: { query: "x" },
			vault: "myvault",
		});
		expect(argv).toEqual(["search", "query=x", "vault=myvault"]);
	});

	test("null and undefined args values are skipped", () => {
		const argv = buildArgv({
			command: "search",
			args: { query: "x", path: undefined as unknown as string, limit: null as unknown as number },
		});
		expect(argv).toEqual(["search", "query=x"]);
	});
});

describe("assertSafeCommand", () => {
	test("delete without permanent is allowed", () => {
		expect(() => assertSafeCommand({ command: "delete", args: { file: "Note" } })).not.toThrow();
	});

	test("delete permanent is refused", () => {
		expect(() =>
			assertSafeCommand({ command: "delete", args: { file: "Note", permanent: true } }),
		).toThrow(/delete permanent/);
	});

	test("non-delete commands are never refused", () => {
		expect(() => assertSafeCommand({ command: "search", args: { permanent: true } })).not.toThrow();
	});
});

describe("buildArgv — write alias", () => {
	test("write maps to create with overwrite", () => {
		expect(buildArgv({ command: "write", args: { path: "notes/a.md", content: "x" } })).toEqual([
			"create",
			"path=notes/a.md",
			"content=x",
			"overwrite",
		]);
	});

	test("write with string 'false' overwrite opts out (plain create)", () => {
		expect(buildArgv({ command: "write", args: { path: "a.md", overwrite: "false" } })).toEqual([
			"create",
			"path=a.md",
		]);
	});

	test("write with numeric 0 overwrite opts out (plain create)", () => {
		expect(buildArgv({ command: "write", args: { path: "a.md", overwrite: 0 } })).toEqual([
			"create",
			"path=a.md",
		]);
	});

	test("write with overwrite:false opts out (plain create)", () => {
		expect(buildArgv({ command: "write", args: { path: "notes/a.md", overwrite: false } })).toEqual([
			"create",
			"path=notes/a.md",
		]);
	});

	test("write does not clobber a caller-supplied overwrite:true", () => {
		expect(buildArgv({ command: "write", args: { path: "a.md", overwrite: true } })).toEqual([
			"create",
			"path=a.md",
			"overwrite",
		]);
	});

	test("vault flag survives the write alias", () => {
		expect(buildArgv({ command: "write", args: { path: "a.md" }, vault: "myvault" })).toEqual([
			"create",
			"path=a.md",
			"overwrite",
			"vault=myvault",
		]);
	});
});

describe("assertSafeCommand — append/prepend targeting", () => {
	test("append without path/file is refused", () => {
		expect(() => assertSafeCommand({ command: "append", args: { content: "x" } })).toThrow(
			/path|file/,
		);
	});

	test("prepend without path/file is refused", () => {
		expect(() => assertSafeCommand({ command: "prepend", args: { content: "x" } })).toThrow(
			/path|file/,
		);
	});

	test("append with empty-string path is refused", () => {
		expect(() => assertSafeCommand({ command: "append", args: { path: "", content: "x" } })).toThrow(
			/non-blank|path.*file/,
		);
	});

	test("append with whitespace-only path is refused", () => {
		expect(() => assertSafeCommand({ command: "append", args: { path: "   ", content: "x" } })).toThrow(
			/non-blank/,
		);
	});

	test("prepend with whitespace-only file is refused", () => {
		expect(() => assertSafeCommand({ command: "prepend", args: { file: "  \t", content: "x" } })).toThrow(
			/non-blank/,
		);
	});

	test("append with path is allowed", () => {
		expect(() => assertSafeCommand({ command: "append", args: { path: "n.md", content: "x" } })).not.toThrow();
	});

	test("append with file is allowed", () => {
		expect(() => assertSafeCommand({ command: "append", args: { file: "My Note", content: "x" } })).not.toThrow();
	});

	test("daily:append is exempt (targets the daily note by design)", () => {
		expect(() => assertSafeCommand({ command: "daily:append", args: { content: "x" } })).not.toThrow();
	});

	test("daily:prepend is exempt (targets the daily note by design)", () => {
		expect(() => assertSafeCommand({ command: "daily:prepend", args: { content: "x" } })).not.toThrow();
	});

	test("prepend with path is allowed", () => {
		expect(() => assertSafeCommand({ command: "prepend", args: { path: "n.md", content: "x" } })).not.toThrow();
	});

	test("prepend with file is allowed", () => {
		expect(() => assertSafeCommand({ command: "prepend", args: { file: "My Note", content: "x" } })).not.toThrow();
	});
});

describe("formatOutput", () => {
	test("stdout only", () => {
		expect(formatOutput("hello", "")).toBe("hello");
	});

	test("stderr appended with label", () => {
		expect(formatOutput("out", "err")).toBe("out\n\nstderr:\nerr");
	});

	test("empty produces placeholder", () => {
		expect(formatOutput("", "")).toBe("(no output)");
	});

	test("whitespace-only is treated as empty", () => {
		expect(formatOutput("   \n  ", "  ")).toBe("(no output)");
	});
});

describe("runObsidian", () => {
	test("builds argv from params and passes it to exec", async () => {
		const exec = makeFakeExec({ stdout: '["note.md"]', code: 0 });
		await runObsidian(
			{ command: "search", args: { query: "design", format: "json", limit: 3 } },
			exec,
		);
		expect(exec.calls[0][0]).toBe("obsidian");
		expect(exec.calls[0][1]).toEqual(["search", "query=design", "format=json", "limit=3"]);
	});

	test("write alias execs create with overwrite", async () => {
		const exec = makeFakeExec({ stdout: "Overwrote: notes/a.md", code: 0 });
		const res = await runObsidian({ command: "write", args: { path: "notes/a.md", content: "x" } }, exec);
		expect(res.isError).toBe(false);
		expect(exec.calls[0][1]).toEqual(["create", "path=notes/a.md", "content=x", "overwrite"]);
	});

	test("append without path/file is refused before exec is called", async () => {
		const exec = makeFakeExec({ stdout: "", code: 0 });
		await expect(runObsidian({ command: "append", args: { content: "x" } }, exec)).rejects.toThrow(
			/path|file/,
		);
		expect(exec.calls).toHaveLength(0);
	});

	test("write with overwrite:false execs a plain create", async () => {
		const exec = makeFakeExec({ stdout: "Created: notes/a.md", code: 0 });
		const res = await runObsidian({ command: "write", args: { path: "notes/a.md", content: "x", overwrite: false } }, exec);
		expect(res.isError).toBe(false);
		expect(exec.calls[0][1]).toEqual(["create", "path=notes/a.md", "content=x"]);
	});

	test("CLI error on stdout with exit code 0 is still flagged as error", async () => {
		const exec = makeFakeExec({
			stdout: "Error: File notes/missing.md not found.",
			code: 0,
		});
		const res = await runObsidian({ command: "read", args: { path: "notes/missing.md" } }, exec);
		expect(res.isError).toBe(true);
		expect(res.details).toMatchObject({ cliErrorDetected: true });
	});

	test("note body containing a mid-body 'Error:' line stays a success", async () => {
		const noteBody = "# Incident log\n\nSome prose about debugging.\nError: connection reset by peer\nMore prose follows.";
		const exec = makeFakeExec({ stdout: noteBody, code: 0 });
		const res = await runObsidian({ command: "read", args: { path: "notes/incidents.md" } }, exec);
		expect(res.isError).toBe(false);
		expect(res.details.cliErrorDetected).toBeUndefined();
	});

	test("note body containing 'File ... not found' prose stays a success", async () => {
		const noteBody = "A troubleshooting note: if you see `File xyz.md not found.` in the logs, try again.";
		const exec = makeFakeExec({ stdout: noteBody, code: 0 });
		const res = await runObsidian({ command: "read", args: { path: "notes/troubleshooting.md" } }, exec);
		expect(res.isError).toBe(false);
		expect(res.details.cliErrorDetected).toBeUndefined();
	});

	test("CLI error on first line only is flagged", async () => {
		const exec = makeFakeExec({ stdout: "Error: Missing required parameter: query=text", code: 0 });
		const res = await runObsidian({ command: "search", args: { format: "json" } }, exec);
		expect(res.isError).toBe(true);
		expect(res.details).toMatchObject({ cliErrorDetected: true });
	});

	test("plain stdout without CLI error stays a success at exit code 0", async () => {
		const exec = makeFakeExec({ stdout: "[{\"path\":\"a.md\"}]", code: 0 });
		const res = await runObsidian({ command: "search", args: { query: "a" } }, exec);
		expect(res.isError).toBe(false);
		expect(res.details.cliErrorDetected).toBeUndefined();
	});

	test("success result echoes command, exit code, and output", async () => {
		const exec = makeFakeExec({ stdout: '["note.md"]', code: 0 });
		const res = await runObsidian({ command: "vaults", args: { verbose: true } }, exec);
		expect(res.isError).toBe(false);
		expect(res.content[0].text).toContain("Command: obsidian vaults verbose");
		expect(res.content[0].text).toContain("Exit code: 0");
		expect(res.content[0].text).toContain('["note.md"]');
		expect(res.details).toMatchObject({ command: "vaults", code: 0 });
	});

	test("non-zero exit sets isError true and includes exit code", async () => {
		const exec = makeFakeExec({ stdout: "", stderr: "not found", code: 1 });
		const res = await runObsidian({ command: "read", args: { file: "Missing" } }, exec);
		expect(res.isError).toBe(true);
		expect(res.content[0].text).toContain("Exit code: 1");
		expect(res.content[0].text).toContain("not found");
	});

	test("CLI-not-enabled failure returns actionable guidance", async () => {
		const exec = makeFakeExec({
			stdout: "Error: Command line interface is not enabled",
			code: 1,
		});
		const res = await runObsidian({ command: "vaults" }, exec);
		expect(res.isError).toBe(true);
		expect(res.details).toMatchObject({ cliNotEnabled: true });
		expect(res.content[0].text).toContain("CLI is not enabled");
		expect(res.content[0].text).toContain("Settings > General > Advanced");
	});

	test("CLI-not-enabled failure on stderr is also detected", async () => {
		const exec = makeFakeExec({
			stdout: "",
			stderr: "Error: The Obsidian command line interface is not enabled",
			code: 1,
		});
		const res = await runObsidian({ command: "vaults" }, exec);
		expect(res.isError).toBe(true);
		expect(res.details).toMatchObject({ cliNotEnabled: true });
	});

	test("delete permanent is refused before exec is called", async () => {
		const exec = makeFakeExec({ stdout: "", code: 0 });
		await expect(
			runObsidian({ command: "delete", args: { file: "Note", permanent: true } }, exec),
		).rejects.toThrow(/delete permanent/);
		expect(exec.calls).toHaveLength(0);
	});

	test("missing command throws", async () => {
		const exec = makeFakeExec({ stdout: "", code: 0 });
		await expect(runObsidian({} as ObsidianParams, exec)).rejects.toThrow(/obsidian command/);
	});

	test("exec rejection is wrapped with install hint", async () => {
		const failing: ObsidianExec = async () => {
			throw new Error("spawn ENOENT");
		};
		await expect(runObsidian({ command: "vaults" }, failing)).rejects.toThrow(/installed and on PATH/);
	});

	test("large output is truncated and flagged", async () => {
		const huge = Array.from({ length: 5000 }, () => "line of content").join("\n");
		const exec = makeFakeExec({ stdout: huge, code: 0 });
		const res = await runObsidian({ command: "files" }, exec);
		expect(res.details).toMatchObject({ truncated: true });
		expect(res.content[0].text).toContain("Output truncated");
	});

	test("timeout is clamped to 120s max", async () => {
		const exec = makeFakeExec({ stdout: "ok", code: 0 });
		await runObsidian({ command: "vaults", timeoutSeconds: 9999 }, exec);
		expect(exec.calls[0][2].timeout).toBe(120 * 1000);
	});

	test("string args are coerced at the runObsidian boundary", async () => {
		const exec = makeFakeExec({ stdout: "[]", code: 0 });
		const res = await runObsidian({ command: "search", args: '{"query":"design","format":"json"}' }, exec);
		expect(res.isError).toBe(false);
		expect(exec.calls[0][1]).toEqual(["search", "query=design", "format=json"]);
	});

	test("nested command+args form is coerced at the runObsidian boundary", async () => {
		const exec = makeFakeExec({ stdout: "Created: a.md", code: 0 });
		const res = await runObsidian({ args: { command: "create", args: { path: "a.md", content: "x" } } }, exec);
		expect(res.isError).toBe(false);
		expect(exec.calls[0][1]).toEqual(["create", "path=a.md", "content=x"]);
	});

	test("edit with content execs create with overwrite through runObsidian", async () => {
		const exec = makeFakeExec({ stdout: "Overwrote: a.md", code: 0 });
		const res = await runObsidian({ command: "edit", args: { file: "a.md", content: "new" } }, exec);
		expect(res.isError).toBe(false);
		expect(exec.calls[0][1]).toEqual(["create", "file=a.md", "content=new", "overwrite"]);
	});

	test("timeout defaults to 30s", async () => {
		const exec = makeFakeExec({ stdout: "ok", code: 0 });
		await runObsidian({ command: "vaults" }, exec);
		expect(exec.calls[0][2].timeout).toBe(30 * 1000);
	});
});
