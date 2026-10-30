import { t } from "./i18n.ts";
import * as path from "node:path";
import { isProjectNote } from "./project-view.ts";
import { bookStyles, contextRules, folioStyle, noteReferenceStyle, footnoteIndexStyle, footnoteSeparatorStyle } from "./book-styles.ts";
import { footnoteSeparator } from "./footnote-separator.ts";
import { millimetres, pdfPage } from "./page-layout.ts";
import { defaultFilename, slugFilename } from "./filename.ts";
import { applyDefaultFont, defaultPdfFont } from "./presentation.ts";
export { isProjectNote };
export { projectCss } from "./presentation.ts";

export interface FusionOptions {
	noteSeparator: string;
	excludeCharacters: string;
	excludeNames: string;
}

export const noteSeparators = new Map([
	["", { get label() { return t("empty"); }, pageBreak: "" }],
	["page", { get label() { return t("pageBreak"); }, pageBreak: "always" }],
	["even", { get label() { return t("evenPageBreak"); }, pageBreak: "left" }],
	["odd", { get label() { return t("oddPageBreak"); }, pageBreak: "right" }],
]);

export interface BookProject {
	metadata: Record<string, unknown>;
	filename: string;
	cover?: string;
	background?: string;
	css: string[];
	fonts: string[];
	separator?: string;
	toc: boolean;
	tocDepth: number;
	titlePage: { copyright: boolean; characterCount: boolean };
	splitLevel: number;
	style: Record<string, string | number>;
	page: Record<string, string | number>;
	headings: Record<string, Record<string, string | number>>;
	styles: Record<string, Record<string, string | number>>;
	rules: Record<string, Record<string, string | number>>;
	disabledRules: string[];
	fusion: FusionOptions;
}

const defaultFusion: FusionOptions = {
	noteSeparator: "", excludeCharacters: "_", excludeNames: "sortspec",
};

function object(value: unknown, field: string): Record<string, unknown> {
	if (value === undefined || value === null) return {};
	if (typeof value !== "object" || Array.isArray(value)) throw new Error(t("fieldMustBeAYamlObject", { field: field }));
	return value as Record<string, unknown>;
}

function strings(value: unknown, field: string): string[] {
	if (value === undefined || value === null || value === "") return [];
	const values = Array.isArray(value) ? value : [value];
	if (!values.every(item => typeof item === "string" && item.length > 0 && !item.includes("\0"))) {
		throw new Error(t("fieldMustContainFilePaths", { field: field }));
	}
	return values as string[];
}

function depth(value: unknown, fallback: number, field: string): number {
	if (value === undefined) return fallback;
	if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 6) throw new Error(t("fieldMustBeBetween1And6", { field: field }));
	return Number(value);
}

const styleProperties = new Set([
	"font-family", "font-size", "line-height", "text-align", "text-indent", "margin-top",
	"margin-bottom", "margin-left", "margin-right", "color", "font-weight", "font-style", "page-break-before", "display", "letter-spacing",
]);

