export interface BookPrintSettings {
	pandocPath: string;
	latexPath: string;
	outputDirectory: string;
}

export const DEFAULT_SETTINGS: BookPrintSettings = {
	pandocPath: "",
	latexPath: "",
	outputDirectory: "",
};

export function parseSettings(value: unknown): BookPrintSettings {
	const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
	return {
		pandocPath: typeof data.pandocPath === "string" ? data.pandocPath.trim() : "",
		latexPath: typeof data.latexPath === "string" ? data.latexPath.trim() : "",
		outputDirectory: typeof data.outputDirectory === "string" ? data.outputDirectory : "",
	};
}
