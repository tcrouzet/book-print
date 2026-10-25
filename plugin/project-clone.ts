import { t } from "./i18n.ts";
import * as path from "node:path";
import { localResource, parseProject } from "./project.ts";
import { projectYaml, readProjectFile, saveProjectFile } from "./project-files.ts";
import { libraryFontPrefix } from "./presentation.ts";

export async function cloneProjectFile(filename: string, destination: string, parseYaml: (yaml: string) => unknown, stringifyYaml: (data: unknown) => string): Promise<void> {
	const name = path.basename(filename);
	if (name !== "bookbinder.md") throw new Error(t("chooseABookbinderMdFile"));
	const directory = path.dirname(filename);
	const source = await readProjectFile(directory);
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
	for (const key of ["cover", "cover-background"]) if (data[key] !== undefined) data[key] = resource(data[key]);
	for (const format of ["epub", "pdf", "docx"] as const) {
		if (data[format] === undefined || data[format] === null) continue;
		parseProject(data, path.basename(directory), format);
		const settings = data[format] as Record<string, unknown>;
		for (const key of ["css", "fonts"]) if (settings[key] !== undefined) settings[key] = resource(settings[key], key === "fonts");
	}
	await saveProjectFile(destination, projectYaml(data, stringifyYaml), undefined, source.body);
}
