import { t } from "./i18n.ts";
import { printBookStyles, contextRules, folioStyle, ruleOverrides } from "./book-styles.ts";
import { defaultPdfFont, fontFamily, resolveBodyText, type Presentation } from "./presentation.ts";
import { folioPage, pdfPage } from "./page-layout.ts";
import type { BookProject } from "./project.ts";
import { lengthValue } from "./length-input.ts";

type Values = Record<string, string | number>;
const bodyDefaults: Values = { "font-family": fontFamily(defaultPdfFont), "font-size": "11pt", "line-height": 1.2, color: "#000000" };
export const pdfBaseCss = "body{font-size:11pt;line-height:1.2;hyphens:auto}p{margin:0;text-indent:1.2em}h1,h2,h3,h4,h5,h6{font-weight:bold;margin:1em 0 .5em;line-height:1.2;hyphens:none}h1{font-size:2em}h2{font-size:1.5em}h3{font-size:1.25em}h4,h5,h6{font-size:1em}h1.title{text-align:center;font-size:2.5em}blockquote p{margin-left:2em;margin-right:2em}section.footnotes p{font-size:.85em}p.tab{white-space:pre-wrap}.bookbinder-after-heading-body + p{text-indent:0}.bookbinder-credit{text-align:center}.bookbinder-folio{font-size:.8em;text-align:center;text-indent:0}";

const defaults: Record<string, Values> = {
	p: { "text-indent": "1.2em" },
	...Object.fromEntries([2, 1.5, 1.25, 1, 1, 1].map((size, index) => ["h" + (index + 1), {
		"font-size": size + "em", "line-height": 1.2, hyphens: "none", "font-weight": "bold", "margin-top": "1em", "margin-bottom": "0.5em", "text-indent": "0pt",
		...(index < 4 ? { "page-break-before": "always" } : {}),
	}])),
	"h1.title": { "font-size": "2.5em", "line-height": 1.2, hyphens: "none", "text-align": "center", "font-weight": "bold", "text-indent": "0pt" },
	"blockquote p": { "margin-left": "2em", "margin-right": "2em" },
	"section.footnotes p": { "font-size": "0.85em", "text-indent": "0pt" },
	sub: { "font-size": "0.75em" }, sup: { "font-size": "0.75em" },
	[folioStyle.selector]: { "font-size": "0.8em", "text-indent": "0pt", "text-align": "center" },
};

function pdfStyleDefinitions(project: Presentation): Record<string, Values> {
	return Object.fromEntries(printBookStyles.map(item => {
		const values = item.selector === "p" ? project.style : /^h[1-6]$/.test(item.selector) ? project.headings[item.selector] : project.styles?.[item.selector];
		const paragraph = ["blockquote p", "section.footnotes p", "p.tab", ".bookbinder-colophon p"].includes(item.selector) ? project.style : {};
		return [item.selector, resolvePrintBodyText(project, { ...paragraph, ...defaults[item.selector], ...values })];
	}));
}

function points(value: string | number, base: number, field: string): number {
	const result = lengthValue(value, "pt", base, 11);
	if (!Number.isFinite(result) || Math.abs(result) > 10000) throw new Error(t("invalidPdfStyle", { field }));
	return Number(result.toFixed(5));
}

export interface LatexStyle { before: string; after: string; inline: string; hidden: boolean; folio?: boolean; overrides?: Values; continuedBefore?: string; marginTop?: number }

export function resolvePrintBodyText(project: Presentation, values: Values): Values {
	return resolveBodyText(values, { "font-family": project.style["font-family"] ?? bodyDefaults["font-family"], "font-size": points(project.style["font-size"] ?? bodyDefaults["font-size"], 11, "font-size") + "pt" });
}

