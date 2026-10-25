import { t } from "./i18n.ts";
import { bookStyles, contextRules } from "./book-styles.ts";
import { fontFamily } from "./presentation.ts";
import { pdfPage } from "./page-layout.ts";
import type { BookProject } from "./project.ts";

type Values = Record<string, string | number>;
export const pdfBaseCss = `body{font-size:11pt;line-height:1.2}p{margin:0;text-indent:1.2em}h1,h2,h3,h4,h5,h6{font-weight:bold;margin:1em 0 .5em}h1{font-size:2em}h2{font-size:1.5em}h3{font-size:1.25em}h4,h5,h6{font-size:1em}h1.title{text-align:center;font-size:2.5em}blockquote p{margin-left:2em;margin-right:2em}section.footnotes p{font-size:.85em}p.tab{white-space:pre-wrap}.bookbinder-after-heading-body + p{text-indent:0}.bookbinder-credit{text-align:center}`;

const defaults: Record<string, Values> = {
	p: { "text-indent": "1.2em" },
	...Object.fromEntries([2, 1.5, 1.25, 1, 1, 1].map((size, index) => ["h" + (index + 1), {
		"font-size": size + "em", "font-weight": "bold", "margin-top": "1em", "margin-bottom": "0.5em", "text-indent": "0pt",
		...(index < 4 ? { "page-break-before": "always" } : {}),
	}])),
	"h1.title": { "font-size": "2.5em", "text-align": "center", "font-weight": "bold", "text-indent": "0pt" },
	"blockquote p": { "margin-left": "2em", "margin-right": "2em" },
	"section.footnotes p": { "font-size": "0.85em", "text-indent": "0pt" },
};

function points(value: string | number, base: number, field: string): number {
	const match = String(value).match(/^(-?\d+(?:\.\d+)?)(pt|px|mm|cm|in|em|rem|%)?$/);
	if (!match) throw new Error(t("invalidPdfStyle", { field }));
	const factors: Record<string, number> = { pt: 1, px: 0.75, mm: 72 / 25.4, cm: 720 / 25.4, in: 72, em: base, rem: 11, "%": base / 100 };
	const result = Number(match[1]) * (factors[match[2] ?? "pt"] ?? 1);
	if (!Number.isFinite(result) || Math.abs(result) > 10000) throw new Error(t("invalidPdfStyle", { field }));
	return Number(result.toFixed(5));
}

export interface LatexStyle { before: string; after: string; inline: string; hidden: boolean }

