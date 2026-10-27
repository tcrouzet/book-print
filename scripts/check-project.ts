import assert from "node:assert/strict";
import { bookStyles, contextRules, ruleDefinitions } from "../plugin/book-styles.ts";
import { folioPage, folioPositions, millimetres, pdfPage } from "../plugin/page-layout.ts";
import { pdfPresentation, pdfStyleValues } from "../plugin/pdf-presentation.ts";
import { docxPresentation } from "../plugin/docx-presentation.ts";
import { excluded, isProjectNote, localResource, noteSeparators, parseProject, prepareMarkdown, projectCss } from "../plugin/project.ts";
import { setLocale } from "../plugin/i18n.ts";
import "./check-i18n.ts";
import { defaultFilename, slugFilename } from "../plugin/filename.ts";
import { applyDefaultFont, defaultPdfFont, fontChoices, fontFamily, fontsInStyles, fontVariants, projectCss as fontCss, resolveFontFamilies } from "../plugin/presentation.ts";
import { lengthValue } from "../plugin/length-input.ts";

setLocale("fr");
assert.equal(millimetres("5 mm"), 5, "Measurement input accepts a space before its unit");
assert.ok(Math.abs(lengthValue("5mm", "pt") - 360 / 25.4) < 1e-10);
assert.equal(lengthValue("2,54 cm", "mm"), 25.4);
assert.equal(lengthValue("12 pt", "em", 12), 1);
assert.equal(lengthValue("150%", "", 12), 1.5);
for (const value of ["calc(1mm)", "5mm;display:none", "NaN", "Infinity", "5foobar", "", "12\\input{bad}", "9".repeat(1000)]) assert.ok(!Number.isFinite(lengthValue(value, "pt")));

const bodyRule = ".bookbinder-after-heading-body + p";
const bodyCharacter = bodyRule + "::first-letter";

for (const format of ["epub", "pdf", "docx"] as const) {
	for (const [property, values] of Object.entries({ "vertical-align": ["baseline", "super", "sub"], "text-transform": ["none", "uppercase"], "font-variant": ["normal", "small-caps"] })) {
		for (const value of values) {
			const formatted = parseProject({ [format]: { style: { [property]: value }, rules: { [bodyCharacter]: { [property]: value } } } }, "Characters", format);
			assert.equal(formatted.style[property], value); assert.equal(formatted.rules[bodyCharacter][property], value);
		}
		for (const invalid of ["bad", 1, "super;display:none"]) assert.throws(() => parseProject({ [format]: { style: { [property]: invalid } } }, "Characters", format), new RegExp(property));
	}
	for (const property of ["font-family", "font-size"]) assert.throws(() => parseProject({ [format]: { style: { [property]: "body" } } }, "No self reference", format));
	const project = parseProject({ [format]: { style: { "font-size": format === "epub" ? "1.25em" : "14pt", "font-family": "sans-serif" }, headings: { h3: { "font-size": "body", "font-family": "body" } }, styles: { code: { "font-size": "body", "font-family": "body" } }, rules: { [bodyCharacter]: { "font-size": "body", "font-family": "body" } } } }, "Body reference", format);
	assert.deepEqual(project.headings.h3, { "font-size": "body", "font-family": "body" }, "References stay editable in the project");
	if (format === "epub") {
		assert.match(projectCss(project), /h3\{font-size:1\.25rem;font-family:sans-serif\}/);
		assert.match(projectCss(project), /body code\{font-size:1\.25rem;font-family:sans-serif\}/);
		assert.match(projectCss({ ...project, style: {} }), /h3\{font-size:1rem;font-family:initial\}/, "Body Auto follows the reader defaults");
	} else {
		for (const selector of ["h3", "code", bodyCharacter]) {
			const values = pdfStyleValues(project, selector, selector === bodyCharacter);
			assert.equal(values["font-size"], "14pt"); assert.equal(values["font-family"], "sans-serif");
		}
		assert.ok(pdfPresentation(project, project.fonts).styles.h3.inline.includes("\\fontsize{14pt}"));
		const word = docxPresentation(project, () => undefined);
		const heading = word.styleXml.match(/<w:style[^>]*w:styleId="Heading3"[^>]*>([^]*?)<\/w:style>/)![1];
		assert.match(heading, /w:sz w:val="28"/); assert.match(heading, /w:rFonts w:ascii="Arial"/);
		project.style["font-size"] = "18pt";
		assert.equal(pdfStyleValues(project, "h3")["font-size"], "18pt", "The reference follows later body changes");
	}
}

