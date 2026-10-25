import type { BookProject } from "./project";
import { contextRules } from "./book-styles.ts";

export const libraryFontPrefix = "library:";

export function fontFilename(filename: string): string {
	return filename.replace(/^library:/, "").split(/[/\\]/).pop() ?? filename;
}

export function fontFamily(filename: string): string {
	const name = fontFilename(filename);
	// Ces identifiants de polices sont conservés dans les propriétés des anciens projets.
	return "BookPrint-" + Array.from(name).map(character => character.codePointAt(0)!.toString(16)).join("-");
}

export type Presentation = Pick<BookProject, "style" | "headings" | "fonts"> & Partial<Pick<BookProject, "page" | "styles" | "rules" | "disabledRules" | "separator">>;

export function projectCss(project: Presentation): string {
	const declarations = (values: Record<string, string | number>) => Object.entries(values)
		.filter(([name]) => name !== "page-margin" && name !== "page-position").map(([name, value]) => `${name}:${value}`).join(";");
	const rule = (selector: string, values: Record<string, string | number>) => {
		const style = [declarations(values), values["page-position"] === "one-third"
			? "page-break-before:always;break-before:page;margin-top:0;padding-top:33.3333vh" : ""].filter(Boolean).join(";");
		return `${selector}{${style}}`;
	};
	const body = Object.fromEntries(Object.entries(project.style).filter(([name]) => ["font-family", "font-size", "line-height", "color"].includes(name)));
	const paragraph = { ...project.style };
	if (paragraph["font-size"] !== undefined) paragraph["font-size"] = "inherit";
	const page = [
		project.style["page-margin"] !== undefined ? "margin:" + project.style["page-margin"] : "",
		declarations(project.page ?? {}),
	].filter(Boolean).join(";");
	return [
		'div[class^="bookbinder-after-heading-"]{display:none}',
		'h1.bookbinder-colophon-boundary,.bookbinder-colophon-boundary>h1:first-child{display:none}',
		'.bookbinder-credit{margin-top:3em;font-size:0.8em}.bookbinder-credit p{margin:0;text-indent:0;text-align:center}',
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
