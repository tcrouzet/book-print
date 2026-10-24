import * as path from "node:path";

export function resolveOutputDirectory(sourcePath: string, configuredDirectory: string): string {
	if (!path.isAbsolute(sourcePath)) throw new Error("Le fichier Markdown doit avoir un chemin absolu.");
	if (configuredDirectory && !path.isAbsolute(configuredDirectory)) throw new Error("Choisissez un dossier avec un chemin absolu.");
	return configuredDirectory || path.dirname(sourcePath);
}
