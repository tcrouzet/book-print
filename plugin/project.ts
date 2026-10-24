import * as path from "node:path";
import { isProjectNote } from "./project-view.ts";
import { bookStyles, contextRules } from "./book-styles.ts";
export { isProjectNote };
export { projectCss } from "./presentation.ts";

export interface FusionOptions {
	noteSeparator: string;
	excludeCharacters: string;
	excludeNames: string;
}

export interface BookProject {
	metadata: Record<string, unknown>;
	cover?: string;
	background?: string;
	css: string[];
	fonts: string[];
	tocDepth: number;
	splitLevel: number;
	style: Record<string, string | number>;
	page: Record<string, string | number>;
	headings: Record<string, Record<string, string | number>>;
	styles: Record<string, Record<string, string | number>>;
	rules: Record<string, Record<string, string | number>>;
	fusion: FusionOptions;
}

const defaultFusion: FusionOptions = {
	noteSeparator: "", excludeCharacters: "_", excludeNames: "sortspec",
};
const obsoleteFusion = new Set(["smallcaps", "right", "newpage", "toppara", "poem", "nocomments", "noMDcomments"]);
const obsoleteStyles = new Set(["h1.title", "p.subtitle", "p.author", "p.date", "div.rights", "div.abstract-title", "div.abstract", "blockquote", "div.top-para", "div.right", "div.poem-solo", "div.poem-top", "div.poem-bottom", "div.poem", "#dédicace p", "h1.unnumbered", "div.page-beak", ".thin-space", ".thin-space-before", ".thin-space-after"]);

