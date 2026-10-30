import { getLocale, t } from "./i18n.ts";

export interface BookStyle {
	selector: string;
	label: string;
	sample?: string;
	target?: string;
	pseudo?: string;
	paragraph?: string;
	kind?: string;
	marker?: string;
	wrapper?: "span" | "div" | "contents" | "before";
	scope?: "book";
}

export const bookStyles: BookStyle[] = [
	{ selector: "p", get label() { return t("bodyText"); } },
	...[1, 2, 3, 4, 5, 6].map(level => ({ selector: "h" + level, get label() { return t("headingLevel", { level }); } })),
	{ selector: "h1.title", get label() { return t("bookTitle"); }, get sample() { return t("previewBookTitle"); }, target: "h1.title" },
	{ selector: ".bookbinder-colophon p", get label() { return t("colophon"); }, get sample() { return t("previewColophon"); }, target: ".bookbinder-colophon > p" },
	{ selector: "blockquote p", get label() { return t("quotation"); }, get sample() { return t("previewQuote"); }, target: "p" },
	{ selector: "section.footnotes p", get label() { return t("footnote"); }, get sample() { return t("previewFootnote"); }, target: "p" },
	{ selector: "ul", get label() { return t("bulletedList"); }, get sample() { return t("previewBullets"); } },
	{ selector: "ol", get label() { return t("numberedList"); }, get sample() { return t("previewNumbered"); } },
	{ selector: "li", get label() { return t("listItem"); }, get sample() { return t("previewListitem"); }, target: "li" },
	{ selector: "table", get label() { return t("table"); }, get sample() { return t("previewTable"); } },
	{ selector: "th", get label() { return t("tableHeading"); }, get sample() { return t("previewTableheading"); }, target: "th" },
	{ selector: "td", get label() { return t("tableCell"); }, get sample() { return t("previewTablecell"); }, target: "td" },
	{ selector: "pre", get label() { return t("codeBlock"); }, get sample() { return t("previewCodeblock"); } },
	{ selector: "code", get label() { return t("inlineCode"); }, get sample() { return t("previewInlinecode"); } },
	{ selector: "em", get label() { return t("emphasis"); }, get sample() { return t("previewEmphasis"); } },
	{ selector: "strong", get label() { return t("strongEmphasis"); }, get sample() { return t("previewStrong"); } },
	{ selector: "del", get label() { return t("strikethrough"); }, get sample() { return t("previewStrike"); } },
	{ selector: ".smallcaps", get label() { return t("smallCaps"); }, get sample() { return t("previewSmallcaps"); } },
	{ selector: "sub", get label() { return t("subscript"); }, sample: "<span>H<sub>2</sub>O</span>", target: "sub" },
	{ selector: "sup", get label() { return t("superscript"); }, sample: "<span>m<sup>2</sup></span>", target: "sup" },
	{ selector: "p.tab", get label() { return t("tabulation"); }, get sample() { return t("previewTab"); } },
	{ selector: "hr", get label() { return t("separator"); }, sample: '<div class="bookbinder-separator"></div>', target: ".bookbinder-separator" },
	{ selector: "a", get label() { return t("link"); }, get sample() { return t("previewLink"); } },
	{ selector: "img", get label() { return t("image"); }, get sample() { return t("previewImage"); } },
];

export const folioStyle: BookStyle = { selector: ".bookbinder-folio", get label() { return t("folio"); }, sample: '<p class="bookbinder-folio">123</p>' };
export const noteReferenceStyle: BookStyle = { selector: ".bookbinder-note-reference", get label() { return t("footnoteCall"); }, sample: '<span><sup class="bookbinder-note-reference">1</sup></span>' };
export const footnoteIndexStyle: BookStyle = { selector: ".bookbinder-footnote-index", get label() { return t("footnoteIndex"); }, sample: '<span><sup class="bookbinder-footnote-index">1</sup></span>' };
export const footnoteSeparatorStyle: BookStyle = { selector: ".bookbinder-footnote-separator", get label() { return t("footnoteSeparator"); }, sample: '<div class="bookbinder-footnote-separator"></div>' };
export const printBookStyles = [...bookStyles, folioStyle, noteReferenceStyle, footnoteIndexStyle, footnoteSeparatorStyle];
export const footnoteMarkerDefaults = {
	[noteReferenceStyle.selector]: { "font-family": "body", "font-size": "body", "vertical-align": "super" },
	[footnoteIndexStyle.selector]: { "font-family": "body", "font-size": "0.85em", "vertical-align": "super" },
};

export function sortedBookStyles(format = "epub"): BookStyle[] {
	const styles = format === "epub" ? bookStyles : printBookStyles;
	return [...styles.slice(0, 8), ...styles.slice(8).sort((left, right) => left.label.localeCompare(right.label, getLocale()))];
}