const availableFonts = ["library:a.ttf", "library:b.otf", "library:unused.ttf"];
const fontStyles = { style: {}, headings: { h2: { "font-family": fontFamily("a.ttf") } }, styles: {}, rules: {}, fonts: ["missing-unused.otf"] };
assert.deepEqual(fontsInStyles(fontStyles, availableFonts), ["library:a.ttf"], "Only a style declaration selects a library font");
assert.deepEqual(fontsInStyles({ ...fontStyles, headings: {}, fonts: availableFonts }), [], "Unused imports and old resource lists do not select fonts");
assert.deepEqual(fontsInStyles({ ...fontStyles, style: { "font-family": `'${fontFamily("b.otf")}', serif` } }, availableFonts), ["library:a.ttf", "library:b.otf"]);
assert.deepEqual(fontsInStyles({ ...fontStyles, headings: {}, rules: { [bodyCharacter]: { "font-family": fontFamily("b.otf") } } }, availableFonts), ["library:b.otf"], "Character rules declare fonts too");
assert.deepEqual(fontsInStyles({ ...fontStyles, fonts: ["fonts/a.ttf"] }, availableFonts), ["fonts/a.ttf"], "Legacy paths keep priority over duplicate library filenames");
assert.deepEqual(fontsInStyles({ ...fontStyles, headings: {}, fonts: ["fonts/custom.ttf"], css: ["custom.css"] }, availableFonts), ["fonts/custom.ttf"], "Explicit resources remain compatible with custom stylesheets");
assert.deepEqual(fontStyles.fonts, ["missing-unused.otf"], "Computing font resources does not mutate the project");
const garamondFaces = ["Regular", "Bold", "Italic", "BoldItalic"].map(face => `library:EBGaramond-${face}.otf`);
assert.deepEqual(fontVariants(defaultPdfFont, garamondFaces), { bold: garamondFaces[1], italic: garamondFaces[2], boldItalic: garamondFaces[3] });
assert.deepEqual(fontVariants(garamondFaces[1], garamondFaces), { bold: garamondFaces[1], italic: garamondFaces[3], boldItalic: garamondFaces[3] }, "Choosing a bold face preserves its weight when italic is applied");
assert.deepEqual(fontVariants(defaultPdfFont, []), {}, "Unavailable faces are never fabricated");
assert.deepEqual(fontChoices(garamondFaces), [defaultPdfFont], "One family choice replaces all four variant files");
const familyProject = { style: { "font-family": fontFamily(garamondFaces[3]) }, headings: {}, fonts: [] };
resolveFontFamilies(familyProject, garamondFaces);
assert.deepEqual(familyProject.style, { "font-family": fontFamily(defaultPdfFont), "font-weight": "bold", "font-style": "italic" }, "A selected variant becomes a family and its formatting flags");
assert.deepEqual(familyProject.fonts, garamondFaces, "All four faces are selected automatically for Markdown emphasis");
assert.match(fontCss(familyProject), new RegExp(`font-family:"${fontFamily(defaultPdfFont)}";font-weight:700;font-style:italic;src:url`));
const renamedFaces = ["library:a.otf", "library:b.otf", "library:c.otf", "library:d.otf"];
const infos = renamedFaces.map((_, index) => ({ family: "Renamed family", weight: index % 2 ? 700 : 400, style: index >= 2 ? "italic" as const : "normal" as const }));
const lookup = (reference: string) => infos[renamedFaces.indexOf(reference)];
assert.deepEqual(fontChoices(renamedFaces, lookup), [renamedFaces[0]], "Headers group files even when their filenames do not describe their faces");
assert.equal(fontVariants(renamedFaces[0], renamedFaces, lookup).boldItalic, renamedFaces[3]);
const aliases = ["library:z.ttf", "library:a.ttf"];
const sameFamily = () => ({ family: "Same family", weight: 400, style: "normal" as const });
assert.deepEqual(fontChoices(aliases, sameFamily), fontChoices(aliases.slice().reverse(), sameFamily), "The canonical face is independent of resource loading order");
const explicitFonts = ["fonts/EBGaramond-Regular.otf"];
const existingFont = { style: {}, headings: {}, fonts: explicitFonts };
applyDefaultFont(existingFont, defaultPdfFont);
assert.deepEqual(existingFont.fonts, explicitFonts, "A local copy of the same font keeps priority");

