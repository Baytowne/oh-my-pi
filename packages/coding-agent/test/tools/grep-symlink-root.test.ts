import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { createTools, type ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { removeWithRetries } from "@oh-my-pi/pi-utils";

function createTestSession(cwd: string): ToolSession {
	return {
		cwd,
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated({ "tools.xdev": false }),
	};
}

function getText(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter(entry => entry.type === "text")
		.map(entry => entry.text ?? "")
		.join("\n");
}

describe("grep on a symlinked root", () => {
	let tempDir: string;

	beforeAll(async () => {
		await Settings.init({ inMemory: true });
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "grep-symlink-root-"));
		await fs.mkdir(path.join(tempDir, "real"), { recursive: true });
		await fs.mkdir(path.join(tempDir, "elsewhere"), { recursive: true });
		await Bun.write(path.join(tempDir, "real", "a.txt"), "GREP_MARKER in real\n");
		await Bun.write(path.join(tempDir, "elsewhere", "b.txt"), "GREP_MARKER elsewhere\n");
		await fs.symlink(path.join(tempDir, "real"), path.join(tempDir, "link"), "dir");
		await fs.symlink(path.join(tempDir, "elsewhere"), path.join(tempDir, "real", "nested-link"), "dir");
	});

	afterAll(async () => {
		await removeWithRetries(tempDir);
		resetSettingsForTest();
	});

	async function grep(searchPath: string) {
		const tools = await createTools(createTestSession(tempDir));
		const tool = tools.find(entry => entry.name === "grep");
		if (!tool) throw new Error("Missing grep tool");
		const result = await tool.execute(`grep-symlink-${searchPath}`, { pattern: "GREP_MARKER", path: searchPath });
		return { text: getText(result), details: result.details as { fileCount?: number } | undefined };
	}

	it("follows a root path that is a symlink to a directory", async () => {
		const { text, details } = await grep("link");
		expect(text).toMatch(/^# link\/\n## a\.txt#[0-9A-F]{4}/m);
		expect(text).toContain("GREP_MARKER in real");
		expect(details?.fileCount).toBe(1);
	});

	it("still does not follow symlinks below the root", async () => {
		for (const searchPath of ["link", "real"]) {
			const { text, details } = await grep(searchPath);
			expect(text).not.toContain("nested-link");
			expect(text).not.toContain("GREP_MARKER elsewhere");
			expect(details?.fileCount).toBe(1);
		}
	});
});
