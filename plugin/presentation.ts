import type { BookProject } from "./project";
import { contextRules } from "./book-styles.ts";
import { millimetres } from "./page-layout.ts";

export const libraryFontPrefix = "library:";
export const defaultPdfFont = libraryFontPrefix + "EBGaramond-Regular.otf";
export interface FontFaceInfo { family: string; weight: number; style: "normal" | "italic" }
export type FontInfoLookup = (reference: string) => FontFaceInfo | undefined;

export function fontFilename(filename: string): string {
	return filename.replace(/^library:/, "").split(/[/\\]/).pop() ?? filename;
}

export function fontFamily(filename: string): string {
	const name = fontFilename(filename);
	// This namespace is stored in current project styles.
	return "BookPrint-" + Array.from(name).map(character => character.codePointAt(0)!.toString(16)).join("-");
}

export type Presentation = Pick<BookProject, "style" | "headings" | "fonts"> & Partial<Pick<BookProject, "css" | "page" | "styles" | "rules" | "disabledRules" | "separator">>;

export function resolveBodyText(values: Record<string, string | number>, body: Record<string, string | number>): Record<string, string | number> {
	return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, ["font-family", "font-size"].includes(name) && value === "body" ? body[name] : value]));
}

export function applyDefaultFont(project: Presentation, reference: string): void {
	const family = fontFamily(reference);
	project.style["font-family"] ??= family;
	if (fontFamiliesInStyles(project).has(family) && !project.fonts.some(font => fontFamily(font) === family)) project.fonts = [...project.fonts, reference];
}

export function fontFace(reference: string, lookup?: FontInfoLookup): FontFaceInfo {
	const known = lookup?.(reference);
	if (known) return known;
	const name = fontFilename(reference).replace(/\.(otf|ttf|woff2?)$/i, "");
	const suffix = name.match(/[-_ ](Regular|BoldItalic|Bold|Italic)$/i)?.[1] ?? "";
	return { family: suffix ? name.slice(0, -suffix.length - 1) : name, weight: /bold/i.test(suffix) ? 700 : 400, style: /italic/i.test(suffix) ? "italic" : "normal" };
}

function familyKey(reference: string, lookup?: FontInfoLookup): string { return fontFace(reference, lookup).family.toLowerCase().replace(/[\s_-]/g, ""); }

export function fontChoices(available: readonly string[], lookup?: FontInfoLookup): string[] {
	const choices = new Map<string, string>();
	const rank = (reference: string) => { const face = fontFace(reference, lookup); return Math.abs(face.weight - 400) + (face.style === "italic" ? 2000 : 0); };
	for (const reference of available) {
		const key = familyKey(reference, lookup), previous = choices.get(key);
		if (!previous || rank(reference) < rank(previous) || rank(reference) === rank(previous) && fontFilename(reference).localeCompare(fontFilename(previous), "en") < 0) choices.set(key, reference);
	}
	return [...choices.values()];
}

export function fontBase(reference: string, available: readonly string[], lookup?: FontInfoLookup): string {
	return fontChoices([reference, ...available], lookup).find(font => familyKey(font, lookup) === familyKey(reference, lookup))!;
}

export function fontVariants(reference: string, available: readonly string[], lookup?: FontInfoLookup): Partial<Record<"bold" | "italic" | "boldItalic", string>> {
	const face = fontFace(reference, lookup), key = familyKey(reference, lookup);
	const find = (bold: boolean, italic: boolean) => available.filter(font => {
		const candidate = fontFace(font, lookup);
		return familyKey(font, lookup) === key && (candidate.weight >= 600) === bold && (candidate.style === "italic") === italic;
	}).sort((a, b) => Math.abs(fontFace(a, lookup).weight - (bold ? 700 : 400)) - Math.abs(fontFace(b, lookup).weight - (bold ? 700 : 400)) || fontFilename(a).localeCompare(fontFilename(b), "en"))[0];
	return Object.fromEntries(Object.entries({ bold: find(true, face.style === "italic"), italic: find(face.weight >= 600, true), boldItalic: find(true, true) }).filter(([, font]) => font !== undefined));
}

export function fontResources(reference: string, available: readonly string[], lookup?: FontInfoLookup): string[] {
	return [...new Set([reference, ...Object.values(fontVariants(reference, available, lookup))])];
}

