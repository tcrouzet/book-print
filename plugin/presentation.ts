import type { BookProject } from "./project";
import { contextRules } from "./book-styles.ts";

export const libraryFontPrefix = "library:";

export function fontFilename(filename: string): string {
	return filename.replace(/^library:/, "").split(/[/\\]/).pop() ?? filename;
}

export function fontFamily(filename: string): string {
	const name = fontFilename(filename);
	// This namespace is stored in current project styles.
	return "BookPrint-" + Array.from(name).map(character => character.codePointAt(0)!.toString(16)).join("-");
}

export type Presentation = Pick<BookProject, "style" | "headings" | "fonts"> & Partial<Pick<BookProject, "css" | "page" | "styles" | "rules" | "disabledRules" | "separator">>;

export function fontFamiliesInStyles(project: Presentation): Set<string> {
	return new Set([project.style, ...Object.values(project.headings), ...Object.values(project.styles ?? {}), ...Object.values(project.rules ?? {})]
		.flatMap(style => typeof style["font-family"] === "string" ? style["font-family"].split(",").map(family => family.trim().replace(/^(["'])(.*)\1$/, "$2")) : []));
}

export function fontsInStyles(project: Presentation, available: readonly string[] = []): string[] {
	const families = fontFamiliesInStyles(project);
	const files = new Map<string, string>();
	for (const reference of [...project.fonts, ...available]) {
		const family = fontFamily(reference);
		// Custom stylesheets can declare their own font resources.
		if ((families.has(family) || project.css?.length && project.fonts.includes(reference)) && !files.has(family)) files.set(family, reference);
	}
	return [...files.values()];
}

export function projectCss(project: Presentation): string {
	const declarations = (values: Record<string, string | number>) => Object.entries(values)
		.filter(([name]) => name !== "page-position").map(([name, value]) => `${name}:${value}`).join(";");
	const rule = (selector: string, values: Record<string, string | number>) => {
		const style = [declarations(values), values["page-position"] === "one-third"
			? "page-break-before:always;break-before:page;margin-top:0;padding-top:33.3333vh" : ""].filter(Boolean).join(";");
		return `${selector}{${style}}`;
	};
	const body = Object.fromEntries(Object.entries(project.style).filter(([name]) => ["font-family", "font-size", "line-height", "color"].includes(name)));
	const paragraph = { ...project.style };
	if (paragraph["font-size"] !== undefined) paragraph["font-size"] = "inherit";
	const page = declarations(project.page ?? {});
	return [
		'div[class^="bookbinder-after-heading-"]{display:none}',
		'h1.bookbinder-colophon-boundary,.bookbinder-colophon-boundary>h1:first-child{display:none}',
		'.bookbinder-credit{margin-top:3em;font-size:0.8em}.bookbinder-credit p,.bookbinder-colophon .bookbinder-credit p{margin:0;text-indent:0;text-align:center}',
		...project.fonts.map(filename => {
			const name = fontFilename(filename);
			return `@font-face{font-family:"${fontFamily(name)}";src:url("../fonts/${encodeURIComponent(name)}")}`;
		}),
		`body{${declarations(body)}}`,
		`p{${declarations(paragraph)}}`,
		page ? "@page{" + page + "}" : "",
		...Object.entries(project.headings).map(([name, values]) => rule(name === "h1" ? "h1:not(.title)" : name, values)),
		...Object.entries(project.styles ?? {}).map(([name, values]) => rule(name === "hr" ? "body hr,body .bookbinder-separator" : name === "body" ? "body" : "body " + name, values)),
		...Object.entries(project.rules ?? {}).filter(([name]) => !project.disabledRules?.includes(contextRules.find(rule => rule.selector === name)?.kind ?? ""))
			.map(([name, values]) => `body ${name}{${declarations(values)}}`),
	].join("\n");
}
