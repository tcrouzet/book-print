import { remote } from "electron";

export async function chooseOutputDirectory(defaultPath?: string, title = "Choisir le dossier de génération"): Promise<string | undefined> {
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
