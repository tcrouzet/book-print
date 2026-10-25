import { t } from "./i18n.ts";
import { remote } from "electron";
import * as path from "node:path";
import type { ExistingOutputChoice } from "./output";

export async function confirmOverwrite(filename: string): Promise<ExistingOutputChoice> {
	const result = await remote.dialog.showMessageBox({
		type: "question", title: t("theFileAlreadyExists"), message: t("filenameAlreadyExists", { filename: path.basename(filename) }),
		detail: t("replaceThisFileOrSaveANewNumberedVersion"),
		buttons: [t("replace"), t("createAVersion"), t("cancel")], defaultId: 0, cancelId: 2,
	});
	return result.response === 0 ? "replace" : result.response === 1 ? "version" : "cancel";
}

export async function chooseOutputDirectory(defaultPath?: string, title = t("chooseTheOutputFolder")): Promise<string | undefined> {
	const result = await remote.dialog.showOpenDialog({
		title,
		defaultPath,
		properties: ["openDirectory", "createDirectory"],
	});
	return result.canceled ? undefined : result.filePaths[0];
}

export async function chooseFiles(title: string, extensions: string[], multiple = false): Promise<string[]> {
	const result = await remote.dialog.showOpenDialog({ title, properties: multiple ? ["openFile", "multiSelections"] : ["openFile"], filters: [{ name: title, extensions }] });
	return result.canceled ? [] : result.filePaths;
}