const ruleParagraphs = [
	{ paragraph: "p", kind: "body", get sample() { return t("previewBodyrule"); } },
	{ paragraph: "blockquote p", kind: "quote", get sample() { return t("previewQuoterule"); } },
	{ paragraph: "section.footnotes p", kind: "footnote", get sample() { return t("previewFootnoterule"); } },
	{ paragraph: "p.tab", kind: "tab", get sample() { return t("previewTabrule"); } },
];

const paragraphRules: BookStyle[] = ruleParagraphs.flatMap(style => {
	const { paragraph, kind } = style;
	const target = ".bookbinder-after-heading-" + kind + " + p";
	const selector = paragraph === "blockquote p" ? "blockquote " + target : paragraph === "section.footnotes p" ? "section.footnotes " + target : paragraph === "p.tab" ? target + ".tab" : target;
	return [
		{ selector, paragraph, kind, get label() { return t("firstParagraphOfStyleAfterAHeading", { style: bookStyles.find(item => item.selector === paragraph)!.label }); }, get sample() { return style.sample; }, target },
		{ selector: selector + "::first-letter", paragraph, kind, get label() { return t("firstCharacterOfStyleAfterAHeading", { style: bookStyles.find(item => item.selector === paragraph)!.label }); }, get sample() { return style.sample; }, target, pseudo: "::first-letter" },
	];
});

const ruleKinds: Record<string, string> = { "h1.title": "title", ".bookbinder-colophon p": "colophon", ".smallcaps": "smallcaps" };
const inlineWrappers = new Set(["em", "strong", "del", ".smallcaps", "sub", "sup"]);
const contentWrappers = new Set(["li", "th", "td"]);
const headingRules: BookStyle[] = [...paragraphRules, ...bookStyles.filter(style => !ruleParagraphs.some(rule => rule.paragraph === style.selector)).flatMap(style => {
	const kind = ruleKinds[style.selector] ?? style.selector, marker = "bookbinder-rule-" + kind;
	const wrapper = inlineWrappers.has(style.selector) ? "span" : contentWrappers.has(style.selector) ? "contents" : ["ul", "ol", "hr", ".bookbinder-colophon p"].includes(style.selector) ? "div" : undefined;
	const target = style.target ?? style.selector;
	const selector = "." + marker + (wrapper === "span" ? " > " + style.selector : wrapper === "div" && style.selector === ".bookbinder-colophon p" ? " > p" : "");
	const rule: BookStyle = { selector, paragraph: style.selector, kind, marker, wrapper,
		get label() { return t("firstStyleAfterAHeading", { style: style.label }); },
		get sample() { return style.sample ?? `<${style.selector}>${style.label}</${style.selector}>`; }, target };
	return /^h[1-6]$/.test(style.selector) || style.selector === ".bookbinder-colophon p"
		? [rule, { ...rule, selector: selector + "::first-letter", pseudo: "::first-letter", get sample() { return rule.sample; }, get label() { return t("firstCharacterOfStyleAfterAHeading", { style: style.label }); } }]
		: [rule];
})];

export const contextRules: BookStyle[] = [...headingRules, ...headingRules.filter(rule => !rule.pseudo).map((rule): BookStyle => {
	const marker = "bookbinder-first-" + rule.kind;
	return { ...rule, scope: "book", marker, wrapper: rule.marker ? rule.wrapper : "before",
		selector: rule.selector.replace(rule.marker ?? "bookbinder-after-heading-" + rule.kind, marker),
		get label() { return t("firstStyleInBook", { style: bookStyles.find(style => style.selector === rule.paragraph)!.label }); },
		get sample() { return rule.sample; },
	};
})];

export function ruleOverrides(project: { rules?: Record<string, Record<string, string | number>> }, rule: BookStyle): Record<string, string | number> {
	const parent = rule.scope === "book" ? headingRules.find(item => item.paragraph === rule.paragraph && !item.pseudo) : undefined;
	return { ...(parent ? project.rules?.[parent.selector] : {}), ...project.rules?.[rule.selector] };
}

export const ruleDefinitions = contextRules.filter(rule => !rule.pseudo).map(rule => ({ kind: rule.kind!, selector: rule.selector, paragraph: rule.paragraph!, marker: rule.marker, wrapper: rule.wrapper, scope: rule.scope }));

export function activeRuleDefinitions(project: { rules: Record<string, Record<string, string | number>> }): typeof ruleDefinitions {
	return ruleDefinitions.filter(rule => !rule.marker || [rule.selector, rule.selector + "::first-letter"].some(selector => Object.keys(project.rules[selector] ?? {}).length));
}
