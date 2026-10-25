import { getLocale, t } from "./i18n.ts";

export interface BookStyle {
	selector: string;
	label: string;
	sample?: string;
	target?: string;
	pseudo?: string;
	paragraph?: string;
	kind?: string;
}

export const bookStyles: BookStyle[] = [
	{ selector: "p", get label() { return t("bodyText"); } },
	...[1, 2, 3, 4, 5, 6].map(level => ({ selector: "h" + level, get label() { return t("headingLevel", { level }); } })),
	{ selector: "h1.title", get label() { return t("bookTitle"); }, get sample() { return t("previewBookTitle"); }, target: "h1.title" },
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

export function sortedBookStyles(): BookStyle[] {
	return [...bookStyles.slice(0, 8), ...bookStyles.slice(8).sort((left, right) => left.label.localeCompare(right.label, getLocale()))];
}

const ruleParagraphs = [
	{ paragraph: "p", kind: "body", get sample() { return t("previewBodyrule"); } },
	{ paragraph: "blockquote p", kind: "quote", get sample() { return t("previewQuoterule"); } },
	{ paragraph: "section.footnotes p", kind: "footnote", get sample() { return t("previewFootnoterule"); } },
	{ paragraph: "p.tab", kind: "tab", get sample() { return t("previewTabrule"); } },
];

export const contextRules: BookStyle[] = ruleParagraphs.flatMap(style => {
	const { paragraph, kind } = style;
	const target = ".bookbinder-after-heading-" + kind + " + p";
	const selector = paragraph === "blockquote p" ? "blockquote " + target : paragraph === "section.footnotes p" ? "section.footnotes " + target : paragraph === "p.tab" ? target + ".tab" : target;
	return [
		{ selector, paragraph, kind, get label() { return t("firstParagraphOfStyleAfterAHeading", { style: bookStyles.find(item => item.selector === paragraph)!.label }); }, get sample() { return style.sample; }, target },
		{ selector: selector + "::first-letter", paragraph, kind, get label() { return t("firstCharacterOfStyleAfterAHeading", { style: bookStyles.find(item => item.selector === paragraph)!.label }); }, get sample() { return style.sample; }, target, pseudo: "::first-letter" },
	];
});
