export interface BookbinderSettings {
	projectModel: string;
	pandocPath: string;
	latexPath: string;
	outputDirectory: string;
}

export const DEFAULT_SETTINGS: BookbinderSettings = {
	projectModel: "base.md",
	pandocPath: "",
	latexPath: "",
	outputDirectory: "",
};

export function parseSettings(value: unknown): BookbinderSettings {
	const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
	return {
		projectModel: typeof data.projectModel === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]*\.md$/.test(data.projectModel) && data.projectModel !== "README.md" ? data.projectModel : DEFAULT_SETTINGS.projectModel,
		pandocPath: typeof data.pandocPath === "string" ? data.pandocPath.trim() : "",
		latexPath: typeof data.latexPath === "string" ? data.latexPath.trim() : "",
		outputDirectory: typeof data.outputDirectory === "string" ? data.outputDirectory : "",
	};
}
