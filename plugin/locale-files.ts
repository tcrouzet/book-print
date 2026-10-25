import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { defaultMessages, setTranslations, t, type Locale } from "./i18n.ts";

export async function loadTranslationFiles(directory: string): Promise<string[]> {
	const errors: string[] = [];
	for (const language of Object.keys(defaultMessages) as Locale[]) {
		setTranslations(language, {});
		const filename = path.join(directory, language + ".json");
		try {
			await mkdir(directory, { recursive: true });
			try { await writeFile(filename, JSON.stringify(defaultMessages[language], null, 2) + "\n", { flag: "wx" }); }
			catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
			const value: unknown = JSON.parse(await readFile(filename, "utf8"));
			setTranslations(language, value);
		} catch (error) {
			errors.push(t("translationFileError", { file: filename, error: error instanceof Error ? error.message : String(error) }));
		}
	}
	return errors;
}
