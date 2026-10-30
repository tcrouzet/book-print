import { printBookStyles, contextRules, folioStyle, noteReferenceStyle, footnoteIndexStyle, footnoteSeparatorStyle, footnoteMarkerDefaults, ruleOverrides } from "./book-styles.ts";
import { footnoteSeparator } from "./footnote-separator.ts";
import { pdfStyleValues, resolvePrintBodyText } from "./pdf-presentation.ts";
import { folioPage, pdfPage } from "./page-layout.ts";
import { fontFace, fontFamily, type FontInfoLookup } from "./presentation.ts";
import { lengthValue } from "./length-input.ts";
import type { BookProject } from "./project.ts";
import { t } from "./i18n.ts";

type Values = Record<string, string | number>;
type WordStyle = { id: string; hidden: boolean; run?: string; paragraph?: string; pageBreak?: string; characterFormatting?: boolean };
export function xml(value: unknown): string { return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!); }

export function docxPresentation(project: BookProject, lookup: FontInfoLookup): { styles: Record<string, WordStyle>; rules: Record<string, WordStyle>; styleXml: string; section: string; textWidth: number; oddFooter: string; evenFooter: string; double: boolean } {
	const page = pdfPage(project.page), folio = folioPage(project.page), styles: Record<string, WordStyle> = {}, rules: Record<string, WordStyle> = {};
	const families = new Map<string, string>([["serif", "Times New Roman"], ["sans-serif", "Arial"], ["monospace", "Courier New"], ...project.fonts.map((reference): [string, string] => [fontFamily(reference), fontFace(reference, lookup).family])]);
	const invalid = (name: string): never => { throw new Error(t("fieldNameInvalidPresentationValue", { field: "docx.style", name })); };
	const font = (value: string) => families.get(value) ?? invalid("font-family");
	const run = (values: Values, size: number) => {
		values = resolvePrintBodyText(project, values);
		let output = "";
		if (!Number.isFinite(size) || size <= 0) invalid("font-size");
		if (values["font-style"] !== undefined && !["normal", "italic"].includes(String(values["font-style"]))) invalid("font-style");
		if (values["font-weight"] !== undefined && !["normal", "bold"].includes(String(values["font-weight"]))) invalid("font-weight");
		if (values["font-family"] !== undefined) { const family = xml(font(String(values["font-family"]).split(",")[0].trim().replace(/^['"]|['"]$/g, ""))); output += `<w:rFonts w:ascii="${family}" w:hAnsi="${family}" w:cs="${family}"/>`; }
		if (values["font-size"] !== undefined) output += `<w:sz w:val="${Math.round(size * 2)}"/><w:szCs w:val="${Math.round(size * 2)}"/>`;
		if (values["font-weight"] !== undefined) output += `<w:b w:val="${values["font-weight"] === "bold" || Number(values["font-weight"]) >= 600 ? 1 : 0}"/>`;
		if (values["font-style"] !== undefined) output += `<w:i w:val="${values["font-style"] === "italic" ? 1 : 0}"/>`;
		if (values["text-transform"] !== undefined) output += `<w:caps w:val="${values["text-transform"] === "uppercase" ? 1 : 0}"/>`;
		if (values["font-variant"] !== undefined) output += `<w:smallCaps w:val="${values["font-variant"] === "small-caps" ? 1 : 0}"/>`;
		if (values["vertical-align"] !== undefined) output += `<w:vertAlign w:val="${values["vertical-align"] === "super" ? "superscript" : values["vertical-align"] === "sub" ? "subscript" : "baseline"}"/>`;
		if (values.color !== undefined) {
			const colors: Record<string, string> = { black: "000000", white: "FFFFFF", red: "FF0000", green: "008000", blue: "0000FF", gray: "808080", transparent: "FFFFFF" };
			const hex = String(values.color).match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i)?.[1];
			const color = hex ? hex.length === 3 ? [...hex].map(char => char.repeat(2)).join("") : hex : colors[String(values.color)];
			if (typeof color !== "string" || !/^[0-9a-f]{6}$/i.test(color)) invalid("color");
			output += `<w:color w:val="${color}"/>`;
		}
		if (values["letter-spacing"] !== undefined) output += `<w:spacing w:val="${Math.round(lengthValue(values["letter-spacing"], "pt", size) * 20)}"/>`;
		if (values.display === "none") output += "<w:vanish/>";
		return output;
	};
	const lineHeight = (selector: string) => (selector === "p" ? project.style : /^h[1-6]$/.test(selector) ? project.headings[selector] : project.styles[selector])?.["line-height"] ?? (/^h[1-6](?:\.title)?$/.test(selector) ? 1.2 : project.style["line-height"]);
	const paragraph = (values: Values, size: number, leading = project.style["line-height"]) => {
		if (!Number.isFinite(Number(values["line-height"])) || Number(values["line-height"]) <= 0) invalid("line-height");
		if (values["text-align"] !== undefined && !["left", "center", "right", "justify"].includes(String(values["text-align"]))) invalid("text-align");
		const twips = (name: string) => Math.round(lengthValue(values[name] ?? "0pt", "pt", size) * 20);
		const indent = twips("text-indent"), positioned = values["page-position"] === "one-third", parity = ["left", "right"].includes(String(values["page-break-before"]));
		const fixedLeading = /(?:pt|mm|cm|in|px|pc|rem)\s*$/i.test(String(leading));
		return `<w:pageBreakBefore w:val="${!parity && (positioned || values["page-break-before"] === "always") ? 1 : 0}"/>` +
			`<w:suppressAutoHyphens w:val="${values.hyphens === "none" ? 1 : 0}"/>` +
			`<w:spacing w:before="${positioned ? Math.round(Math.max(0, page.height / 3 - page.top) * 1440 / 25.4) : twips("margin-top")}" w:after="${twips("margin-bottom")}" w:line="${Math.round(Number(values["line-height"]) * (fixedLeading ? size * 20 : 240))}" w:lineRule="${fixedLeading ? "exact" : "auto"}"/>` +
			`<w:ind w:left="${twips("margin-left")}" w:right="${twips("margin-right")}" ${indent < 0 ? "w:hanging" : "w:firstLine"}="${Math.abs(indent)}"/>` +
			`<w:jc w:val="${values["text-align"] === "justify" ? "both" : xml(values["text-align"] ?? "left")}"/>`;
	};
	const partialParagraph = (properties: string, explicit: Values) => {
		const attributes: Record<string, string> = { before: "margin-top", after: "margin-bottom", line: "line-height", lineRule: "line-height", left: "margin-left", right: "margin-right", firstLine: "text-indent", hanging: "text-indent" };
		return properties.replace(/<w:(spacing|ind)\b([^>]*)\/>/g, (_, tag: string, attrs: string) => {
			const kept = [...attrs.matchAll(/w:(\w+)="[^"]*"/g)].filter(match => explicit[attributes[match[1]]] !== undefined).map(match => match[0]).join(" ");
			return kept ? `<w:${tag} ${kept}/>` : "";
		}).replace(/<w:jc[^>]*\/>/g, match => explicit["text-align"] !== undefined ? match : "").replace(/<w:pageBreakBefore[^>]*\/>/g, match => explicit["page-break-before"] !== undefined ? match : "").replace(/<w:suppressAutoHyphens[^>]*\/>/g, match => explicit.hyphens !== undefined ? match : "");
	};
	let styleXml = "";
	for (const [index, item] of printBookStyles.entries()) {
		if (item.selector === footnoteSeparatorStyle.selector) {
			const separator = footnoteSeparator(project), width = Math.round(separator.width * 20), remaining = separator.hidden ? 0 : Math.round(separator.textWidth * 20) - width;
			const left = separator.alignment === "right" ? remaining : separator.alignment === "center" ? Math.round(remaining / 2) : 0;
			const id = "BookbinderFootnoteSeparator";
			styles[item.selector] = { id, hidden: separator.hidden };
			const border = separator.hidden ? "" : `<w:pBdr><w:top w:val="single" w:sz="${Math.max(2, Math.round(separator.thickness * 8))}" w:space="0" w:color="${separator.color}"/></w:pBdr>`;
			styleXml += `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${xml(item.label)}"/><w:pPr>${border}<w:spacing w:before="0" w:after="${separator.hidden ? 0 : 52}" w:line="1" w:lineRule="exact"/><w:ind w:left="${left}" w:right="${remaining - left}" w:firstLine="0"/></w:pPr></w:style>`;
			continue;
		}
		const titleRule = contextRules.find(rule => rule.kind === "title" && rule.scope === "book" && Object.keys(project.rules[rule.selector] ?? {}).length) ?? contextRules.find(rule => rule.kind === "title" && !rule.pseudo)!;
		const titleOverride = item.selector === "h1.title" && !project.disabledRules.includes("title") && Object.keys(project.rules[titleRule.selector] ?? {}).length;
		const values = pdfStyleValues(project, titleOverride ? titleRule.selector : item.selector, !!titleOverride), size = parseFloat(String(values["font-size"]));
		if (item.selector === folioStyle.selector) { values["page-break-before"] = "auto"; delete values["page-position"]; }
		const character = ["em", "strong", "del", ".smallcaps", "sub", "sup", "a", "code", "img", noteReferenceStyle.selector, footnoteIndexStyle.selector].includes(item.selector);
		const id = item.selector === folioStyle.selector ? "BookbinderFolio" : "BookbinderStyle" + index;
		styles[item.selector] = { id, hidden: values.display === "none" };
		if (!character) styles[item.selector].pageBreak = String(values["page-break-before"]);
		const explicit = project.styles[item.selector] ?? {};
		styles[item.selector].characterFormatting = ["vertical-align", "text-transform", "font-variant"].some(name => explicit[name] !== undefined);
		const inline: Values = { ...(footnoteMarkerDefaults[item.selector] ?? (item.selector === "em" ? { "font-style": "italic" } : item.selector === "strong" ? { "font-weight": "bold" } : item.selector === "code" ? { "font-family": "monospace" } : item.selector === ".smallcaps" ? { "font-variant": "small-caps" } : item.selector === "sub" ? { "vertical-align": "sub" } : item.selector === "sup" ? { "vertical-align": "super" } : {})), ...explicit };
		const extra = item.selector === "a" ? '<w:u w:val="single"/>' : item.selector === "del" ? '<w:strike/>' : "";
		const p = character ? "" : (/^h[1-6]$/.test(item.selector) ? "<w:keepNext/>" : "") + paragraph(values, size, lineHeight(item.selector)) + (/^h[1-6]$/.test(item.selector) ? `<w:outlineLvl w:val="${Number(item.selector[1]) - 1}"/>` : "");
		const runXml = run(character ? inline : values, size) + extra;
		styles[item.selector].run = character ? runXml : run(explicit, size);
		if (!character) {
			// Container rules inherit only the child style's explicit paragraph overrides.
			styles[item.selector].paragraph = partialParagraph(p, explicit);
		}
		const properties = (character ? "" : `<w:pPr>${p}</w:pPr>`) + `<w:rPr>${runXml}</w:rPr>`;
		styleXml += `<w:style w:type="${character ? "character" : "paragraph"}" w:styleId="${id}"><w:name w:val="${xml(item.label)}"/><w:basedOn w:val="${character ? "DefaultParagraphFont" : "Normal"}"/><w:qFormat/>${properties}</w:style>`;
		if (/^h[1-6]$/.test(item.selector)) styleXml += `<w:style w:type="paragraph" w:styleId="Heading${item.selector[1]}"><w:name w:val="heading ${item.selector[1]}"/><w:basedOn w:val="${id}"/>${properties}</w:style>`;
		if (item.selector === "pre" || item.selector === "code" || item.selector === "a") {
			const native = item.selector === "pre" ? "SourceCode" : item.selector === "code" ? "VerbatimChar" : "Hyperlink";
			styleXml += `<w:style w:type="${character ? "character" : "paragraph"}" w:styleId="${native}"><w:name w:val="${native}"/><w:basedOn w:val="${id}"/>${properties}</w:style>`;
		}
	}
	for (const [index, rule] of contextRules.entries()) {
		if (project.disabledRules.includes(rule.kind!)) continue;
		if (!(rule.kind === "body" && !rule.scope && !rule.pseudo) && !Object.keys(project.rules[rule.selector] ?? {}).length) continue;
		const id = "BookbinderRule" + index, values = pdfStyleValues(project, rule.selector, true), size = parseFloat(String(values["font-size"]));
		const character = !!rule.pseudo || ["em", "strong", "del", ".smallcaps", "sub", "sup", "a", "code", "img"].includes(rule.paragraph!);
		const overrides = ruleOverrides(project, rule);
		const runXml = run(character ? overrides : values, size);
		const p = character ? "" : paragraph(values, size, overrides["line-height"] ?? lineHeight(rule.paragraph!));
		const explicit = { ...project.styles[rule.paragraph!], ...overrides };
		const parentRun = styles[rule.paragraph!].run ?? "";
		const inheritedRun = parentRun.replace(/<w:(\w+)\b[^>]*\/>/g, (match, tag: string) => runXml.includes(`<w:${tag} `) || runXml.includes(`<w:${tag}/`) ? "" : match);
		rules[rule.selector] = { id, hidden: values.display === "none", run: character ? inheritedRun + runXml : run(explicit, size), ...(!character ? { pageBreak: String(values["page-break-before"]), paragraph: partialParagraph(p, explicit) } : {}) };
		styleXml += `<w:style w:type="${character ? "character" : "paragraph"}" w:styleId="${id}"><w:name w:val="${xml(rule.label)}"/><w:basedOn w:val="${rule.pseudo ? "DefaultParagraphFont" : styles[rule.paragraph!].id}"/><w:pPr>${p}</w:pPr><w:rPr>${runXml}</w:rPr></w:style>`;
		if (rule.scope === "book") {
			const initial = contextRules.find(item => item.paragraph === rule.paragraph && item.pseudo);
			if (initial && Object.keys(project.rules[initial.selector] ?? {}).length) {
				const raw = resolvePrintBodyText(project, project.rules[initial.selector]);
				const runXml = run(raw, lengthValue(raw["font-size"] ?? size, "pt", size, 11));
				const initialId = id + "Initial";
				rules[rule.selector + "::first-letter"] = { id: initialId, hidden: raw.display === "none", run: runXml };
				styleXml += `<w:style w:type="character" w:styleId="${initialId}"><w:name w:val="${initialId}"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr>${runXml}</w:rPr></w:style>`;
			}
		}
	}
	const body = pdfStyleValues(project, "p"), bodySize = parseFloat(String(body["font-size"]));
	styleXml += `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr>${paragraph(body, bodySize)}</w:pPr><w:rPr>${run(body, bodySize)}</w:rPr></w:style>`;
	const footer = (even: boolean) => `<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${folio.position === "none" || styles[folioStyle.selector].hidden ? "" : `<w:p><w:pPr><w:pStyle w:val="BookbinderFolio"/><w:jc w:val="${folioPage(project.page, even).alignment}"/></w:pPr><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>`}</w:ftr>`;
	const mm = (value: number) => Math.round(value * 1440 / 25.4);
	const section = `<w:pgSz w:w="${mm(page.width)}" w:h="${mm(page.height)}"/><w:pgMar w:top="${mm(page.top)}" w:right="${mm(page.right)}" w:bottom="${mm(page.bottom)}" w:left="${mm(page.left)}" w:header="0" w:footer="${mm(folio.offset)}" w:gutter="${mm(page.binding)}"/><w:titlePg/>`;
	return { styles, rules, styleXml, section, textWidth: mm(page.width - page.left - page.right - page.binding), oddFooter: footer(false), evenFooter: footer(true), double: page.double };
}