export function pdfStyleValues(project: Presentation, selector: string, rules = false): Values {
	const base = points(project.style["font-size"] ?? bodyDefaults["font-size"], 11, "font-size");
	const definitions = pdfStyleDefinitions(project);
	const rule = rules ? contextRules.find(rule => rule.selector === selector) : undefined;
	const parent = rule ? pdfStyleValues(project, rule.pseudo ? selector.replace("::first-letter", "") : rule.paragraph!, !!rule.pseudo) : undefined;
	const raw = rule ? resolvePrintBodyText(project, { ...(rule.kind === "body" && !rule.pseudo ? { "text-indent": "0pt" } : {}), ...ruleOverrides(project, rule) }) : definitions[selector] ?? {};
	const inheritedSize = parent ? parseFloat(String(parent["font-size"])) : base;
	const size = points(raw["font-size"] ?? inheritedSize, inheritedSize, "font-size");
	const fallbackLine = rule && /^h[1-6](?:\.title)?$/.test(rule.paragraph!) ? definitions[rule.paragraph!]["line-height"] : project.style["line-height"];
	const line = raw["line-height"] ?? (raw["font-size"] !== undefined || !parent ? fallbackLine ?? bodyDefaults["line-height"] : parent["line-height"]);
	const lineHeight = /^\d+(?:\.\d+)?$/.test(String(line)) ? Number(line) : points(line, size, "line-height") / size;
	const inline = ["code", "em", "strong", "del", ".smallcaps", "sub", "sup", "a", "img"].includes(selector);
	const inherited: Values = parent ?? {
		"font-family": ["code", "pre"].includes(selector) ? "monospace" : project.style["font-family"] ?? bodyDefaults["font-family"],
		"font-weight": selector === "strong" ? "bold" : inline ? project.style["font-weight"] ?? "normal" : "normal",
		"font-style": selector === "em" ? project.style["font-style"] === "italic" ? "normal" : "italic" : inline ? project.style["font-style"] ?? "normal" : "normal",
		color: project.style.color ?? bodyDefaults.color, "text-align": ["code", "pre"].includes(selector) ? "left" : "justify",
		"text-indent": base * 1.2 + "pt", "margin-top": "0pt", "margin-bottom": "0pt", "margin-left": "0pt", "margin-right": "0pt", "letter-spacing": "0pt",
		display: "block", "page-break-before": "auto", "page-position": "", hyphens: project.style.hyphens ?? "auto",
	};
	const result: Values = { ...inherited, ...raw, "font-size": size + "pt", "line-height": Number(lineHeight.toFixed(6)) };
	if (selector === folioStyle.selector) {
		const alignment = folioPage(project.page ?? {}).alignment;
		result["text-align"] = alignment === "none" ? "center" : alignment;
	}
	for (const property of ["text-indent", "margin-top", "margin-bottom", "margin-left", "margin-right", "letter-spacing"]) {
		result[property] = raw[property] === undefined ? inherited[property] : points(raw[property], size, property) + "pt";
	}
	return result;
}