export function pdfPresentation(project: BookProject, fonts: readonly string[]): { header: string; styles: Record<string, LatexStyle>; rules: Record<string, LatexStyle>; credit: LatexStyle } {
	const page = pdfPage(project.page), base = points(project.style["font-size"] ?? "11pt", 11, "font-size");
	const fontCommands = new Map<string, string>([["serif", "\\rmfamily"], ["sans-serif", "\\sffamily"], ["monospace", "\\ttfamily"],
		...fonts.map((reference, index): [string, string] => [fontFamily(reference), `\\csname bookbinderfont${index}\\endcsname`])]);
	const style = (values: Values, inheritedSize = base): LatexStyle => {
		const size = points(values["font-size"] ?? inheritedSize, inheritedSize, "font-size");
		if (size <= 0) throw new Error(t("invalidPdfStyle", { field: "font-size" }));
		let inline = "";
		if (values["font-family"] !== undefined) {
			const family = String(values["font-family"]).split(",")[0].trim().replace(/^['"]|['"]$/g, "");
			const command = fontCommands.get(family);
			if (!command) throw new Error(t("invalidPdfStyle", { field: "font-family" }));
			inline += command + "\n";
		}
		if (values["font-size"] !== undefined || values["line-height"] !== undefined) {
			const line = values["line-height"] ?? project.style["line-height"] ?? 1.2;
			const leading = /^\d+(?:\.\d+)?$/.test(String(line)) ? Number(line) * size : points(line, size, "line-height");
			if (leading <= 0) throw new Error(t("invalidPdfStyle", { field: "line-height" }));
			inline += `\\fontsize{${size}pt}{${leading}pt}\\selectfont\n`;
		}
		for (const [property, commands] of [["font-weight", { bold: "\\bfseries", normal: "\\mdseries" }], ["font-style", { italic: "\\itshape", normal: "\\upshape" }]] as const) {
			if (values[property] === undefined) continue;
			const command = Object.entries(commands).find(([name]) => name === values[property])?.[1];
			if (!command) throw new Error(t("invalidPdfStyle", { field: property }));
			inline += command + "\n";
		}
		if (values.color !== undefined) {
			const color = String(values.color), hex = color.match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i)?.[1];
			if (hex) inline += `\\color[HTML]{${hex.length === 3 ? [...hex].map(character => character.repeat(2)).join("") : hex}}\n`;
			else if (["black", "white", "red", "green", "blue", "gray", "transparent"].includes(color)) inline += `\\color{${color === "transparent" ? "white" : color}}\n`;
			else throw new Error(t("invalidPdfStyle", { field: "color" }));
		}
		if (values["letter-spacing"] !== undefined) inline += `\\addfontfeatures{LetterSpace=${points(values["letter-spacing"], size, "letter-spacing") / size * 100}}\n`;
		let before = "", after = "";
		if (values["page-position"] === "one-third") before += `\\clearpage\n\\vspace*{${Math.max(0, page.height / 3 - page.top)}mm}\n`;
		else if (values["page-break-before"] === "always") before += "\\clearpage\n";
		before += "\\par\\begingroup\n" + inline;
		if (values["text-align"] !== undefined) {
			const align = new Map([["left", "\\RaggedRight"], ["right", "\\RaggedLeft"], ["center", "\\Centering"], ["justify", "\\justifying"]]).get(String(values["text-align"]));
			if (!align) throw new Error(t("invalidPdfStyle", { field: "text-align" }));
			before += align + "\n";
		}
		for (const [property, command] of [["margin-left", "leftskip"], ["margin-right", "rightskip"], ["text-indent", "parindent"]]) {
			if (values[property] !== undefined) before += `\\setlength{\\${command}}{${points(values[property], size, property)}pt}\n`;
		}
		if (values["margin-top"] !== undefined && values["page-position"] !== "one-third") before += `\\vspace*{${points(values["margin-top"], size, "margin-top")}pt}\n`;
		after += "\\par\n";
		if (values["margin-bottom"] !== undefined) after += `\\vspace*{${points(values["margin-bottom"], size, "margin-bottom")}pt}\n`;
		after += "\\endgroup\n";
		return { before, after, inline, hidden: values.display === "none" };
	};
	const definitions = Object.fromEntries(bookStyles.map(item => {
		const values = item.selector === "p" ? project.style : /^h[1-6]$/.test(item.selector) ? project.headings[item.selector] : project.styles[item.selector];
		const paragraph = ["blockquote p", "section.footnotes p", "p.tab", ".bookbinder-colophon p"].includes(item.selector) ? project.style : {};
		return [item.selector, { ...paragraph, ...defaults[item.selector], ...values }];
	}));
	const styles = Object.fromEntries(Object.entries(definitions).map(([selector, values]) => [selector, style(values)]));
	const rules = Object.fromEntries(contextRules.filter(rule => !project.disabledRules.includes(rule.kind!) &&
		(rule.kind === "body" && !rule.pseudo || Object.keys(project.rules[rule.selector] ?? {}).length)).map(rule => [rule.selector, style({
		...(rule.kind === "body" && !rule.pseudo ? { "text-indent": "0pt" } : {}), ...project.rules[rule.selector],
	}, points(definitions[rule.paragraph!]["font-size"] ?? base, base, "font-size"))]));
	const inherited = Object.fromEntries(Object.entries(project.style).filter(([name]) => ["font-family", "font-size", "line-height", "color"].includes(name)));
	const body = style({ "font-size": "11pt", "line-height": 1.2, ...inherited });
	const header = "\\usepackage{ragged2e}\n\\usepackage[normalem]{ulem}\n\\newcommand{\\BookbinderBody}{" + body.inline + "\\setlength{\\parindent}{1.2em}\\setlength{\\parskip}{0pt}}\n";
	const credit = style({ "font-size": base * 0.8 + "pt", "text-align": "center", "text-indent": "0pt", "margin-top": "3em", "margin-left": "0pt", "margin-right": "0pt" });
	return { header, styles, rules, credit };
}