function styles(value: unknown, field: string, heading = false): Record<string, string | number> {
	const result = { ...object(value, field) };
	const separator = field.endsWith(".styles." + footnoteSeparatorStyle.selector);
	const characterValues: Record<string, string[]> = { "vertical-align": ["baseline", "super", "sub"], "text-transform": ["none", "uppercase"], "font-variant": ["normal", "small-caps"] };
	for (const [name, setting] of Object.entries(result)) {
		if (separator && !["width", "border-top-width", "color", "text-align", "display"].includes(name)) throw new Error(t("fieldNameUnknownSetting", { field, name }));
		if (separator && ["width", "border-top-width"].includes(name)) {
			if (typeof setting !== "string" && typeof setting !== "number") throw new Error(t("invalidFootnoteSeparator"));
			continue;
		}
		if (Object.prototype.hasOwnProperty.call(characterValues, name)) {
			if (!characterValues[name].includes(String(setting))) throw new Error(t("fieldNameInvalidPresentationValue", { field, name }));
			continue;
		}
		if (name === "hyphens") {
			if (!/^(pdf|docx)\./.test(field) || !["auto", "none"].includes(String(setting))) throw new Error(t("fieldNameInvalidPresentationValue", { field, name }));
			continue;
		}
		if (name === "folio") {
			const rule = contextRules.find(rule => field === "pdf.rules." + rule.selector);
			if (!(/^pdf\.headings\.h[1-6]$/.test(field) || field === "pdf.styles..bookbinder-colophon p" || rule && !rule.pseudo && /^h[1-6]$/.test(rule.paragraph!)) || !["show", "hide"].includes(String(setting))) throw new Error(t("fieldNameInvalidPresentationValue", { field, name }));
			continue;
		}
		if (name === "page-offset" && /^epub\./.test(field) && (heading || /^epub\.(headings\.h[1-6]|styles\.h1\.title)$/.test(field))) {
			const offset = typeof setting === "string" || typeof setting === "number" ? millimetres(setting) : NaN;
			if (!Number.isFinite(offset) || offset < 0 || offset > 300) throw new Error(t("fieldNameInvalidPresentationValue", { field, name }));
			continue;
		}
		if (setting === "body" && (!["font-family", "font-size"].includes(name) || /^(epub|pdf|docx)\.style$/.test(field))) throw new Error(t("fieldNameInvalidPresentationValue", { field, name }));
		if (name === "page-break-before" && (/^(pdf|docx)\.headings\.h[1-6]$/.test(field) || heading && /^(pdf|docx)\./.test(field)) && !["auto", "always", "left", "right"].includes(String(setting))) throw new Error(t("fieldNameInvalidPresentationValue", { field, name }));
		if (name === "page-position" && (heading || /^(epub|pdf|docx)\.headings\.h[1-6]$/.test(field) || /^(epub|pdf|docx)\.styles\.h1\.title$/.test(field) || field === "pdf.styles..bookbinder-colophon p") && (setting === "one-third" || /^(pdf|docx)\./.test(field) && setting === "normal")) {
			continue;
		}
		if (!styleProperties.has(name)) throw new Error(t("fieldNameUnknownSetting", { field: field, name: name }));
		if ((typeof setting !== "string" && typeof setting !== "number") || !/^[\p{L}\p{N}\s.,%'"#()-]+$/u.test(String(setting))) {
			throw new Error(t("fieldNameInvalidPresentationValue", { field: field, name: name }));
		}
	}
	return result as Record<string, string | number>;
}

export function parseProject(value: unknown, defaultTitle: string, format: "epub" | "pdf" | "docx" = "epub"): BookProject {
	const data = object(value, t("projectProperties"));
	const epub = object(data[format], format);
	const metadata = { ...object(data.metadata, "metadata") };
	for (const key of ["title", "subtitle", "author", "author-url", "description", "subject", "rights", "identifier", "publisher", "publisher-url", "isbn", "isbn-ebook", "lang", "date", "colophon"]) {
		if (data[key] !== undefined) metadata[key] = data[key];
	}
	metadata.title ??= defaultTitle;
	metadata.lang ??= "fr";
	for (const key of ["subtitle", "author", "colophon", "rights"]) if (metadata[key] === null) delete metadata[key];
	for (const key of ["title", "subtitle", "lang", "colophon", "rights"]) {
		if (metadata[key] !== undefined && typeof metadata[key] !== "string") throw new Error(t("fieldMustBeText", { field: key }));
	}
	if (!String(metadata.title).trim()) metadata.title = defaultTitle;
	if (metadata.author !== undefined && typeof metadata.author !== "string" && !(Array.isArray(metadata.author) && metadata.author.every(item => typeof item === "string"))) {
		throw new Error(t("authorMustBeTextOrAListOfNames"));
	}
	if (data.filename !== undefined && data.filename !== null && typeof data.filename !== "string") throw new Error(t("fieldMustBeText", { field: "filename" }));
	const filename = (typeof data.filename === "string" ? slugFilename(data.filename) : "") || defaultFilename(String(metadata.title), metadata.author);
	const fusion = { ...defaultFusion };
	for (const [key, setting] of Object.entries(object(data.fusion, "fusion"))) {
		if (!Object.prototype.hasOwnProperty.call(defaultFusion, key)) throw new Error(t("fusionNameUnknownSetting", { name: key }));
		if (typeof setting !== typeof defaultFusion[key as keyof FusionOptions]) throw new Error(t("fusionNameInvalidValue", { name: key }));
		Object.assign(fusion, { [key]: setting });
	}
	const headings: BookProject["headings"] = {};
	for (const [name, setting] of Object.entries(object(epub.headings, `${format}.headings`))) {
		if (!/^h[1-6]$/.test(name)) throw new Error(t("epubHeadingsNameUseH1ToH6", { name: name }));
		headings[name] = styles(setting, `${format}.headings.${name}`);
	}
	const namedStyles: BookProject["styles"] = {};
	const rules: BookProject["rules"] = {};
	for (const [name, setting] of Object.entries(object(epub.styles, `${format}.styles`))) {
		if (!bookStyles.some(style => style.selector === name && style.sample) && !(format !== "epub" && [folioStyle, noteReferenceStyle, footnoteIndexStyle, footnoteSeparatorStyle].some(style => style.selector === name))) throw new Error(t("epubStylesNameUnknownStyle", { name: name }));
		namedStyles[name] = styles(setting, `${format}.styles.${name}`);
	}
	for (const [name, setting] of Object.entries(object(epub.rules, `${format}.rules`))) {
		const rule = contextRules.find(rule => rule.selector === name);
		if (!rule) throw new Error(t("epubRulesNameUnknownRule", { name: name }));
		rules[name] = styles(setting, `${format}.rules.${name}`, !rule.pseudo);
	}
	const paragraph = styles(epub.style, `${format}.style`);
	const disabledRules = epub["disabled-rules"] ?? [];
	if (!Array.isArray(disabledRules) || !disabledRules.every(kind => typeof kind === "string" && contextRules.some(rule => rule.kind === kind))) {
		throw new Error(t("invalidDisabledRules"));
	}
	for (const key of ["cover", "cover-background"]) {
		if (data[key] !== undefined && data[key] !== null && typeof data[key] !== "string") throw new Error(t("fieldMustReferToASingleImage", { field: key }));
	}
	const page = { ...object(epub.page, `${format}.page`) } as Record<string, string | number>;
	if (format === "docx" && page["notes-position"] !== undefined && page["notes-position"] !== "page-bottom" && page["notes-position"] !== "document-end") throw new Error(t("fieldNameInvalidPresentationValue", { field: "docx.page", name: "notes-position" }));
	if (epub.separator !== undefined && (typeof epub.separator !== "string" || epub.separator.includes("\0"))) {
		throw new Error(t("epubSeparatorMustContainSeparatorCharacters"));
	}
	if (epub.toc !== undefined && typeof epub.toc !== "boolean") throw new Error(t("fieldNameInvalidPresentationValue", { field: format, name: "toc" }));
	const titlePage = object(epub["title-page"], `${format}.title-page`);
	for (const [name, value] of Object.entries(titlePage)) {
		if (!["copyright", "character-count"].includes(name) || typeof value !== "boolean" || format === "epub") throw new Error(t("fieldNameInvalidPresentationValue", { field: `${format}.title-page`, name }));
	}
	for (const key of Object.keys(page)) if (!["margin-top", "margin-bottom", "margin-left", "margin-right", ...(format !== "epub" ? ["paper-size", "paper-width", "paper-height", "page-mode", "margin-inner", "margin-outer", "binding-offset", "folio-position", "folio-offset"] : []), ...(format === "docx" ? ["notes-position"] : [])].includes(key)) throw new Error(t("epubPageUseTheFourPageMargins"));
	styles(Object.fromEntries(Object.entries(page).filter(([key]) => ["margin-top", "margin-bottom", "margin-left", "margin-right"].includes(key))), `${format}.page`);
	if (format !== "epub") pdfPage(page);
	const project: BookProject = {
		metadata, filename, fusion, headings, page, styles: namedStyles, rules, disabledRules: disabledRules as string[],
		cover: strings(data.cover, "cover")[0],
		background: strings(data["cover-background"], "cover-background")[0],
		css: strings(epub.css, `${format}.css`),
		fonts: strings(epub.fonts, `${format}.fonts`),
		separator: epub.separator,
		toc: epub.toc ?? format !== "epub",
		tocDepth: depth(epub["toc-depth"], 2, `${format}.toc-depth`),
		titlePage: { copyright: titlePage.copyright === true, characterCount: titlePage["character-count"] === true },
		splitLevel: depth(epub["split-level"], 2, `${format}.split-level`),
		style: paragraph,
	};
	if (format !== "epub") applyDefaultFont(project, defaultPdfFont);
	if (format !== "epub") footnoteSeparator(project);
	return project;
}

export function excluded(relativePath: string, options: FusionOptions): boolean {
	if (isProjectNote(relativePath)) return true;
	const names = options.excludeNames.split(",").map(name => name.trim().toLowerCase()).filter(Boolean);
	return relativePath.split("/").some(name => Array.from(options.excludeCharacters).some(character => name.includes(character))
		|| names.includes(name.toLowerCase()) || names.includes(name.replace(/\.md$/i, "").toLowerCase()));
}

export function prepareMarkdown(content: string): string {
	content = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
	content = content.replace(/^---\n[\s\S]*?\n(?:---|\.\.\.)\s*(?:\n|$)/, "");
	content = content.replace(/<!--[\s\S]*?-->/g, "").replace(/%%[\s\S]*?%%\n?/g, "");
	return content;
}

export function localResource(directory: string, filename: string): string {
	if (!filename || filename.includes("\0") || /^[a-z][a-z0-9+.-]*:\/\//i.test(filename)) throw new Error(t("expectedALocalResourceFilename", { filename: filename }));
	return path.resolve(directory, filename);
}
