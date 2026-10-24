import type { BookProject } from "./project";

export function fontFamily(filename: string): string {
	const name = filename.split(/[/\\]/).pop() ?? filename;
	return "BookPrint-" + Array.from(name).map(character => character.codePointAt(0)!.toString(16)).join("-");
}

export type Presentation = Pick<BookProject, "style" | "headings" | "fonts"> & Partial<Pick<BookProject, "page" | "styles" | "rules">>;

export function projectCss(project: Presentation): string {
	const declarations = (values: Record<string, string | number>) => Object.entries(values)
		.filter(([name]) => name !== "page-margin").map(([name, value]) => `${name}:${value}`).join(";");
	const body = Object.fromEntries(Object.entries(project.style).filter(([name]) => ["font-family", "font-size", "line-height", "color"].includes(name)));
	const paragraph = { ...project.style };
	if (paragraph["font-size"] !== undefined) paragraph["font-size"] = "inherit";
	const page = [
		project.style["page-margin"] !== undefined ? "margin:" + project.style["page-margin"] : "",
		declarations(project.page ?? {}),
	].filter(Boolean).join(";");
	return [
		...project.fonts.map(filename => {
			const name = filename.split(/[/\\]/).pop()!;
			return `@font-face{font-family:"${fontFamily(name)}";src:url("../fonts/${encodeURIComponent(name)}")}`;
		}),
		`body{${declarations(body)}}`,
		`p{${declarations(paragraph)}}`,
		page ? "@page{" + page + "}" : "",
		...Object.entries(project.headings).map(([name, values]) => `${name}{${declarations(values)}}`),
		...Object.entries(project.styles ?? {}).map(([name, values]) => `${name === "body" ? "body" : "body " + name}{${declarations(values)}}`),
		...Object.entries(project.rules ?? {}).map(([name, values]) => `body ${name}{${declarations(values)}}`),
	].join("\n");
}