const defaults = parseProject(undefined, "Manuscrit");
assert.equal(defaults.metadata.title, "Manuscrit");
assert.equal(defaults.metadata.lang, "fr");
assert.equal(parseProject({ title: "L’expérience humaine", author: "Thierry Crouzet" }, "Livre").filename, "crouzet-experience-humaine");
assert.equal(defaultFilename("L'expérience\\nhumaine", ["Thierry Crouzet", "Marie Dupont"]), "crouzet-experience-humaine");
assert.equal(parseProject({ title: "Été à vélo", filename: " Ma nouvelle édition.EPUB " }, "Livre").filename, "ma-nouvelle-edition");
for (const filename of [undefined, null, "", "   ", "✨"]) assert.equal(parseProject({ title: "Été à vélo", filename }, "Livre").filename, "ete-a-velo");
assert.throws(() => parseProject({ filename: 12 }, "Livre"), /filename/);
assert.equal(defaultFilename("漢字", ""), "book");
assert.equal(slugFilename("Œuvres de cœur & æther ß"), "oeuvres-de-coeur-aether-ss");
assert.equal(slugFilename("CON"), "con-book");
assert.ok(slugFilename("a".repeat(300)).length <= 200);
for (const filename of ["../../autre", "C:\\livres\\autre.epub", "/tmp/autre", "a\0b", "..", "א ب"]) {
	const project = parseProject({ title: "Livre", filename }, "Livre");
	assert.match(project.filename, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Le nom reste un slug sans chemin ni extension");
}
const filenameAlphabet = ["a", "É", "œ", "ß", "/", "\\", "\0", "漢字", "😀", "-", " ", ":", ".", "²"];
let filenameSeed = 107;
for (let sample = 0; sample < 128; sample++) {
	let value = "";
	for (let character = 0; character < 32; character++) {
		filenameSeed = (Math.imul(filenameSeed, 1664525) + 1013904223) >>> 0;
		value += filenameAlphabet[filenameSeed % filenameAlphabet.length];
	}
	const slug = slugFilename(value);
	assert.match(slug, /^(?:[a-z0-9]+(?:-[a-z0-9]+)*)?$/);
	assert.equal(slugFilename(slug), slug, "Normaliser un slug est stable");
}
assert.equal(parseProject({ colophon: "Texte *du colophon*." }, "Livre").metadata.colophon, "Texte *du colophon*.");
assert.throws(() => parseProject({ colophon: 12 }, "Livre"));
assert.equal(parseProject({ colophon: null }, "Livre").metadata.colophon, undefined);
assert.equal(defaults.tocDepth, 2);
for (const format of ["pdf", "docx"] as const) {
	const project = parseProject({ [format]: { headings: { h3: { "page-position": "one-third" } }, rules: { ".bookbinder-first-h3": { "page-position": "normal", "margin-top": "0pt" } } } }, "Livre", format);
	assert.equal(pdfStyleValues(project, ".bookbinder-first-h3", true)["page-position"], "normal");
	const compiled = pdfPresentation(project, project.fonts);
	assert.ok(compiled.styles.h3.before.includes("\\vspace*{50mm}"));
	assert.ok(!compiled.rules[".bookbinder-first-h3"].before.includes("\\vspace*{50mm}"), "A normal rule applies its top margin instead of the inherited one-third offset");
	const word = docxPresentation(project, () => undefined), id = word.rules[".bookbinder-first-h3"].id;
	const conditional = [...word.styleXml.matchAll(/<w:style[^>]*w:styleId="([^"]+)"[^>]*>([^]*?)<\/w:style>/g)].find(match => match[1] === id)![2];
	assert.match(conditional, /<w:spacing w:before="0"/, "DOCX also honors a zero top margin overriding one-third positioning");
}
const positionedColophon = parseProject({ pdf: { styles: { ".bookbinder-colophon p": { "page-position": "one-third", "margin-top": "30pt" } } } }, "Livre", "pdf");
const compiledColophon = pdfPresentation(positionedColophon, positionedColophon.fonts);
assert.ok(compiledColophon.colophon.positioned && compiledColophon.colophon.before.includes("\\vspace*{50mm}"));
assert.ok(!compiledColophon.styles[".bookbinder-colophon p"].before.includes("\\clearpage"), "Colophon paragraphs do not each start a new page");
assert.ok(!compiledColophon.styles[".bookbinder-colophon p"].before.includes("\\vspace*{30pt}"), "Positioning suppresses the normal top margin without overwriting it");
assert.equal(positionedColophon.styles[".bookbinder-colophon p"]["margin-top"], "30pt");
for (const folio of ["show", "hide"]) {
	const project = parseProject({ pdf: { styles: { ".bookbinder-colophon p": { folio } } } }, "Livre", "pdf");
	const compiled = pdfPresentation(project, project.fonts).colophon;
	assert.equal(compiled.folio, folio === "show");
	assert.equal(compiled.before.includes("\\pagestyle{empty}"), folio === "hide");
	assert.equal(compiled.after.includes("\\thispagestyle{empty}"), folio === "hide");
	for (const format of ["epub", "docx"] as const) assert.throws(() => parseProject({ [format]: { styles: { ".bookbinder-colophon p": { folio } } } }, "Livre", format));
}
assert.match(projectCss(positionedColophon, undefined, "pdf"), /body \.bookbinder-colophon\{[^}]*padding-top:33\.3333vh\}/);
assert.doesNotMatch(projectCss(positionedColophon, undefined, "pdf"), /body \.bookbinder-colophon p\{[^}]*padding-top/);
for (const format of ["epub", "docx"] as const) assert.throws(() => parseProject({ [format]: { styles: { ".bookbinder-colophon p": { "page-position": "one-third" } } } }, "Livre", format));
for (let level = 1; level <= 6; level++) for (const folio of ["show", "hide"]) {
	const project = parseProject({ pdf: { headings: { ["h" + level]: { folio } }, rules: { [".bookbinder-first-h" + level]: { folio: "show" } } } }, "Livre", "pdf");
	assert.equal(pdfPresentation(project, project.fonts).styles["h" + level].folio, folio === "show");
	assert.equal(pdfPresentation(project, project.fonts).rules[".bookbinder-first-h" + level].folio, true, "Heading rules can override their base folio setting");
	assert.ok(!projectCss(project, undefined, "pdf").includes("folio:"), "Folio policy is not a CSS property");
}
for (const data of [{ pdf: { headings: { h2: { folio: "yes" } } } }, { pdf: { style: { folio: "hide" } } }, { pdf: { rules: { [bodyRule]: { folio: "hide" } } } }, { pdf: { rules: { ".bookbinder-rule-h3::first-letter": { folio: "hide" } } } }, { docx: { headings: { h2: { folio: "hide" } } } }, { epub: { headings: { h2: { folio: "hide" } } } }]) for (const format of Object.keys(data) as ("pdf" | "docx" | "epub")[]) assert.throws(() => parseProject(data, "Livre", format));
for (const format of ["pdf", "docx"] as const) {
	assert.deepEqual(parseProject(undefined, "Livre", format).titlePage, { copyright: false, characterCount: false });
	for (const copyright of [false, true]) for (const count of [false, true]) assert.deepEqual(parseProject({ [format]: { "title-page": { copyright, "character-count": count } } }, "Livre", format).titlePage, { copyright, characterCount: count });
	for (const settings of [{ copyright: "true" }, { "character-count": 1 }, { unexpected: true }]) assert.throws(() => parseProject({ [format]: { "title-page": settings } }, "Livre", format));
}
assert.throws(() => parseProject({ rights: 123 }, "Livre"));
for (const format of ["pdf", "docx", "epub"] as const) {
	assert.equal(parseProject(undefined, "Livre", format).toc, format !== "epub", "Existing defaults retain their visible or navigation-only contents");
	for (const enabled of [false, true]) for (const depth of [1, 2, 3, 6]) {
		const configured = parseProject({ [format]: { toc: enabled, "toc-depth": depth } }, "Livre", format);
		assert.equal(configured.toc, enabled); assert.equal(configured.tocDepth, depth);
	}
	for (const settings of [{ toc: "false" }, { toc: null }, { toc: 0 }, { "toc-depth": 0 }, { "toc-depth": 7 }, { "toc-depth": "2" }]) assert.throws(() => parseProject({ [format]: settings }, "Livre", format));
}
assert.deepEqual(defaults.styles, {});
assert.deepEqual(defaults.page, {});
assert.deepEqual(defaults.disabledRules, []);
assert.equal(defaults.separator, undefined);
const positionedHeading = parseProject({ epub: { headings: { h2: { "page-position": "one-third", "page-offset": "40mm", "margin-top": "2em", "page-break-before": "auto" } } } }, "Livre");
const unsupportedPosition = { epub: { headings: { h2: { "page-position": "two-thirds" } } } };
assert.throws(() => parseProject(unsupportedPosition, "Livre"), /page-position/, "Seule la position actuelle est acceptée");
assert.equal(positionedHeading.headings.h2["page-position"], "one-third");
for (let level = 1; level <= 6; level++) {
	assert.equal(parseProject({ epub: { headings: { ["h" + level]: { "page-position": "one-third" } } } }, "Livre").headings["h" + level]["page-position"], "one-third");
}
const positionedCss = projectCss(positionedHeading);
assert.match(positionedCss, /h2\{[^}]*padding-top:40mm/);
assert.match(positionedCss, /page-break-before:always;break-before:page;margin-top:0/);
assert.doesNotMatch(positionedCss, /page-position|page-offset|\dvh\b/);
for (const format of ["pdf", "docx"]) assert.match(projectCss(positionedHeading, undefined, format), /padding-top:33\.3333vh/, "Print previews keep their proportional positioning");
delete positionedHeading.headings.h2["page-position"];
assert.match(projectCss(positionedHeading), /h2\{margin-top:2em;page-break-before:auto\}/);
assert.doesNotMatch(projectCss(positionedHeading), /padding-top/);
for (const value of ["middle", "red;}body{display:none", 2, ["one-third"]]) assert.throws(() => parseProject({ epub: { headings: { h2: { "page-position": value } } } }, "Livre"));
assert.throws(() => parseProject({ epub: { style: { "page-position": "one-third" } } }, "Livre"));
for (const offset of ["-1mm", "301mm", "15em", "1rem", "30%", "auto", "Infinity", ["50mm"], null, "50mm;}body{display:none"]) assert.throws(() => parseProject({ epub: { headings: { h3: { "page-offset": offset } } } }, "Invalid offset"), /page-offset/);
for (const format of ["pdf", "docx"] as const) assert.throws(() => parseProject({ [format]: { headings: { h3: { "page-offset": "50mm" } } } }, "EPUB only", format));
for (const [offset, expected] of [[0, "0mm"], ["5cm", "50mm"], ["144pt", "50.8mm"]] as const) {
	assert.ok(projectCss(parseProject({ epub: { headings: { h3: { "page-position": "one-third", "page-offset": offset } } } }, "Fixed offset")).includes("padding-top:" + expected));
}
for (const separator of ["", "⁂ · ⁂", "***", '<img src=x onerror="alert(1)">', "\\\"{};", "א ب"]) {
	assert.equal(parseProject({ epub: { separator } }, "Livre").separator, separator);
}
for (const separator of [null, 1, {}, [], "\0"]) assert.throws(() => parseProject({ epub: { separator } }, "Livre"), /epub.separator/);
assert.match(projectCss(parseProject({ epub: { styles: { hr: { color: "red" } } } }, "Livre")), /body hr,body \.bookbinder-separator\{color:red\}/);
const noBodyRule = parseProject({ epub: { "disabled-rules": ["body"], rules: { [bodyCharacter]: { "font-size": "2em" } } } }, "Livre");
assert.deepEqual(noBodyRule.disabledRules, ["body"]);
assert.equal(noBodyRule.rules[bodyCharacter]["font-size"], "2em");
assert.ok(!projectCss(noBodyRule).includes("font-size:2em"));
assert.ok(projectCss({ ...noBodyRule, disabledRules: [] }).includes("font-size:2em"));
for (const value of ["body", {}, ["unknown"], [null], [1]]) {
	assert.throws(() => parseProject({ epub: { "disabled-rules": value } }, "Livre"), /disabled-rules/);
}
assert.deepEqual(Array.from(noteSeparators.values(), choice => choice.label), ["Vide", "Saut de page", "Saut de page paire", "Saut de page impaire"]);
for (const separator of ["", "page", "even", "odd", "***", "constructor"]) {
	assert.equal(parseProject({ fusion: { noteSeparator: separator } }, "Livre").fusion.noteSeparator, separator);
}
assert.equal(parseProject({ title: null, author: null, subtitle: null }, "Titre").metadata.title, "Titre");
const configured = parseProject({
	title: "L’expérience\\nhumaine", author: ["Auteur", "Autrice"], identifier: "ISBN-0",
	epub: { "toc-depth": 2, "split-level": 3, fonts: ["fonts/Adamant.otf"], page: { "margin-top": "1.2em" }, style: { "font-size": "1.1em" }, headings: { h2: { color: "#888" } } },
	fusion: { excludeNames: "sortspec, Brouillons" },
}, "Ignored");
assert.equal(configured.metadata.identifier, "ISBN-0");
assert.equal(configured.splitLevel, 3);
assert.deepEqual(configured.fonts, ["fonts/Adamant.otf"]);
assert.match(projectCss(configured), /h2\{color:#888\}/);
assert.match(projectCss(configured), /@page\{margin-top:1.2em\}/);
const margins = parseProject({ epub: { page: { "margin-top": "10mm", "margin-bottom": "12mm", "margin-left": "14mm", "margin-right": "16mm" }, style: { "margin-left": "5pt", "margin-right": "6pt", "text-indent": "7pt" } } }, "Livre");
assert.match(projectCss(margins), /@page\{margin-top:10mm;margin-bottom:12mm;margin-left:14mm;margin-right:16mm\}/);
assert.match(projectCss(margins), /p\{margin-left:5pt;margin-right:6pt;text-indent:7pt\}/);
assert.throws(() => parseProject({ epub: { page: { "font-family": "serif" } } }, "Livre"), /quatre marges/);
const special = parseProject({ epub: { style: { "font-size": "1.25em" }, styles: { "blockquote p": { "font-size": "1.1em" } }, rules: { [bodyCharacter]: { "font-size": "2em" } } } }, "Livre");
assert.match(projectCss(special), /body blockquote p\{font-size:1.1em\}/);
assert.ok(projectCss(special).includes(`body ${bodyCharacter}{font-size:2em}`));
const bodyCss = projectCss(special).match(/body\{[^}]*\}/);
assert.ok(bodyCss);
assert.match(bodyCss[0], /font-size:1.25em/);
assert.match(projectCss(special), /p\{font-size:inherit\}/);
const combinedRules = parseProject({ epub: { rules: { [bodyRule]: { color: "blue", "text-indent": "0em" }, [bodyCharacter]: { "font-size": "3em" }, "blockquote .bookbinder-after-heading-quote + p": { "font-style": "normal" } } } }, "Livre");
assert.deepEqual(combinedRules.rules[bodyRule], { color: "blue", "text-indent": "0em" });
assert.deepEqual(parseProject({ epub: { rules: combinedRules.rules } }, "Livre").rules, combinedRules.rules);
for (const name of ["body", "h1 + p", "h2 + p", "h2 + p::first-letter"]) assert.throws(() => parseProject({ epub: { rules: { [name]: { color: "red" } } } }, "Livre"), /règle inconnue/);
for (const name of ["body", "div.poem-solo", "h2 + p::first-letter"]) assert.throws(() => parseProject({ epub: { styles: { [name]: { color: "red" } } } }, "Livre"), /style inconnu/);
for (const name of ["poem", "right"]) assert.throws(() => parseProject({ fusion: { [name]: true } }, "Livre"), /réglage inconnu/);
assert.throws(() => parseProject({ epub: { style: { "page-margin": "1em" } } }, "Livre"), /page-margin/);
const titleStyle = parseProject({ epub: { headings: { h1: { "font-size": "3em" } }, styles: { "h1.title": { "font-size": "2em", "page-position": "one-third" } } } }, "Livre");
assert.match(projectCss(titleStyle), /h1:not\(\.title\)\{font-size:3em\}/);
assert.match(projectCss(titleStyle), /body h1\.title\{font-size:2em;[^}]*padding-top:50mm/);
const offsetRule = parseProject({ epub: { rules: { ".bookbinder-rule-h3": { "page-position": "one-third", "page-offset": "25mm", "margin-top": "4em" } } } }, "Livre");
assert.match(projectCss(offsetRule), /body h3\.bookbinder-rule-h3\{[^}]*padding-top:25mm/);
assert.deepEqual(Object.keys(defaults.fusion).sort(), ["excludeCharacters", "excludeNames", "noteSeparator"]);
assert.throws(() => parseProject({ epub: { styles: { "p}body{": { color: "red" } } } }, "Livre"), /style inconnu/);
assert.equal(excluded("partie/_notes/01.md", defaults.fusion), true);
assert.equal(excluded("partie/sortspec.md", defaults.fusion), true);
assert.equal(excluded("fusion-Manuscrit-20261024-1200.md", defaults.fusion), false, "No special filename transformations");
assert.equal(excluded("partie/01.md", defaults.fusion), false);
assert.equal(isProjectNote("bookbinder.md"), true);
assert.equal(isProjectNote("Un livre/BOOKBINDER.MD"), true);
assert.equal(isProjectNote("Un livre/bookbinder.md.bak"), false);
assert.equal(excluded("partie/bookbinder.md", { ...defaults.fusion, excludeCharacters: "", excludeNames: "" }), true);
assert.equal(isProjectNote("Un livre/BOOK-PRINT.MD"), false);
assert.equal(isProjectNote("book-print.md.bak"), false);
assert.equal(excluded("partie/book-print.md", { ...defaults.fusion, excludeCharacters: "", excludeNames: "" }), false);
assert.equal(excluded("Brouillons/01.md", configured.fusion), true);
const prepared = prepareMarkdown("---\ntitle: Secret\n---\n## Chapitre\n<!-- privé -->\n%% privé %%\n~~barré~~\n[Capitales]{.smallcaps}\n--Capitales--\n@@Droite\n££Exergue\n€€Vers 1\n\nVers 2€€\n\\newpage\n");
assert.doesNotMatch(prepared, /Secret|privé|<div|<span/);
for (const literal of ["~~barré~~", "[Capitales]{.smallcaps}", "--Capitales--", "@@Droite", "££Exergue", "€€Vers 1", "\\newpage"]) assert.ok(prepared.includes(literal));
assert.equal(localResource("/projet", "images/cover.jpg"), "/projet/images/cover.jpg");
for (const data of [[], { title: 2 }, { author: {} }, { cover: ["a.jpg", "b.jpg"] }, { epub: { "toc-depth": 0 } }, { fusion: { excludeNames: true } }, { epub: { style: { color: "red;}body{display:none" } } }, { epub: { headings: { body: {} } } }]) {
	assert.throws(() => parseProject(data, "Titre"));
}
assert.throws(() => localResource("/projet", "https://example.org/cover.jpg"));
console.log("Configuration EPUB : Markdown conservé, styles Markdown, format courant et règles séparées : OK.");

const pdfConfig = { title: "Format", pdf: { page: { "paper-size": "custom", "paper-width": "160mm", "paper-height": "240mm", "margin-left": "23mm" }, style: { "font-size": "12pt" }, headings: { h2: { "font-size": "18pt", "page-position": "one-third" } }, styles: { "h1.title": { "font-size": "30pt" }, "p.tab": { "font-style": "italic" } } }, epub: { style: { "font-size": "1.1em" } } };
const pdfProject = parseProject(pdfConfig, "Titre", "pdf");
assert.deepEqual(pdfPage(pdfProject.page), { width: 160, height: 240, top: 20, bottom: 20, left: 23, right: 20, double: false, binding: 0 });
assert.equal(parseProject(pdfConfig, "Titre").style["font-size"], "1.1em");
assert.equal(parseProject(pdfConfig, "Titre").page["paper-size"], undefined);
assert.equal(pdfPage(parseProject(undefined, "Titre", "pdf").page).width, 148);
assert.equal(pdfPage({ "paper-size": "a4" }).height, 297);
assert.deepEqual(pdfPage({ "page-mode": "double", "margin-inner": "24mm", "margin-outer": "14mm", "binding-offset": "7mm" }), { width: 148, height: 210, top: 20, bottom: 20, left: 24, right: 14, double: true, binding: 7 });
assert.equal(pdfPage({ "page-mode": "double", "margin-left": "23mm" }).left, 23, "Switching to facing pages preserves existing horizontal margins");
for (const page of [{ "page-mode": "triple" }, { "binding-offset": "-1mm" }, { "binding-offset": "200mm" }, { "page-mode": "double", "margin-inner": "70mm", "margin-outer": "70mm", "binding-offset": "8mm" }]) assert.throws(() => parseProject({ pdf: { page } }, "Livre", "pdf"));
assert.throws(() => parseProject({ epub: { page: { "page-mode": "double" } } }, "Livre"));
const latexStyles = pdfPresentation(pdfProject, pdfProject.fonts);
const defaultPdfProject = parseProject(undefined, "Titre", "pdf");
for (const format of ["pdf", "docx"] as const) for (const mode of ["auto", "always", "left", "right"]) {
	const project = parseProject({ [format]: { headings: { h2: { "page-break-before": mode, "page-position": "one-third" } } } }, "Livre", format);
	assert.equal(project.headings.h2["page-break-before"], mode);
	assert.equal(pdfStyleValues(project, "h2")["page-break-before"], mode);
	const word = docxPresentation(project, () => undefined);
	assert.equal(word.styles.h2.pageBreak, mode);
	for (const invalid of ["even", "odd", "page", "bad"]) assert.throws(() => parseProject({ [format]: { headings: { h2: { "page-break-before": invalid } } } }, "Livre", format), /page-break-before/);
}
assert.equal(defaultPdfProject.style["font-family"], fontFamily("library:EBGaramond-Regular.otf"), "PDF defaults to EB Garamond from the shared library");
const defaultBody = pdfStyleValues(defaultPdfProject, "p");
for (const format of ["pdf", "docx"] as const) {
	const defaults = parseProject(undefined, "Livre", format);
	assert.equal(defaults.style["font-family"], fontFamily(defaultPdfFont));
	assert.equal(pdfStyleValues(defaults, "p")["font-size"], "11pt");
	assert.equal(pdfStyleValues(defaults, "p")["line-height"], 1.2);
	assert.equal(defaults.style["line-height"], undefined, "Auto leading remains implicit in the project");
	const enlarged = parseProject({ [format]: { style: { "font-size": "22pt" } } }, "Livre", format);
	assert.equal(pdfStyleValues(enlarged, "p")["line-height"], 1.2, "Auto leading scales with the chosen font size");
	assert.match(docxPresentation(enlarged, () => undefined).styleXml, /w:styleId="Normal"[^]*?w:line="288" w:lineRule="auto"/, "Word keeps Auto leading relative after font changes");
	const custom = parseProject({ [format]: { style: { "font-size": "22pt", "line-height": "18pt" } } }, "Livre", format);
	assert.ok(Math.abs(Number(pdfStyleValues(custom, "p")["line-height"]) * 22 - 18) < .00001, "Explicit leading stays absolute");
	assert.match(docxPresentation(custom, () => undefined).styleXml, /w:styleId="Normal"[^]*?w:line="360" w:lineRule="exact"/, "Word keeps explicitly entered point leading fixed");
	for (const selector of ["h1", "h2", "h3", "h4", "h5", "h6", "h1.title"]) {
		assert.equal(pdfStyleValues(custom, selector)["line-height"], 1.2, "Headings use normal leading independently of fixed body leading: " + selector);
		const latex = pdfPresentation(custom, custom.fonts).styles[selector];
		const size = parseFloat(String(pdfStyleValues(custom, selector)["font-size"]));
		assert.ok(latex.inline.includes(`\\fontsize{${size}pt}{${size * 1.2}pt}`));
		const word = docxPresentation(custom, () => undefined), style = word.styleXml.match(new RegExp(`w:styleId="${word.styles[selector].id}"[^]*?</w:style>`))![0];
		assert.match(style, /w:line="288" w:lineRule="auto"/);
	}
	const hyphenated = parseProject({ [format]: { style: { "line-height": "30pt", hyphens: "none" }, styles: { "blockquote p": { hyphens: "auto" } }, rules: { "blockquote .bookbinder-first-quote + p": { hyphens: "none" }, ".bookbinder-first-h3": { "font-size": "30pt" } } } }, "Livre", format);
	assert.equal(pdfStyleValues(hyphenated, "p").hyphens, "none");
	assert.equal(pdfStyleValues(hyphenated, "blockquote p").hyphens, "auto");
	assert.equal(pdfStyleValues(hyphenated, "blockquote .bookbinder-first-quote + p", true).hyphens, "none");
	assert.equal(pdfStyleValues(hyphenated, ".bookbinder-first-h3", true)["line-height"], 1.2, "Heading size rules preserve normal leading");
	const latex = pdfPresentation(hyphenated, hyphenated.fonts), word = docxPresentation(hyphenated, () => undefined);
	assert.match(latex.header, /\\newcommand\{\\BookbinderBody\}\{[^]*?\\hyphenpenalty=10000\\relax/, "The body setting also reaches inherited paragraph flows");
	assert.match(latex.styles.p.before, /\\hyphenpenalty=10000\\relax/);
	assert.match(latex.styles["blockquote p"].before, /\\hyphenpenalty=50\\relax/);
	assert.match(latex.rules["blockquote .bookbinder-first-quote + p"].before, /\\hyphenpenalty=10000\\relax/);
	assert.match(word.styles["blockquote p"].paragraph!, /<w:suppressAutoHyphens w:val="0"\/>/);
	assert.match(word.rules["blockquote .bookbinder-first-quote + p"].paragraph!, /<w:suppressAutoHyphens w:val="1"\/>/);
	assert.throws(() => parseProject({ [format]: { style: { hyphens: "bad" } } }, "Livre", format), /hyphens/);
	assert.deepEqual(folioPage(defaults.page), { position: "center", offset: 10, alignment: "center" });
	for (const position of folioPositions) {
		const configured = parseProject({ [format]: { page: { "page-mode": "double", "folio-position": position, "folio-offset": "8 mm" }, styles: { ".bookbinder-folio": { "font-size": "10pt", "font-style": "italic" } } } }, "Livre", format);
		assert.equal(folioPage(configured.page).alignment, position === "inner" ? "left" : position === "outer" ? "right" : position);
		assert.equal(folioPage(configured.page, true).alignment, position === "inner" ? "right" : position === "outer" ? "left" : position);
		assert.equal(folioPage(configured.page).offset, 8);
		assert.equal(pdfStyleValues(configured, ".bookbinder-folio")["font-size"], "10pt");
	}
	for (const page of [{ "folio-position": "bad" }, { "folio-offset": "-1mm" }, { "folio-offset": "301mm" }, { "folio-offset": "1em" }]) assert.throws(() => parseProject({ [format]: { page } }, "Livre", format));
}
assert.throws(() => parseProject({ epub: { styles: { ".bookbinder-folio": { "font-size": "1em" } } } }, "Livre"));
assert.throws(() => parseProject({ epub: { page: { "folio-position": "center" } } }, "Livre"));
for (const [property, value] of [["font-size", "-1pt"], ["line-height", -1], ["text-align", "bad"], ["font-family", "missing"], ["font-style", "bad"], ["font-weight", "bad"], ["color", "bad"]]) {
	assert.throws(() => docxPresentation(parseProject({ docx: { style: { [property]: value } } }, "Livre", "docx"), () => undefined), /docx.style/, "Invalid print settings cannot produce invalid Word styles");
}
assert.doesNotMatch(docxPresentation(parseProject({ docx: { page: { "folio-position": "none" } } }, "Livre", "docx"), () => undefined).styleXml, /w:jc w:val="none"/);
for (const [spacing, percent, twips] of [["0.01em", 1, 2], ["-0.01em", -1, -2]] as const) {
	const relative = parseProject({ pdf: { style: { "letter-spacing": spacing } } }, "Livre", "pdf");
	assert.ok(pdfPresentation(relative, relative.fonts).styles.p.inline.includes(`LetterSpace=${percent}`), "An approach of +/-10 uses +/-1 percent of the em in PDF");
	assert.match(docxPresentation(relative, () => undefined).styleXml, new RegExp(`<w:spacing w:val="${twips}"/>`), "Word converts relative tracking to native point precision");
	const larger = { ...relative, style: { ...relative.style, "font-size": "22pt" } };
	assert.ok(pdfPresentation(larger, larger.fonts).styles.p.inline.includes(`LetterSpace=${percent}`));
	assert.match(docxPresentation(larger, () => undefined).styleXml, new RegExp(`<w:spacing w:val="${twips * 2}"/>`), "The exported spacing scales with the text size");
}
assert.equal(defaultBody["font-size"], "11pt");
assert.equal(defaultBody["line-height"], 1.2, "Print leading defaults to Auto at 1.2 times the font size");
assert.equal(defaultBody["font-family"], fontFamily(defaultPdfFont));
assert.deepEqual(defaultPdfProject.fonts, [defaultPdfFont]);
assert.equal(parseProject({ pdf: { style: { "font-family": "monospace" } } }, "Livre", "pdf").style["font-family"], "monospace", "Explicit PDF font choices are preserved");
assert.equal(parseProject(undefined, "Livre").style["font-family"], undefined, "EPUB body text keeps Auto");
const unmodifiedPdf = { pdf: { fonts: [] } };
parseProject(unmodifiedPdf, "Livre", "pdf");
assert.deepEqual(unmodifiedPdf.pdf.fonts, [], "Applying a default does not mutate the input project data");
assert.equal(defaultBody["text-indent"], "13.2pt");
assert.equal(defaultBody.color, "#000000");
for (const side of ["top", "bottom", "left", "right"]) assert.equal(defaultBody["margin-" + side], "0pt");
assert.equal(pdfStyleValues(defaultPdfProject, "h2")["font-size"], "16.5pt");
assert.equal(pdfStyleValues(defaultPdfProject, "h2")["margin-top"], "16.5pt");
assert.equal(pdfStyleValues(defaultPdfProject, "h2")["page-break-before"], "always");
assert.equal(pdfStyleValues(defaultPdfProject, "blockquote p")["margin-left"], "22pt");
assert.equal(pdfStyleValues(defaultPdfProject, "code")["font-family"], "monospace");
assert.equal(pdfStyleValues(defaultPdfProject, "em")["font-style"], "italic");
assert.equal(pdfStyleValues(defaultPdfProject, "strong")["font-weight"], "bold");
assert.equal(pdfStyleValues({ ...defaultPdfProject, style: { "font-style": "italic" } }, "em")["font-style"], "normal", "LaTeX emphasis switches italic body text back to upright");
assert.equal(pdfStyleValues({ ...defaultPdfProject, style: { "font-style": "italic", "font-weight": "bold" } }, "code")["font-weight"], "bold");
assert.equal(pdfStyleValues(defaultPdfProject, "sub")["font-size"], "8.25pt");
assert.equal(pdfStyleValues(pdfProject, "h2")["font-size"], "18pt");
assert.equal(pdfStyleValues(pdfProject, "h2")["page-position"], "one-third");
assert.equal(pdfStyleValues(pdfProject, "p.tab")["font-style"], "italic");
assert.equal(pdfStyleValues(pdfProject, "h1")["font-size"], "24pt");
assert.equal(pdfStyleValues(pdfProject, ".bookbinder-after-heading-body + p", true)["text-indent"], "0pt");
assert.equal(defaultPdfProject.style["font-size"], undefined, "Reading PDF defaults keeps inherited settings implicit");
assert.ok(latexStyles.styles["h1.title"].before.includes("\\fontsize{30pt}"));
assert.ok(latexStyles.styles.h2.before.includes("\\vspace*{60mm}"));
assert.ok(latexStyles.styles["p.tab"].inline.includes("\\itshape"));
for (const page of [{ "paper-size": "a3" }, { "paper-size": "custom", "paper-width": "-1mm", "paper-height": "200mm" }, { "margin-left": "150mm" }, { "margin-top": "-1mm" }]) assert.throws(() => parseProject({ pdf: { page } }, "Titre", "pdf"));
assert.throws(() => parseProject({ epub: { page: { "paper-size": "a4" } } }, "Titre"));
for (const value of ["red;display:none", "rgb(1,2,3)", "1pt)evil"]) assert.throws(() => pdfPresentation({ ...pdfProject, style: { "font-size": value } }, []));
for (const property of ["font-family", "font-weight", "font-style", "text-align"]) assert.throws(() => pdfPresentation({ ...pdfProject, style: { [property]: "constructor" } }, []));
const noteRule = "section.footnotes .bookbinder-after-heading-footnote + p";
const notePresentation = pdfPresentation({ ...pdfProject, rules: { [noteRule]: { "line-height": 1.5 } } }, pdfProject.fonts);
const noteValues = pdfStyleValues({ ...pdfProject, rules: { [noteRule]: { "line-height": 1.5 } } }, noteRule, true);
assert.equal(noteValues["font-size"], "10.2pt");
assert.equal(noteValues["line-height"], 1.5);
const firstParagraph = ".bookbinder-after-heading-body + p";
const initialProject: typeof pdfProject = { ...pdfProject, rules: { [firstParagraph]: { "font-size": "20pt", color: "#aabbcc" }, [firstParagraph + "::first-letter"]: { "font-size": "2em" } } };
assert.equal(pdfStyleValues(initialProject, firstParagraph + "::first-letter", true)["font-size"], "40pt");
assert.equal(pdfStyleValues(initialProject, firstParagraph + "::first-letter", true).color, "#aabbcc");
assert.ok(pdfPresentation(initialProject, initialProject.fonts).rules[firstParagraph + "::first-letter"].inline.includes("\\fontsize{40pt}"), "The displayed initial size matches its paragraph rule in LaTeX");
assert.ok(notePresentation.rules[noteRule].inline.includes("\\fontsize{10.2pt}"), "A note rule keeps its paragraph's font size");
assert.deepEqual(new Set(ruleDefinitions.map(rule => rule.paragraph)), new Set(bookStyles.map(style => style.selector)), "Every manuscript style has a contextual rule");
for (const format of ["epub", "pdf", "docx"] as const) {
	const rules = Object.fromEntries(contextRules.map(rule => [rule.selector, { color: "#123456" }]));
	const configured = parseProject({ [format]: { rules, "disabled-rules": ["h3", "em", "table"] } }, "All rules", format);
	assert.deepEqual(configured.rules, rules);
	assert.deepEqual(configured.disabledRules, ["h3", "em", "table"]);
}
const generalRuleProject = parseProject({ pdf: { headings: { h3: { "page-break-before": "always" } }, rules: { ".bookbinder-rule-h3": { "page-break-before": "auto", "font-size": "2em" } } } }, "Rules", "pdf");
const headingRule = pdfPresentation(generalRuleProject, generalRuleProject.fonts).rules[".bookbinder-rule-h3"];
assert.ok(!headingRule.before.includes("\\clearpage"), "A contextual rule can cancel the normal heading break");
assert.equal(pdfStyleValues(generalRuleProject, ".bookbinder-rule-h3", true)["font-size"], "27.5pt");
assert.ok(headingRule.inline.includes("\\fontsize{27.5pt}"), "Relative heading-rule sizes match the inspector");
const titleRuleProject = parseProject({ pdf: { rules: { ".bookbinder-rule-title": { "font-size": "2em" } } } }, "Title rule", "pdf");
assert.ok(pdfPresentation(titleRuleProject, titleRuleProject.fonts).styles["h1.title"].inline.includes("\\fontsize{55pt}"), "The generated book title receives its rule's resolved size");
for (const format of ["pdf", "docx"] as const) {
	const project = parseProject({ [format]: { rules: {
		".bookbinder-rule-h3": { "page-break-before": "right", "font-size": "16pt", "text-align": "right" },
		".bookbinder-first-h3": { "page-break-before": "auto", "font-size": "22pt" },
		[bodyCharacter]: { "font-size": "2em" }, ".bookbinder-first-body + p": { "font-size": "18pt" },
	} } }, "Book first", format);
	assert.equal(pdfStyleValues(project, ".bookbinder-first-h3", true)["text-align"], "right");
	assert.equal(pdfStyleValues(project, ".bookbinder-first-h3", true)["page-break-before"], "auto");
	const latex = pdfPresentation(project, project.fonts);
	assert.ok(!latex.rules[".bookbinder-first-h3"].before.includes("\\BookbinderOddPage"));
	assert.ok(latex.rules[".bookbinder-first-body + p::first-letter"].inline.includes("\\fontsize{36pt}"), "Initials inherit the book-first paragraph size");
}
for (const format of ["pdf", "docx"] as const) assert.throws(() => parseProject({ [format]: { rules: { ".bookbinder-rule-h3": { "page-break-before": "bogus" } } } }, "Invalid", format));
let paperSeed = 42;
for (let index = 0; index < 250; index++) {
	paperSeed = (Math.imul(paperSeed, 1664525) + 1013904223) >>> 0;
	const corpus = ["160mm", "240mm", "20mm", "", "\0", "-1mm", "Infinity", "160mm}\\input{file}", String(paperSeed)];
	const candidate = { "paper-size": "custom", "paper-width": "160mm", "paper-height": "240mm", "margin-left": "20mm", [["paper-width", "paper-height", "margin-left"][paperSeed % 3]]: corpus[(paperSeed >>> 8) % corpus.length] };
	let page;
	try { page = pdfPage(candidate); } catch (error) { assert.ok(error instanceof Error && !(error instanceof TypeError)); continue; }
	const { double, ...dimensions } = page;
	assert.equal(typeof double, "boolean");
	assert.ok(Object.values(dimensions).every(Number.isFinite) && page.left + page.right + page.binding < page.width && page.top + page.bottom < page.height);
}
console.log("Configuration PDF : format papier, marges validées, styles LaTeX et réglages indépendants : OK.");
