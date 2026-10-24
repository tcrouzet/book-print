import * as path from "node:path";

export function resolveOutputDirectory(sourcePath: string, configuredDirectory: string): string {
	if (!path.isAbsolute(sourcePath)) throw new Error("Le fichier Markdown doit avoir un chemin absolu.");
	if (configuredDirectory && !path.isAbsolute(configuredDirectory)) throw new Error("Choisissez un dossier avec un chemin absolu.");
	return configuredDirectory || path.dirname(sourcePath);
}

export async function chooseOutputDirectory(defaultPath?: string, title = "Choisir le dossier de génération"): Promise<string | undefined> {
	const { remote } = require("electron") as {
		remote: { dialog: { showOpenDialog(options: {
			title: string;
			defaultPath?: string;
			properties: string[];
		}): Promise<{ canceled: boolean; filePaths: string[] }> } };
	};
	const result = await remote.dialog.showOpenDialog({
		title,
		defaultPath,
		properties: ["openDirectory", "createDirectory"],
	});
	return result.canceled ? undefined : result.filePaths[0];
}