function object(value: unknown, field: string): Record<string, unknown> {
	if (value === undefined || value === null) return {};
	if (typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} doit être un objet YAML.`);
	return value as Record<string, unknown>;
}

function strings(value: unknown, field: string): string[] {
	if (value === undefined || value === null || value === "") return [];
	const values = Array.isArray(value) ? value : [value];
	if (!values.every(item => typeof item === "string" && item.length > 0 && !item.includes("\0"))) {
		throw new Error(`${field} doit contenir des chemins de fichiers.`);
	}
	return values as string[];
}

function depth(value: unknown, fallback: number, field: string): number {
	if (value === undefined) return fallback;
	if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 6) throw new Error(`${field} doit être compris entre 1 et 6.`);
	return Number(value);
}

const styleProperties = new Set([
	"font-family", "font-size", "line-height", "text-align", "text-indent", "margin-top",
	"margin-bottom", "margin-left", "margin-right", "color", "font-weight", "font-style", "page-break-before", "display", "letter-spacing",
]);

function styles(value: unknown, field: string): Record<string, string | number> {
	const result = object(value, field);
	for (const [name, setting] of Object.entries(result)) {
		if (!styleProperties.has(name) && name !== "page-margin") throw new Error(`${field}.${name} : réglage inconnu.`);
		if ((typeof setting !== "string" && typeof setting !== "number") || !/^[\p{L}\p{N}\s.,%'"#()-]+$/u.test(String(setting))) {
			throw new Error(`${field}.${name} : valeur de présentation invalide.`);
		}
	}
	return result as Record<string, string | number>;
}

export function parseProject(value: unknown, defaultTitle: string): BookProject {
	const data = object(value, "Propriétés du projet");
	const epub = object(data.epub, "epub");
	const metadata = { ...object(data.metadata, "metadata") };
	for (const key of ["title", "subtitle", "author", "author-url", "description", "subject", "rights", "identifier", "publisher", "publisher-url", "isbn", "isbn-ebook", "lang", "date"]) {
		if (data[key] !== undefined) metadata[key] = data[key];
	}
	if (data.author_url !== undefined) metadata["author-url"] = data.author_url;
	metadata.title ??= defaultTitle;
	metadata.lang ??= "fr";
	for (const key of ["subtitle", "author"]) if (metadata[key] === null) delete metadata[key];
	for (const key of ["title", "subtitle", "lang"]) {
		if (metadata[key] !== undefined && typeof metadata[key] !== "string") throw new Error(`${key} doit être un texte.`);
	}
	if (!String(metadata.title).trim()) metadata.title = defaultTitle;
	if (metadata.author !== undefined && typeof metadata.author !== "string" && !(Array.isArray(metadata.author) && metadata.author.every(item => typeof item === "string"))) {
		throw new Error("author doit être un texte ou une liste de noms.");
	}
	const fusion = { ...defaultFusion };
	for (const [key, setting] of Object.entries(object(data.fusion, "fusion"))) {
		if (obsoleteFusion.has(key)) continue;
		if (!Object.prototype.hasOwnProperty.call(defaultFusion, key)) throw new Error(`fusion.${key} : réglage inconnu.`);
		if (typeof setting !== typeof defaultFusion[key as keyof FusionOptions]) throw new Error(`fusion.${key} : valeur invalide.`);
		Object.assign(fusion, { [key]: setting });
	}
	const headings: BookProject["headings"] = {};
	for (const [name, setting] of Object.entries(object(epub.headings, "epub.headings"))) {
		if (!/^h[1-6]$/.test(name)) throw new Error(`epub.headings.${name} : utilisez h1 à h6.`);
		headings[name] = styles(setting, `epub.headings.${name}`);
	}
	const namedStyles: BookProject["styles"] = {};
	const rules: BookProject["rules"] = {};
	for (const [name, setting] of Object.entries(object(epub.styles, "epub.styles"))) {
		if (name === "body" || obsoleteStyles.has(name)) continue;
		if (contextRules.some(rule => rule.selector === name)) { rules[name] = styles(setting, `epub.styles.${name}`); continue; }
		if (!bookStyles.some(style => style.selector === name && style.sample)) throw new Error(`epub.styles.${name} : style inconnu.`);
		namedStyles[name] = styles(setting, `epub.styles.${name}`);
	}
	for (const [name, setting] of Object.entries(object(epub.rules, "epub.rules"))) {
		if (!contextRules.some(rule => rule.selector === name)) throw new Error(`epub.rules.${name} : règle inconnue.`);
		rules[name] = styles(setting, `epub.rules.${name}`);
	}
	const paragraph = { ...styles(object(epub.styles, "epub.styles").body, "epub.styles.body"), ...styles(epub.style, "epub.style") };
	for (const key of ["cover", "cover-background"]) {
		if (data[key] !== undefined && data[key] !== null && typeof data[key] !== "string") throw new Error(`${key} doit désigner une seule image.`);
	}
	const page = styles(epub.page, "epub.page");
	for (const key of Object.keys(page)) if (!["margin-top", "margin-bottom", "margin-left", "margin-right"].includes(key)) throw new Error("epub.page : utilisez les quatre marges de page.");
	return {
		metadata, fusion, headings, page, styles: namedStyles, rules,
		cover: strings(data.cover, "cover")[0],
		background: strings(data["cover-background"], "cover-background")[0],
		css: strings(epub.css ?? data.css, "epub.css"),
		fonts: strings(epub.fonts ?? data.fonts, "epub.fonts"),
		tocDepth: depth(epub["toc-depth"] ?? data.toc_level, 2, "epub.toc-depth"),
		splitLevel: depth(epub["split-level"], 2, "epub.split-level"),
		style: paragraph,
	};
}

export function excluded(relativePath: string, options: FusionOptions): boolean {
	if (isProjectNote(relativePath)) return true;
	const names = options.excludeNames.split(",").map(name => name.trim().toLowerCase()).filter(Boolean);
	return relativePath.split("/").some(name => Array.from(options.excludeCharacters).some(character => name.includes(character))
		|| names.includes(name.toLowerCase()) || names.includes(name.replace(/\.md$/i, "").toLowerCase())
		|| /^fusion-.*-\d{8}(?:-\d{4})?\.md$/i.test(name));
}

export function prepareMarkdown(content: string): string {
	content = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
	content = content.replace(/^---\n[\s\S]*?\n(?:---|\.\.\.)\s*(?:\n|$)/, "");
	content = content.replace(/<!--[\s\S]*?-->/g, "").replace(/%%[\s\S]*?%%\n?/g, "");
	return content;
}

export function localResource(directory: string, filename: string): string {
	if (!filename || filename.includes("\0") || /^[a-z][a-z0-9+.-]*:\/\//i.test(filename)) throw new Error(`Ressource locale attendue : ${filename}`);
	return path.resolve(directory, filename);
}
