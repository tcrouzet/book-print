import { t } from "./i18n.ts";
import { constants } from "node:fs";
import { copyFile, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";

export interface ImportedFont { name: string; data: Uint8Array }
export interface ProjectFile {
	name: "bookbinder.md";
	content: string;
	yaml: string;
	body: string;
}

export function projectYaml(data: Record<string, unknown>, stringifyYaml: (data: unknown) => string): string {
	const sections = ["fusion", "pdf", "docx", "epub"];
	return stringifyYaml(Object.fromEntries([
		...Object.entries(data).filter(([name]) => !sections.includes(name)),
		...sections.filter(name => Object.prototype.hasOwnProperty.call(data, name)).map(name => [name, data[name]]),
	]));
}

export async function readProjectFile(directory: string): Promise<ProjectFile | undefined> {
	let content: string;
	try { content = await readFile(path.join(directory, "bookbinder.md"), "utf8"); }
	catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
	const frontmatter = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m.exec(content);
	if (!frontmatter || frontmatter.index !== 0) throw new Error(t("filenameMustStartWithYamlPropertiesBetweenTwoLines", { filename: "bookbinder.md" }));
	return { name: "bookbinder.md", content, yaml: frontmatter[1], body: content.slice(frontmatter[0].length) };
}

export async function loadFont(filename: string): Promise<ImportedFont> {
	const name = path.basename(filename);
	if (!/\.(otf|ttf|woff2?)$/i.test(name)) throw new Error(t("chooseAnOtfTtfWoffOrWoff2Font"));
	const data = await readFile(filename);
	const signature = data.subarray(0, 4).toString("hex");
	if (!["4f54544f", "00010000", "74727565", "774f4646", "774f4632"].includes(signature)) throw new Error(t("unreadableFontFilename", { filename: name }));
	return { name, data };
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