export function resolveFontFamilies(project: Presentation, available: readonly string[], lookup?: FontInfoLookup): void {
	const sources = [...project.fonts, ...available], choices = fontChoices(sources, lookup);
	for (const values of [project.style, ...Object.values(project.headings), ...Object.values(project.styles ?? {}), ...Object.values(project.rules ?? {})]) {
		if (typeof values["font-family"] !== "string") continue;
		values["font-family"] = values["font-family"].split(",").map(value => {
			const reference = sources.find(font => fontFamily(font) === value.trim().replace(/^['"]|['"]$/g, ""));
			if (!reference) return value.trim();
			const base = choices.find(font => familyKey(font, lookup) === familyKey(reference, lookup))!;
			if (base !== reference) {
				const face = fontFace(reference, lookup);
				if (face.weight >= 600) values["font-weight"] = "bold";
				if (face.style === "italic") values["font-style"] = "italic";
			}
			return fontFamily(base);
		}).join(", ");
	}
	project.fonts = fontsInStyles(project, sources, lookup);
}

export function fontFamiliesInStyles(project: Presentation): Set<string> {
	return new Set([project.style, ...Object.values(project.headings), ...Object.values(project.styles ?? {}), ...Object.values(project.rules ?? {})]
		.flatMap(style => typeof style["font-family"] === "string" && style["font-family"] !== "body" ? style["font-family"].split(",").map(family => family.trim().replace(/^(["'])(.*)\1$/, "$2")) : []));
}

export function fontsInStyles(project: Presentation, available: readonly string[] = [], lookup?: FontInfoLookup): string[] {
	const families = fontFamiliesInStyles(project);
	const files = new Map<string, string>();
	for (const reference of [...project.fonts, ...available]) {
		const family = fontFamily(reference);
		// Custom stylesheets can declare their own font resources.
		if ((families.has(family) || project.css?.length && project.fonts.includes(reference)) && !files.has(family)) files.set(family, reference);
	}
	return [...new Set([...files.values()].flatMap(reference => fontResources(reference, [...project.fonts, ...available], lookup)))];
}

export function projectCss(project: Presentation, lookup?: FontInfoLookup, format = "epub"): string {
	const bodySize = String(project.style["font-size"] ?? (format === "epub" ? "1em" : "11pt")).replace(/^([\d.]+)em$/, "$1rem").replace(/^([\d.]+)%$/, (_, value: string) => Number(value) / 100 + "rem");
	const bodyText = { "font-family": project.style["font-family"] ?? "initial", "font-size": bodySize };
	const declarations = (values: Record<string, string | number>) => Object.entries(values)
		.filter(([name]) => !["page-position", "page-offset", "folio"].includes(name)).map(([name, value]) => `${name}:${value}`).join(";");
	const rule = (selector: string, values: Record<string, string | number>) => {
		const style = [declarations(resolveBodyText(values, bodyText)), values["page-position"] === "one-third"
			? `page-break-before:always;break-before:page;margin-top:0;padding-top:${format === "epub" ? millimetres(values["page-offset"] ?? "50mm") + "mm" : "33.3333vh"}` : values["page-position"] === "normal" ? "padding-top:0" : ""].filter(Boolean).join(";");
		return `${selector}{${style}}`;
	};
	const body = Object.fromEntries(Object.entries(project.style).filter(([name]) => ["font-family", "font-size", "line-height", "color"].includes(name)));
	const paragraph = { ...project.style };
	if (paragraph["font-size"] !== undefined) paragraph["font-size"] = "inherit";
	const page = declarations(project.page ?? {});
	const families = fontFamiliesInStyles(project);
	return [
		'div[class^="bookbinder-after-heading-"]{display:none}',
		'h1.bookbinder-colophon-boundary,.bookbinder-colophon-boundary>h1:first-child{display:none}',
		'.bookbinder-credit{margin-top:3em;font-size:0.8em}.bookbinder-credit p,.bookbinder-colophon .bookbinder-credit p{margin:0;text-indent:0;text-align:center}',
		...project.fonts.filter(reference => families.has(fontFamily(reference)) || project.css?.length).flatMap(reference => fontResources(reference, project.fonts, lookup).map(source => {
			const name = fontFilename(source), face = fontFace(source, lookup);
			return `@font-face{font-family:"${fontFamily(reference)}";font-weight:${face.weight};font-style:${face.style};src:url("../fonts/${encodeURIComponent(name)}")}`;
		})),
		`body{${declarations(body)}}`,
		`p{${declarations(paragraph)}}`,
		page ? "@page{" + page + "}" : "",
		...Object.entries(project.headings).map(([name, values]) => rule(name === "h1" ? "h1:not(.title)" : name, values)),
		...Object.entries(project.styles ?? {}).map(([name, values]) => {
			if (format === "pdf" && name === ".bookbinder-colophon p" && values["page-position"] === "one-third") {
				const typography: Record<string, string | number> = { ...values, "margin-top": "0pt" }; delete typography["page-position"];
				return rule("body .bookbinder-colophon", { "page-position": "one-third" }) + "\n" + rule("body " + name, typography);
			}
			return rule(name === "hr" ? "body hr,body .bookbinder-separator" : name === "body" ? "body" : "body " + name, values);
		}),
		...Object.entries(project.rules ?? {}).filter(([name]) => !project.disabledRules?.includes(contextRules.find(rule => rule.selector === name)?.kind ?? ""))
			.sort(([left], [right]) => Number(contextRules.find(rule => rule.selector === left)?.scope === "book") - Number(contextRules.find(rule => rule.selector === right)?.scope === "book"))
			.map(([name, values]) => {
				const definition = contextRules.find(rule => rule.selector === name)!;
				const target = definition.kind === "title" ? "body h1.title" : /^h[1-6]$/.test(definition.paragraph!) ? `body ${definition.paragraph}${name}` : ["ul", "ol"].includes(definition.paragraph!) ? `body ${name} > ${definition.paragraph}`
					: definition.paragraph === "hr" ? `body ${name} > hr,body ${name} > .bookbinder-separator`
					: definition.paragraph === "pre" ? `body pre${name},body div${name} > pre` : "body " + name;
				return rule(target, values);
			}),
		'body div[class^="bookbinder-continued-"] > p{margin-top:0!important}',
	].join("\n");
}
