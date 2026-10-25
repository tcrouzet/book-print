import { t } from "./i18n.ts";
import * as path from "node:path";
import { constants } from "node:fs";
import { copyFile, lstat, rename } from "node:fs/promises";

export type ExistingOutputChoice = "replace" | "version" | "cancel";

export async function saveGeneratedFile(staged: string, filename: string, confirm?: (filename: string) => Promise<ExistingOutputChoice>): Promise<string | undefined> {
	let exists = false;
	try { await lstat(filename); exists = true; }
	catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
	if (exists) {
		const choice = confirm ? await confirm(filename) : "version";
		if (choice === "cancel") return undefined;
		if (choice === "replace") { await rename(staged, filename); return filename; }
	}
	const { dir, name, ext } = path.parse(filename);
	for (let version = exists ? 2 : 1; ; version++) {
		const output = version === 1 ? filename : path.join(dir, `${name}-${version}${ext}`);
		try { await copyFile(staged, output, constants.COPYFILE_EXCL); return output; }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
	}
}

export function resolveOutputDirectory(sourcePath: string, configuredDirectory: string): string {
	if (!path.isAbsolute(sourcePath)) throw new Error(t("theMarkdownFileMustHaveAnAbsolutePath"));
	if (configuredDirectory && !path.isAbsolute(configuredDirectory)) throw new Error(t("chooseAFolderWithAnAbsolutePath"));
	return configuredDirectory || path.dirname(sourcePath);
}
