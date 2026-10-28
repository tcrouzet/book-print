import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { getLocale, t } from "./i18n.ts";
import { parseProject } from "./project.ts";
import { projectFrontmatter } from "./project-files.ts";

export const modelCatalogUrl = "https://api.github.com/repos/tcrouzet/bookbinder/contents/models?ref=main";
const modelBaseUrl = "https://raw.githubusercontent.com/tcrouzet/bookbinder/main/models/";
export const isModelName = (name: string): boolean => /^[a-zA-Z0-9][a-zA-Z0-9_-]*\.md$/.test(name) && name !== "README.md";

export function parseModel(content: string, filename: string, parseYaml: (yaml: string) => unknown): Record<string, unknown> {
	if (Buffer.byteLength(content, "utf8") > 1024 * 1024) throw new Error(t("invalidProjectModel", { file: filename }));
	const value = parseYaml(projectFrontmatter(content, filename).yaml);
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(t("invalidProjectModel", { file: filename }));
	const data = structuredClone(value) as Record<string, unknown>;
	data.title = ""; data.author = ""; data.rights = "";
	delete data.filename;
	for (const format of ["epub", "pdf", "docx"] as const) parseProject(data, "Model", format);
	return data;
}

export async function listModels(directory: string): Promise<string[]> {
	try { return (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isFile() && isModelName(entry.name)).map(entry => entry.name).sort((a, b) => a.localeCompare(b, getLocale())); }
	catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

export async function readModel(directory: string, name: string, parseYaml: (yaml: string) => unknown, baseModel?: string): Promise<Record<string, unknown>> {
	if (!isModelName(name)) throw new Error(t("invalidProjectModel", { file: name }));
	if (name === "base.md" && baseModel !== undefined) return parseModel(baseModel, name, parseYaml);
	try { return parseModel(await readFile(path.join(directory, name), "utf8"), name, parseYaml); }
	catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(t("projectModelMissing", { file: name })); throw error; }
}

type ModelResponse = { status: number; text: string };
export async function downloadModels(directory: string, request: (url: string) => Promise<ModelResponse>, parseYaml: (yaml: string) => unknown): Promise<void> {
	const download = async (url: string): Promise<string> => {
		const response = await request(url);
		if (response.status !== 200) throw new Error(t("modelDownloadFailed", { status: response.status }));
		if (Buffer.byteLength(response.text, "utf8") > 1024 * 1024) throw new Error(t("invalidModelCatalog"));
		return response.text;
	};
	const catalog: unknown = JSON.parse(await download(modelCatalogUrl));
	if (!Array.isArray(catalog) || catalog.length > 100) throw new Error(t("invalidModelCatalog"));
	const names = new Set<string>();
	for (const entry of catalog as unknown[]) {
		if (!entry || typeof entry !== "object" || !("type" in entry) || entry.type !== "file" || !("name" in entry) || typeof entry.name !== "string" || !entry.name.endsWith(".md") || entry.name === "README.md") continue;
		if (!isModelName(entry.name) || !("path" in entry) || entry.path !== "models/" + entry.name || names.has(entry.name)) throw new Error(t("invalidModelCatalog"));
		names.add(entry.name);
	}
	if (!names.size) throw new Error(t("invalidModelCatalog"));
	const files = new Map<string, string>();
	for (const name of names) {
		const content = await download(modelBaseUrl + name);
		parseModel(content, name, parseYaml);
		try { if (await readFile(path.join(directory, name), "utf8") !== content) throw new Error(t("modelFileConflict", { file: name })); }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
		files.set(name, content);
	}
	await mkdir(directory, { recursive: true });
	for (const [name, content] of files) {
		try { await writeFile(path.join(directory, name), content, { flag: "wx" }); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			if (await readFile(path.join(directory, name), "utf8") !== content) throw new Error(t("modelFileConflict", { file: name }));
		}
	}
}
