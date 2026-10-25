import { t } from "./i18n.ts";
import * as path from "node:path";
import { localResource, parseProject } from "./project.ts";
import { projectYaml, readProjectFile, saveProjectFile, type ProjectFile } from "./project-files.ts";
import { libraryFontPrefix } from "./presentation.ts";

export async function cloneProjectFile(filename: string, destination: string, parseYaml: (yaml: string) => unknown, stringifyYaml: (data: unknown) => string): Promise<void> {
	const name = path.basename(filename);
	if (!["bookbinder.md", "book-print.md", "book-print.yml"].includes(name)) throw new Error(t("chooseABookbinderMdBookPrintMdOrBookPrintYmlFile"));
	const directory = path.dirname(filename);
	const source = await readProjectFile(directory, name as ProjectFile["name"]);
	if (!source) throw new Error(t("theSelectedProjectCouldNotBeFound"));
	if (await readProjectFile(destination)) throw new Error(t("thisFolderAlreadyContainsAProjectChooseAnotherFolder"));
	const parsed = parseYaml(source.yaml);
	parseProject(parsed, path.basename(directory));
	const data = (parsed ?? {}) as Record<string, unknown>;
	const resource = (value: unknown, font = false): unknown => {
		if (value === undefined || value === null || value === "") return value;
		if (Array.isArray(value)) return value.map(item => resource(item, font));
		if (typeof value !== "string") throw new Error(t("projectResourcesMustReferToFiles"));
		if (font && value.startsWith(libraryFontPrefix)) return value;
		return localResource(directory, value);
	};
	for (const key of ["cover", "cover-background", "css", "fonts"]) if (data[key] !== undefined) data[key] = resource(data[key], key === "fonts");
	for (const format of ["epub", "pdf", "docx"]) {
		if (data[format] === undefined || data[format] === null) continue;
		parseProject({ epub: data[format] }, path.basename(directory));
		const settings = data[format] as Record<string, unknown>;
		for (const key of ["css", "fonts"]) if (settings[key] !== undefined) settings[key] = resource(settings[key], key === "fonts");
	}
	await saveProjectFile(destination, projectYaml(data, stringifyYaml), undefined, source.name === "book-print.yml" ? undefined : source.body);
}