export function pdfPresentation(project: BookProject, fonts: readonly string[]): { header: string; styles: Record<string, LatexStyle>; rules: Record<string, LatexStyle>; credit: LatexStyle; colophon: LatexStyle & { positioned: boolean } } {
	const page = pdfPage(project.page), base = points(project.style["font-size"] ?? bodyDefaults["font-size"], 11, "font-size");
	const fontCommands = new Map<string, string>([["serif", "\\rmfamily"], ["sans-serif", "\\sffamily"], ["monospace", "\\ttfamily"],
		...fonts.map((reference, index): [string, string] => [fontFamily(reference), `\\csname bookbinderfont${index}\\endcsname`])]);
	const style = (values: Values, inheritedSize = base): LatexStyle => {
		values = resolvePrintBodyText(project, values);
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
			const line = values["line-height"] ?? project.style["line-height"] ?? bodyDefaults["line-height"];
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
		if (values["page-break-before"] === "left") before += "\\BookbinderEvenPage\n";
		else if (values["page-break-before"] === "right") before += "\\BookbinderOddPage\n";
		else if (values["page-position"] === "one-third") before += "\\clearpage\n";
		else if (values["page-break-before"] === "always") before += "\\clearpage\n";
		if (values["page-position"] === "one-third") before += `\\vspace*{${Math.max(0, page.height / 3 - page.top)}mm}\n`;
		before += "\\par\\begingroup\n" + inline;
		if (values.hyphens !== undefined) before += `\\hyphenpenalty=${values.hyphens === "none" ? 10000 : 50}\\relax\n`;
		if (values["text-align"] !== undefined) {
			const align = new Map([["left", "\\RaggedRight"], ["right", "\\RaggedLeft"], ["center", "\\Centering"], ["justify", "\\justifying"]]).get(String(values["text-align"]));
			if (!align) throw new Error(t("invalidPdfStyle", { field: "text-align" }));
			before += align + "\n";
		}
		for (const [property, command] of [["margin-left", "leftskip"], ["margin-right", "rightskip"], ["text-indent", "parindent"]]) {
			// Alignment resets the skips; add margins without removing their stretch.
			const operation = property !== "text-indent" && values["text-align"] !== undefined ? "addtolength" : "setlength";
			if (values[property] !== undefined) before += `\\${operation}{\\${command}}{${points(values[property], size, property)}pt}\n`;
		}
		const continuedBefore = before;
		if (values["margin-top"] !== undefined && values["page-position"] !== "one-third") before += `\\vspace*{${points(values["margin-top"], size, "margin-top")}pt}\n`;
		after += "\\par\n";
		if (values["margin-bottom"] !== undefined) after += `\\vspace*{${points(values["margin-bottom"], size, "margin-bottom")}pt}\n`;
		after += "\\endgroup\n";
		return { before, after, inline, hidden: values.display === "none", folio: values.folio !== "hide", continuedBefore, marginTop: values["margin-top"] === undefined ? undefined : points(values["margin-top"], size, "margin-top") };
	};
	const definitions = pdfStyleDefinitions(project);
	const colophonValues = definitions[".bookbinder-colophon p"];
	const colophon = { ...style({ "page-break-before": ["left", "right"].includes(String(colophonValues["page-break-before"])) ? colophonValues["page-break-before"] : "always", "page-position": colophonValues["page-position"] ?? "", folio: colophonValues.folio ?? "show" }), positioned: colophonValues["page-position"] === "one-third" };
	if (!colophon.folio) {
		colophon.before += "\\pagestyle{empty}\\thispagestyle{empty}\n";
		colophon.after = "\\thispagestyle{empty}\n" + colophon.after;
	}
	// Position the whole colophon once, keeping its paragraphs on the same page.
	delete colophonValues["page-position"];
	delete colophonValues["page-break-before"];
	if (colophon.positioned) colophonValues["margin-top"] = "0pt";
	const titleRule = contextRules.find(rule => rule.kind === "title" && !rule.pseudo)!;
	const styles = Object.fromEntries(Object.entries(definitions).map(([selector, values]) => [selector, style(values)]));
	const rules: Record<string, LatexStyle> = Object.fromEntries(contextRules.filter(rule => !project.disabledRules.includes(rule.kind!) &&
		(rule.kind === "body" && !rule.scope && !rule.pseudo || Object.keys(project.rules[rule.selector] ?? {}).length)).map(rule => [rule.selector, { ...style({
		...(!rule.pseudo ? definitions[rule.paragraph!] : {}),
		...(rule.kind === "body" && !rule.pseudo ? { "text-indent": "0pt" } : {}), ...ruleOverrides(project, rule),
		...(ruleOverrides(project, rule)["font-size"] !== undefined ? { "font-size": pdfStyleValues(project, rule.selector, true)["font-size"] } : {}),
	}, rule.pseudo ? parseFloat(String(pdfStyleValues(project, rule.selector.replace("::first-letter", ""), true)["font-size"])) : base), overrides: { ...(!rule.pseudo ? definitions[rule.paragraph!] : {}), ...ruleOverrides(project, rule) } }]));
	for (const rule of contextRules.filter(rule => rule.scope === "book" && rules[rule.selector])) {
		const initial = contextRules.find(item => item.paragraph === rule.paragraph && item.pseudo);
		if (initial && Object.keys(project.rules[initial.selector] ?? {}).length) rules[rule.selector + "::first-letter"] = style(resolvePrintBodyText(project, project.rules[initial.selector]), parseFloat(String(pdfStyleValues(project, rule.selector, true)["font-size"])));
	}
	const bookTitleRule = contextRules.find(rule => rule.kind === "title" && rule.scope === "book")!;
	const title = rules[bookTitleRule.selector] ?? rules[titleRule.selector];
	if (title) styles["h1.title"] = title;
	const inherited = Object.fromEntries(Object.entries(project.style).filter(([name]) => ["font-family", "font-size", "line-height", "color"].includes(name)));
	const body = style({ ...bodyDefaults, ...inherited });
	let header = "\\usepackage{ragged2e}\n\\usepackage[normalem]{ulem}\n\\newcommand{\\BookbinderBody}{" + body.inline + `\\hyphenpenalty=${project.style.hyphens === "none" ? 10000 : 50}\\relax` + "\\setlength{\\parindent}{1.2em}\\setlength{\\parskip}{0pt}}\n";
	header += "\\newcommand{\\BookbinderEvenPage}{\\clearpage\\ifodd\\value{page}\\null\\thispagestyle{empty}\\newpage\\fi}\n\\newcommand{\\BookbinderOddPage}{\\clearpage\\ifodd\\value{page}\\else\\null\\thispagestyle{empty}\\newpage\\fi}\n";
	// Distinct marks suppress only pages containing a heading, including after an automatic break.
	header += "\\newmarks\\BookbinderNoFolioMark\n\\newcommand{\\BookbinderFolio}[1]{\\begingroup\\edef\\BookbinderPrevious{\\topmarks\\BookbinderNoFolioMark}\\edef\\BookbinderCurrent{\\botmarks\\BookbinderNoFolioMark}\\ifx\\BookbinderPrevious\\BookbinderCurrent #1\\fi\\endgroup}\n";
	const folio = folioPage(project.page);
	const footer = (even: boolean) => {
		if (folio.position === "none" || styles[folioStyle.selector].hidden) return "";
		const format = style({ ...definitions[folioStyle.selector], "text-align": folioPage(project.page, even).alignment, "page-break-before": "auto", "page-position": "normal" });
		return "\\BookbinderFolio{\\parbox[b]{\\textwidth}{" + format.before + "\\strut\\thepage" + format.after + "}}";
	};
	header += `\\setlength{\\footskip}{${page.bottom - folio.offset}mm}\n\\makeatletter\n\\def\\ps@plain{\\let\\@oddhead\\@empty\\let\\@evenhead\\@empty\\def\\@oddfoot{${footer(false)}}\\def\\@evenfoot{${footer(true)}}}\n\\makeatother\n`;
	header += "\\makeatletter\\renewcommand{\\cleardoublepage}{\\if@twoside\\BookbinderOddPage\\else\\clearpage\\fi}\\makeatother\n";
	const credit = style({ "font-size": base * 0.8 + "pt", "text-align": "center", "text-indent": "0pt", "margin-top": "3em", "margin-left": "0pt", "margin-right": "0pt" });
	return { header, styles, rules, credit, colophon };
}
