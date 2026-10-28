import { t } from "./i18n.ts";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { detectFontFace } from "./font-metadata.ts";
import type { FontFaceInfo } from "./presentation.ts";

export interface ImportedFont { name: string; data: Uint8Array; face?: FontFaceInfo }
export interface ProjectFile {
	name: "bookbinder.md";
	content: string;
	yaml: string;
	body: string;
}

export function projectYaml(data: Record<string, unknown>, stringifyYaml: (data: unknown) => string): string {
	const sections = ["fusion", "pdf", "docx", "epub"];
	const ordered = Object.fromEntries([
		...Object.entries(data).filter(([name]) => !sections.includes(name)),
		...sections.filter(name => Object.prototype.hasOwnProperty.call(data, name)).map(name => [name, data[name]] as const),
	]);
	const prefix = "bookbinder_" + randomUUID().replace(/-/g, "") + "_", strings: string[] = [], visited = new Map<object, unknown>();
	// Obsidian's YAML API has no option to force quoted strings.
	const protect = (value: unknown): unknown => {
		if (value instanceof Date) value = value.toISOString();
		if (typeof value === "string") {
			const index = strings.push(JSON.stringify(value).replace(/[\u0085\u2028\u2029]/g, character => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"))) - 1;
			return prefix + index;
		}
		if (!value || typeof value !== "object") return value;
		if (visited.has(value)) return visited.get(value);
		const result: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {};
		visited.set(value, result);
		for (const [key, item] of Object.entries(value)) Object.defineProperty(result, key, { value: protect(item), enumerable: true, writable: true, configurable: true });
		return result;
	};
	return stringifyYaml(protect(ordered)).replace(new RegExp('["\x27]?' + prefix + '(\\d+)["\x27]?', "g"), (_match, index: string) => strings[Number(index)]);
}

export async function readProjectFile(directory: string): Promise<ProjectFile | undefined> {
	let content: string;
	try { content = await readFile(path.join(directory, "bookbinder.md"), "utf8"); }
	catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
	return { name: "bookbinder.md", content, ...projectFrontmatter(content, "bookbinder.md") };
}

export function projectFrontmatter(content: string, filename: string): { yaml: string; body: string } {
	const frontmatter = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m.exec(content);
	if (!frontmatter || frontmatter.index !== 0) throw new Error(t("filenameMustStartWithYamlPropertiesBetweenTwoLines", { filename }));
	return { yaml: frontmatter[1], body: content.slice(frontmatter[0].length) };
}

export async function loadFont(filename: string): Promise<ImportedFont> {
	const name = path.basename(filename);
	if (!/\.(otf|ttf|woff2?)$/i.test(name)) throw new Error(t("chooseAnOtfTtfWoffOrWoff2Font"));
	let data: Buffer;
	try { data = await readFile(filename); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(t("fontNotInstalled", { font: name }));
		throw error;
	}
	const signature = data.subarray(0, 4).toString("hex");
	if (!["4f54544f", "00010000", "74727565", "774f4646", "774f4632"].includes(signature)) throw new Error(t("unreadableFontFilename", { filename: name }));
	return { name, data, face: detectFontFace(data) };
}

export async function saveProjectFile(directory: string, yaml: string, expected: ProjectFile | undefined, body?: string): Promise<void> {
	const checkUnchanged = async () => {
		const current = await readProjectFile(directory);
		if (current?.content !== expected?.content) throw new Error(t("projectChangedElsewhere"));
	};
	await checkUnchanged();
	const temporary = await mkdtemp(path.join(directory, ".bookbinder-project-"));
	try {
		await checkUnchanged();
		const staged = path.join(temporary, "bookbinder.md");
		body ??= expected?.body ?? t("projectEditlink");
		await writeFile(staged, `---\n${yaml.trimEnd()}\n---\n${body}`);
		if (!expected) await copyFile(staged, path.join(directory, "bookbinder.md"), constants.COPYFILE_EXCL);
		else await rename(staged, path.join(directory, "bookbinder.md"));
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}
