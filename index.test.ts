// SPDX-License-Identifier: GPL-3.0
// pi-obsidian — tests. Copyright (C) 2026 Sacha Froment

import { describe, expect, test, mock } from "bun:test";
import {
	assertSafeCommand,
	buildArgv,
	formatOutput,
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

describe("buildArgv", () => {
	test("command alone produces single-element argv", () => {
		expect(buildArgv({ command: "vaults" })).toEqual(["vaults"]);
	});

	test("string args become key=value tokens", () => {
		const argv = buildArgv({
			command: "search",
			args: { query: "mistral", format: "json", limit: 10 },
		});
		expect(argv).toEqual(["search", "query=mistral", "format=json", "limit=10"]);
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
			vault: "flat",
		});
		expect(argv).toEqual(["search", "query=x", "vault=flat"]);
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
			{ command: "search", args: { query: "mistral", format: "json", limit: 3 } },
			exec,
		);
		expect(exec.calls[0][0]).toBe("obsidian");
		expect(exec.calls[0][1]).toEqual(["search", "query=mistral", "format=json", "limit=3"]);
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

	test("timeout defaults to 30s", async () => {
		const exec = makeFakeExec({ stdout: "ok", code: 0 });
		await runObsidian({ command: "vaults" }, exec);
		expect(exec.calls[0][2].timeout).toBe(30 * 1000);
	});
});
