import { constants } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { t } from "./i18n.ts";
import { libraryFontPrefix } from "./presentation.ts";
import { localResource } from "./project.ts";
import type { ImportedFont } from "./project-files.ts";

const extension = /\.(otf|ttf|woff2?)$/i;

function validateName(name: string): void {
	if (!name || path.basename(name) !== name || /[/\\\0]/.test(name)) throw new Error(t("invalidFontName"));
	if (!extension.test(name)) throw new Error(t("chooseAnOtfTtfWoffOrWoff2Font"));
}

export function resolveFont(directory: string, reference: string, libraryDirectory?: string): string {
	if (!reference.startsWith(libraryFontPrefix)) return localResource(directory, reference);
	const name = reference.slice(libraryFontPrefix.length);
	validateName(name);
	if (!libraryDirectory) throw new Error(t("theFontLibraryIsUnavailable"));
	return path.join(libraryDirectory, name);
}

export async function listFontLibrary(directory: string): Promise<string[]> {
	try {
		return (await readdir(directory, { withFileTypes: true })).filter(file => file.isFile() && extension.test(file.name))
			.map(file => libraryFontPrefix + file.name);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

export async function saveLibraryFont(directory: string, font: ImportedFont): Promise<string> {
	validateName(font.name);
	await mkdir(directory, { recursive: true });
	const temporary = await mkdtemp(path.join(directory, ".bookbinder-font-"));
	try {
		const staged = path.join(temporary, font.name);
		await writeFile(staged, font.data);
		try { await copyFile(staged, path.join(directory, font.name), constants.COPYFILE_EXCL); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			if (!(await readFile(path.join(directory, font.name))).equals(Buffer.from(font.data))) throw new Error(t("anotherFontIsAlreadyNamedFontRenameTheFontToImport", { font: font.name }));
		}
		return libraryFontPrefix + font.name;
	} finally { await rm(temporary, { recursive: true, force: true }); }
}
