import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";

const exec = promisify(execFile), root = path.resolve(import.meta.dirname, "..");
const directory = await mkdtemp(path.join(tmpdir(), "bookbinder-pdf-"));
await build({
	stdin: { contents: 'export * from "./plugin/pdf.ts"; export * from "./plugin/project.ts"; export * from "./plugin/page-layout.ts"; export * from "./plugin/presentation.ts"; export * from "./plugin/tools.ts"; export { resources } from "./scripts/resources.ts";', resolveDir: root },
	bundle: true, platform: "node", format: "cjs", outfile: path.join(directory, "core.cjs"), loader: { ".lua": "text", ".latex": "text", ".css": "text" },
});
const { exportPdf, parseProject, pdfPage, fontFamily, detectTool, resources } = createRequire(import.meta.url)(path.join(directory, "core.cjs"));
const pandoc = await detectTool("pandoc"), latex = await detectTool("xelatex");
assert.equal(pandoc.state, "found"); assert.equal(latex.state, "found");
const sources = [
	{ path: path.join(directory, "partie 1.md"), content: "# PARTIE\n\n## AOUT\n\nPREMIERPARAGRAPHE avec *italique*, **gras** et ***grasitalique***, une note[^1].\n\n> CITATION avec *emphase*.\n\n\tTABULATION *en italique*.\n\n- ELEMENTLISTE\n\n| ENTETE | AUTRE |\n|---|---|\n| CELLULE | TEXTE |\n\nH~2~O et m^2^, ~~barre~~, [capitales]{.smallcaps}, `INLINECODE`.\n\n~SOUSCRIT~ ^EXPOSANT^\n\n```\nCODELITTERAL\n```\n\n---\n\n[^1]: NOTEPREMIERE avec *italique*.\n" },
	{ path: path.join(directory, "partie 2.md"), content: "# PARTIE\n\n## AOUT\n\nDEUXIEMEPARAGRAPHE et sa note[^1].\n\n[^1]: NOTESECONDE.\n" },
	{ path: path.join(directory, "bookbinder.md"), content: "PROJETEXCLU" },
];
const config = { title: "TITRELIVRE", author: "AUTEURLIVRE", lang: "fr", colophon: "COLOPHONPERSONNEL", pdf: {
	page: { "paper-size": "a5", "margin-top": "17mm", "margin-bottom": "22mm", "margin-left": "24mm", "margin-right": "19mm" },
	style: { "font-family": fontFamily("NotoSerif-Regular.otf"), "font-size": "11pt", "line-height": 1.35 },
	headings: { h2: { "font-size": "19pt", "font-style": "italic", "page-position": "one-third", "text-align": "center" } },
	styles: { "h1.title": { "font-size": "27pt", "page-position": "one-third" }, "p.tab": { "text-align": "right", "font-style": "italic" }, "blockquote p": { "font-size": "9pt" }, pre: { "font-family": fontFamily("FiraSans-Regular.otf"), "font-size": "9pt" }, code: { "font-family": fontFamily("SourceSans3-Regular.otf") }, sub: { "font-size": "7pt" }, sup: { "font-size": "15pt" } },
	rules: { ".bookbinder-after-heading-body + p": { "text-indent": "0pt" }, ".bookbinder-after-heading-body + p::first-letter": { "font-size": "16pt", color: "#aa0000" } },
} };
const request = { sources, directory, pandoc: pandoc.path, xelatex: latex.path, resources, fontDirectory: path.join(root, "fonts") };
for (const hyphens of ["auto", "none"]) {
	const output = path.join(directory, `hyphenation-${hyphens}.pdf`);
	await exportPdf({ ...request, output, sources: [{ path: path.join(directory, "typography.md"), content: "### TITREPREMIER TITRESECOND TITRETROISIEME\n\n" + "extraordinairement anticonstitutionnellement internationalisation ".repeat(10) }], project: parseProject({ lang: "fr", pdf: { toc: false, page: { "paper-size": "custom", "paper-width": "80mm", "paper-height": "210mm", "margin-top": "10mm", "margin-bottom": "10mm", "margin-left": "10mm", "margin-right": "10mm" }, style: { "line-height": "30pt", hyphens }, headings: { h3: { "font-size": "22pt" } } } }, "Livre", "pdf") });
	const text = (await exec("pdftotext", ["-layout", output, "-"])).stdout;
	assert.equal(/\p{L}[-‐]\s*\n/u.test(text), hyphens === "auto", "PDF automatic word breaks follow the paragraph setting");
	const boxes = (await exec("pdftotext", ["-bbox", output, "-"])).stdout;
	const y = marker => Number(boxes.match(new RegExp(`<word[^>]*yMin="([\\d.]+)"[^>]*>${marker}</word>`))[1]);
	assert.ok(Math.abs(y("TITRESECOND") - y("TITREPREMIER") - 26.4) < .15, "Wrapped PDF headings use normal leading independently of fixed body leading");
}
const normalMarginOutput = path.join(directory, "heading-top-zero.pdf");
await exportPdf({ ...request, output: normalMarginOutput, sources: [{ path: path.join(directory, "heading-top-zero.md"), content: "### ZEROTOPRULE\n\nFIRSTBODY\n\n### THIRDBASE\n\nSECONDBODY" }], project: parseProject({ pdf: { toc: false, headings: { h3: { "page-position": "one-third", "font-size": "11pt" } }, rules: { ".bookbinder-first-h3": { "page-position": "normal", "margin-top": "0pt" } } } }, "Livre", "pdf") });
const normalMarginBoxes = (await exec("pdftotext", ["-bbox", normalMarginOutput, "-"])).stdout;
const normalMarginY = marker => Number(normalMarginBoxes.match(new RegExp(`<word xMin="[\\d.]+" yMin="([\\d.]+)"[^>]*>${marker}</word>`))[1]);
assert.ok(normalMarginY("ZEROTOPRULE") < 30 * 72 / 25.4, "A zero top margin starts the conditional heading at the page's text area");
assert.ok(normalMarginY("THIRDBASE") > 70 * 72 / 25.4, "The following heading retains its base style's one-third position");
const hasFolio = page => [...page.matchAll(/<word[^>]*yMin="([\d.]+)"[^>]*>\d+<\/word>/g)].some(match => Number(match[1]) > (210 - 15) * 72 / 25.4);
for (const [size, personal, folio] of [[11, true, "hide"], [22, true, "show"], [11, false, "hide"]]) {
	const output = path.join(directory, `colophon-third-${size}-${personal}.pdf`);
	await exportPdf({ ...request, output, sources: [{ path: path.join(directory, "colophon.md"), content: "BODYENDING" }], project: parseProject({ colophon: personal ? "COLOPHONFIRST\n\nCOLOPHONSECOND" : "", pdf: { toc: false, styles: { ".bookbinder-colophon p": { "page-position": "one-third", "font-size": size + "pt", "margin-top": "30pt", "margin-bottom": "7pt", folio } } } }, "Livre", "pdf") });
	const pages = (await exec("pdftotext", ["-bbox", output, "-"])).stdout.match(/<page\b[^]*?<\/page>/g);
	const bodyPage = pages.findIndex(page => page.includes(">BODYENDING</word>")), marker = personal ? "COLOPHONFIRST" : "Bookbinder", colophonPage = pages.findIndex(page => page.includes(">" + marker + "</word>"));
	assert.equal(colophonPage, bodyPage + 1, "The positioned colophon starts on the next page without an extra blank page");
	assert.equal(colophonPage, pages.length - 1, "The personal text and generation credit stay on one colophon page");
	assert.ok(hasFolio(pages[bodyPage]), "The preceding manuscript page retains its folio");
	assert.equal(hasFolio(pages[colophonPage]), folio === "show", "Colophon folio choice applies to personal text and credit-only pages");
	const y = marker => Number(pages[colophonPage].match(new RegExp(`<word xMin="[\\d.]+" yMin="([\\d.]+)"[^>]*>${marker}</word>`))[1]);
	const third = 210 / 3 * 72 / 25.4;
	assert.ok(y(marker) >= third - 1 && y(marker) < third + 25, "The colophon starts one-third down the physical page, including a credit-only colophon");
	if (personal) { assert.ok(pages[colophonPage].includes(">COLOPHONSECOND</word>")); assert.ok(y("COLOPHONSECOND") - y("COLOPHONFIRST") < 60, "Only the start of the colophon gets the positioning offset"); assert.ok(y("Bookbinder") > y("COLOPHONSECOND") + 20, "The attribution retains its separate spacing"); }
}
for (const folio of ["hide", "show"]) {
	const output = path.join(directory, `colophon-multiple-pages-${folio}.pdf`);
	await exportPdf({ ...request, output, sources: [{ path: path.join(directory, "long-colophon.md"), content: "BODYENDING" }], project: parseProject({ colophon: Array.from({ length: 80 }, (_, index) => "COLOPHONLONG" + index).join("\n\n"), pdf: { toc: false, styles: { ".bookbinder-colophon p": { folio } } } }, "Livre", "pdf") });
	const pages = (await exec("pdftotext", ["-bbox", output, "-"])).stdout.match(/<page\b[^]*?<\/page>/g);
	const bodyPage = pages.findIndex(page => page.includes(">BODYENDING</word>"));
	assert.ok(pages.length - bodyPage > 2, "The colophon spans several pages");
	assert.ok(hasFolio(pages[bodyPage]));
	for (const page of pages.slice(bodyPage + 1)) assert.equal(hasFolio(page), folio === "show", "The colophon folio choice covers its first, intermediate and last pages");
}
for (const [length, expected] of [[499, 0], [500, 1], [1499, 1], [1500, 2]]) {
	const document = JSON.parse(execFileSync(pandoc.path, ["--from=" + path.join(root, "scripts/lua/book-reader.lua"), "--to=json"], { input: JSON.stringify({ sources: [{ directory, content: "a".repeat(length) }], characterCountLabel: "{count} ksignes", characterCountDivisor: 1000 }), encoding: "utf8" }));
	assert.equal(document.meta["bookbinder-character-count"].c, expected + " ksignes", "PDF ksignes round to the nearest thousand without decimals");
}
for (const layout of ["single", "double"]) {
	const output = path.join(directory, `heading-folios-${layout}.pdf`);
	const headings = Object.fromEntries([1, 2, 3, 4, 5, 6].map(level => ["h" + level, { "page-break-before": "always", folio: level % 2 ? "hide" : "show" }]));
	await exportPdf({ ...request, output, sources: [{ path: path.join(directory, "folios.md"), content: "# HIDEPAGEONE\n\nFIRSTBODY\n\n\\BookbinderOddPage\n\nCONTINUATION\n\n\\cleardoublepage\n\n## SHOWPAGETWO\n\nSECOND\n\n### HIDEPAGETHREE\n\nTHIRD\n\n#### SHOWPAGEFOUR\n\nFOURTH\n\n##### HIDEPAGEFIVE\n\nFIFTH\n\n###### RULEHIDESIX\n\nSIXTH\n\n###### SHOWPAGESIX\n\nLAST" }], project: parseProject({ title: "TITLEWITHOUTFOLIO", pdf: { toc: false, page: { "page-mode": layout }, headings, rules: { ".bookbinder-first-h6": { folio: "hide" } } } }, "Livre", "pdf") });
	const pages = (await exec("pdftotext", ["-bbox", output, "-"])).stdout.match(/<page\b[^]*?<\/page>/g);
	for (const [marker, expected] of [["TITLEWITHOUTFOLIO", false], ["HIDEPAGEONE", false], ["CONTINUATION", true], ["SHOWPAGETWO", true], ["HIDEPAGETHREE", false], ["SHOWPAGEFOUR", true], ["HIDEPAGEFIVE", false], ["RULEHIDESIX", false], ["SHOWPAGESIX", true]]) {
		const page = pages.find(page => page.includes(">" + marker + "</word>")); assert.ok(page, marker);
		assert.equal(hasFolio(page), expected, layout + ": heading controls its own page; continuation and later heading pages resume folios: " + marker);
	}
	if (layout === "double") {
		const continuation = pages.findIndex(page => page.includes(">CONTINUATION</word>")), nextHeading = pages.findIndex(page => page.includes(">SHOWPAGETWO</word>"));
		assert.equal(nextHeading, continuation + 2, "The standard double-page break inserts a blank verso");
		assert.doesNotMatch(pages[continuation + 1], /<word\b/, "Blank verso has no folio or other text");
	}
}
const automaticFolioOutput = path.join(directory, "automatic-heading-folio.pdf");
await exportPdf({ ...request, output: automaticFolioOutput, sources: [{ path: path.join(directory, "automatic-folio.md"), content: "PRECEDINGPAGE\n\n\\vspace*{158mm}\n\n### AUTOMATICHEADING\n\nAFTERHEADING\n\n\\newpage\n\nRESTOREDPAGE\n\n#### VISIBLEHEADING\n\n##### HIDDENONTHESAMEPAGE" }], project: parseProject({ pdf: { toc: false, headings: { h3: { "page-break-before": "auto", "margin-top": "20mm", folio: "hide" }, h4: { "page-break-before": "auto" }, h5: { "page-break-before": "auto", folio: "hide" } } } }, "Livre", "pdf") });
const automaticPages = (await exec("pdftotext", ["-bbox", automaticFolioOutput, "-"])).stdout.match(/<page\b[^]*?<\/page>/g);
const beforeIndex = automaticPages.findIndex(page => page.includes(">PRECEDINGPAGE</word>")), headingIndex = automaticPages.findIndex(page => page.includes(">AUTOMATICHEADING</word>"));
assert.ok(headingIndex > beforeIndex, "The heading moves through automatic pagination");
assert.ok(hasFolio(automaticPages[beforeIndex]), "An automatic break does not hide the previous page's folio");
assert.ok(!hasFolio(automaticPages[headingIndex]), "The folio mark follows the heading to its actual page");
const mixed = automaticPages.find(page => page.includes(">VISIBLEHEADING</word>"));
assert.ok(mixed.includes(">HIDDENONTHESAMEPAGE</word>")); assert.ok(!hasFolio(mixed), "Any heading requesting no folio suppresses it on their shared page");
for (const margin of [0, 7]) {
	const output = path.join(directory, `first-quote-alignment-${margin}.pdf`);
	await exportPdf({ ...request, output, sources: [{ path: path.join(directory, "dedication.md"), content: "#### DEDICATION\n\n> QUOTEFIRST  \n> QUOTEMIDDLELONG  \n> LAST\n\nBODYRESET\n\n> QUOTESECOND" }], project: parseProject({ pdf: { toc: false,
		headings: { h4: { "page-break-before": "auto" } },
		styles: { "blockquote p": { "font-style": "italic", "font-size": "body", "margin-top": "13.3pt", "margin-bottom": "13.3pt", "margin-left": margin + "mm", "margin-right": margin + "mm", "text-indent": "0pt" } },
		rules: { "blockquote .bookbinder-first-quote + p": { "text-align": "right" } },
	} }, "Livre", "pdf") });
	const boxes = (await exec("pdftotext", ["-bbox", output, "-"])).stdout;
	const coordinates = marker => { const match = boxes.match(new RegExp(`<word xMin="([\\d.]+)" yMin="[\\d.]+" xMax="([\\d.]+)"[^>]*>${marker}</word>`)); assert.ok(match, marker); return match.slice(1).map(Number); };
	for (const marker of ["QUOTEFIRST", "QUOTEMIDDLELONG", "LAST"]) assert.ok(Math.abs(coordinates(marker)[1] - (148 - 20 - margin) * 72 / 25.4) < .15, "Every line of the first quotation aligns right while preserving its explicit margins: " + marker);
	assert.ok(Math.abs(coordinates("QUOTESECOND")[0] - (20 + margin) * 72 / 25.4) < .15, "Later quotations retain their normal style");
}
const separatorOutput = path.join(directory, "characters-separator.pdf");
await exportPdf({ ...request, output: separatorOutput, sources: [
	{ path: path.join(directory, "separator-a.md"), content: "PREMIER\n\n---\n\nDEUXIEME\n\n***\n\nTROISIEME\n\n___\n\nQUATRIEME" },
	{ path: path.join(directory, "separator-b.md"), content: "CINQUIEME" },
], project: parseProject({ fusion: { noteSeparator: "---" }, pdf: { toc: false, separator: "* & *", styles: { hr: { "font-size": "18pt", "text-align": "center", "margin-left": "7mm", "margin-right": "7mm" } } } }, "Livre", "pdf") });
const separatorText = (await exec("pdftotext", ["-layout", separatorOutput, "-"])).stdout;
assert.equal((separatorText.match(/\*\s*&\s*\*/g) ?? []).length, 4, "All thematic breaks and the note separator use literal characters");
const separatorBoxes = (await exec("pdftotext", ["-bbox", separatorOutput, "-"])).stdout;
const separatorLine = [...separatorBoxes.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^]*?)<\/word>/g)].filter(match => match[5].includes("&amp;"));
assert.equal(separatorLine.length, 4);
for (const match of separatorLine) assert.ok(Math.abs((Number(match[1]) + Number(match[3])) / 2 - 148 * 72 / 25.4 / 2) < 1, "The separator follows its centered style");
await writeFile(path.join(directory, "cover.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64"));
for (const [copyright, count, cover] of [[true, true, false], [false, false, false], [true, false, true], [false, true, true]]) {
	const output = path.join(directory, `title-details-${copyright}-${count}-${cover}.pdf`);
	await exportPdf({ ...request, output, sources: [
		{ path: path.join(directory, "count.md"), content: "# Été\n\nBonjour *toi* [là](https://example.org).[^1]\n\n[^1]: Note cachée." },
		{ path: path.join(directory, "bookbinder.md"), content: "NEPASCOMPTER" },
	], project: parseProject({ title: "TITRECOMPTE", author: "AUTEURCOMPTE", rights: "© 2026 Auteur & Éditeur", cover: cover ? "cover.png" : undefined, colophon: "COLOPHONNONCOMPTE", pdf: { toc: false, "title-page": { copyright, "character-count": count } } }, "Livre", "pdf") });
	const text = (await exec("pdftotext", ["-layout", output, "-"])).stdout;
	const firstPage = text.split("\f")[0].replace(/\s+/g, " ");
	assert.equal(firstPage.includes("© 2026 Auteur & Éditeur"), copyright, "Copyright stays on the title page");
	assert.equal(firstPage.includes("0 ksignes"), count, "Rounded ksignes stay on the title page, including with a cover");
	if (!copyright) assert.ok(!text.includes("© 2026"));
	if (!count) assert.ok(!text.includes("ksignes"));
}
for (const [size, expected] of [["a5", [148, 210]], ["a4", [210, 297]], ["custom", [160, 240]]]) {
	const data = structuredClone(config);
	Object.assign(data.pdf.page, { "paper-size": size, "paper-width": "160mm", "paper-height": "240mm" });
	const project = parseProject(data, "Ignored", "pdf");
	const output = path.join(directory, `${size}.pdf`);
	assert.equal(await exportPdf({ ...request, project, output }), output);
	assert.equal((await readFile(output)).subarray(0, 5).toString(), "%PDF-");
	const { stdout: info } = await exec("pdfinfo", [output]);
	const dimensions = info.match(/Page size:\s+([\d.]+) x ([\d.]+)/).slice(1).map(Number);
	assert.ok(dimensions.every((value, index) => Math.abs(value - expected[index] * 72 / 25.4) < 0.1), "PDF dimensions follow the chosen format");
	const { stdout: text } = await exec("pdftotext", ["-layout", output, "-"]);
	for (const marker of ["TITRELIVRE", "AUTEURLIVRE", "PREMIERPARAGRAPHE", "DEUXIEMEPARAGRAPHE", "CITATION", "TABULATION", "ELEMENTLISTE", "CELLULE", "CODELITTERAL", "NOTEPREMIERE", "NOTESECONDE", "COLOPHONPERSONNEL", "Bookbinder"]) assert.ok(text.includes(marker), "PDF preserves " + marker);
	assert.ok(!text.includes("PROJETEXCLU"));
	assert.equal((text.match(/AOUT/g) ?? []).length, 4, "Both repeated headings appear in the table of contents and in the body");
	assert.ok(!/1\.\s*\n\s*NOTEPREMIERE/.test(text), "The note number stays on the same line as its text");
	const { stdout: boxes } = await exec("pdftotext", ["-bbox", output, "-"]);
	const titleBox = boxes.match(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">TITRELIVRE<\/word>/).slice(1).map(Number);
	assert.ok(titleBox[2] - titleBox[0] > 150, "The book title uses its configured 27pt size");
	const initialBox = boxes.match(/<word xMin="([\d.]+)"[^>]*>P<\/word>/);
	assert.ok(initialBox && Math.abs(Number(initialBox[1]) - 24 * 72 / 25.4) < 0.1, "The text starts at the configured left page margin");
	const scriptHeights = ["SOUSCRIT", "EXPOSANT"].map(marker => {
		const box = boxes.match(new RegExp(`<word xMin="[\\d.]+" yMin="([\\d.]+)" xMax="[\\d.]+" yMax="([\\d.]+)">${marker}</word>`));
		assert.ok(box, "The PDF preserves " + marker);
		return Number(box[2]) - Number(box[1]);
	});
	assert.ok(Math.abs(scriptHeights[1] / scriptHeights[0] - 15 / 7) < 0.02, "Subscripts and superscripts use their configured point sizes");
	const { stdout: fonts } = await exec("pdffonts", [output]);
	assert.ok(fonts.includes("FiraSans") && fonts.includes("SourceSans3"), "Code blocks and inline code use their configured fonts");
	for (const face of ["Regular", "Bold", "Italic", "BoldItalic"]) assert.ok(fonts.includes("NotoSerif-" + face), "The PDF embeds the real " + face + " face");
	assert.equal(parseProject(data, "Ignored").page["paper-size"], undefined, "PDF geometry stays independent from EPUB");
	if (size === "a5") {
		const before = await readFile(output);
		await assert.rejects(exportPdf({ ...request, project, output, xelatex: path.join(directory, "missing-engine") }));
		assert.deepEqual(await readFile(output), before, "A failed conversion preserves the existing PDF");
		assert.equal(await exportPdf({ ...request, project, output, confirmOverwrite: async () => "cancel" }), undefined);
		assert.deepEqual(await readFile(output), before, "Cancellation preserves the existing PDF");
	}
}
for (const page of [{ "paper-size": "a3" }, { "paper-size": "custom", "paper-width": "0mm", "paper-height": "240mm" }, { "margin-left": "100mm", "margin-right": "100mm" }]) assert.throws(() => pdfPage(page));
const autoOutput = path.join(directory, "auto.pdf");
await exportPdf({ ...request, sources: [{ path: path.join(directory, "simple.md"), content: "## DEFAUT\n\nTEXTEAUTOMATIQUE avec *italique*, **gras**, ***grasitalique*** et un [lien](https://example.org).\n\nLIGNEUNE  \nLIGNEDEUX" }], project: parseProject({ title: "PARDEFAUT", pdf: { style: { "letter-spacing": "0.2pt" } } }, "Titre", "pdf"), output: autoOutput });
assert.ok((await exec("pdftotext", [autoOutput, "-"])).stdout.includes("TEXTEAUTOMATIQUE"), "The PDF uses its default font without a manual font selection");
const { stdout: defaultFonts } = await exec("pdffonts", [autoOutput]);
assert.doesNotMatch(defaultFonts, /LMRoman/, "The table of contents and page numbers also use the selected main font");
const defaultBoxes = (await exec("pdftotext", ["-bbox", autoOutput, "-"])).stdout;
const lineY = marker => Number(defaultBoxes.match(new RegExp(`<word xMin="[\\d.]+" yMin="([\\d.]+)"[^>]*>${marker}</word>`))[1]);
assert.ok(Math.abs(lineY("LIGNEDEUX") - lineY("LIGNEUNE") - 11 * 1.2) < .1, "The actual body baseline spacing is Auto, 1.2 times the font size");
for (const face of ["Regular", "Bold", "Italic", "BoldItalic"]) {
	const row = defaultFonts.split("\n").find(line => line.includes("EBGaramond-" + face));
	assert.ok(row && /\byes\s+yes\s+yes\b/.test(row), "The default PDF embeds EB Garamond " + face + " as a subset with Unicode mapping");
}
const beforeMissingFont = await readFile(autoOutput);
await assert.rejects(exportPdf({ ...request, project: parseProject(undefined, "Livre", "pdf"), output: autoOutput, fontDirectory: path.join(directory, "no-font-package") }), /EBGaramond-Regular\.otf.*Bookbinder/);
assert.deepEqual(await readFile(autoOutput), beforeMissingFont, "A missing default font explains how to install it and preserves the existing PDF");
for (const mode of ["single", "double"]) {
	const output = path.join(directory, `${mode}-binding.pdf`);
	const project = parseProject({ title: "Reliure", pdf: { page: { "page-mode": mode, "margin-inner": "24mm", "margin-outer": "14mm", "margin-left": "24mm", "margin-right": "14mm", "binding-offset": "7mm", "folio-position": "outer", "folio-offset": "8mm" }, style: { "text-indent": "0pt" }, styles: { ".bookbinder-folio": { "font-family": fontFamily("FiraSans-Regular.otf"), "font-size": "10pt", "font-style": "italic" } } } }, "Livre", "pdf");
	await exportPdf({ ...request, project, output, sources: [{ path: path.join(directory, "pages.md"), content: "RECTOLEFT\n\n\\newpage\n\nVERSOLEFT\n" }] });
	const { stdout: boxes } = await exec("pdftotext", ["-bbox", output, "-"]);
	const pages = boxes.match(/<page\b[\s\S]*?<\/page>/g);
	for (const [marker, expected] of [["RECTOLEFT", 31], ["VERSOLEFT", mode === "double" ? 14 : 31]]) {
		const index = pages.findIndex(page => page.includes(`>${marker}</word>`));
		assert.ok(index >= 0);
		const x = Number(pages[index].match(new RegExp(`<word xMin="([\\d.]+)"[^>]*>${marker}</word>`))[1]);
		assert.ok(Math.abs(x - expected * 72 / 25.4) < 0.1, `${mode}: ${marker} applies the binding margin on the correct side`);
		if (mode === "double") assert.equal(index % 2, marker === "RECTOLEFT" ? 0 : 1, "Mirroring follows physical page parity");
		const folio = [...pages[index].matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(\d+)<\/word>/g)].find(match => Number(match[2]) > (210 - 15) * 72 / 25.4);
		assert.ok(folio, "Every manuscript page has a visible folio");
		const left = mode === "double" && index % 2 === 1;
		assert.ok(Math.abs(Number(folio[left ? 1 : 3]) - (left ? 14 : 148 - 14) * 72 / 25.4) < .1, "The outer folio mirrors with the page margins");
		assert.ok(Math.abs((Number(folio[2]) + Number(folio[4])) / 2 - (210 - 8) * 72 / 25.4) < 8, "The footer follows the chosen distance from the bottom");
	}
	assert.match((await exec("pdffonts", [output])).stdout, /FiraSans-Italic/, "The folio embeds its configured italic font face");
}
const withoutFolio = path.join(directory, "no-folio.pdf");
await exportPdf({ ...request, sources: [{ path: path.join(directory, "plain.md"), content: "SANSFOLIO" }], project: parseProject({ pdf: { page: { "folio-position": "none" } } }, "Livre", "pdf"), output: withoutFolio });
const noFolioPages = (await exec("pdftotext", ["-bbox", withoutFolio, "-"])).stdout.match(/<page\b[\s\S]*?<\/page>/g);
for (const page of noFolioPages) assert.ok(![...page.matchAll(/<word[^>]*yMin="([\d.]+)"[^>]*>\d+<\/word>/g)].some(match => Number(match[1]) > (210 - 15) * 72 / 25.4), "Without folio removes page numbers from the footer");
const tocMarkers = ["TOCLEVELA", "TOCLEVELB", "TOCLEVELC", "TOCLEVELD", "TOCLEVELE", "TOCLEVELF"];
const tocSources = [{ path: path.join(directory, "contents.md"), content: tocMarkers.map((marker, index) => "#".repeat(index + 1) + " " + marker + "\n\nTexte.").join("\n\n") }];
for (const [toc, depth] of [[false, 6], [true, 1], [true, 3], [true, 6]]) {
	const output = path.join(directory, `toc-${toc}-${depth}.pdf`);
	await exportPdf({ ...request, sources: tocSources, project: parseProject({ pdf: { toc, "toc-depth": depth } }, "Sommaire", "pdf"), output });
	const text = (await exec("pdftotext", [output, "-"])).stdout;
	for (const [index, marker] of tocMarkers.entries()) assert.equal((text.match(new RegExp(marker, "g")) ?? []).length, toc && index < depth ? 2 : 1, `PDF contents=${toc}, depth=${depth}, heading=${index + 1}`);
}
const headingSources = [{ path: path.join(directory, "heading-a.md"), content: "AVANTPARITE\n\n## TITREPARITEA\n\nAPRESTITREA" }, { path: path.join(directory, "heading-b.md"), content: "## TITREPARITEB\n\nAPRESTITREB" }];
for (const [mode, layout] of [["auto", "single"], ["always", "single"], ["left", "single"], ["right", "single"], ["left", "double"], ["right", "double"]]) {
	const parity = mode === "left" || mode === "right", output = path.join(directory, `heading-${mode}-${layout}.pdf`);
	await exportPdf({ ...request, sources: headingSources, project: parseProject({ fusion: { noteSeparator: parity ? "odd" : "" }, pdf: { toc: false, page: { "page-mode": layout }, headings: { h2: { "page-break-before": mode, ...(parity ? { "page-position": "one-third" } : {}) } } } }, "Titres", "pdf"), output });
	const pages = (await exec("pdftotext", [output, "-"])).stdout.split("\f");
	const indexes = ["AVANTPARITE", "TITREPARITEA", "TITREPARITEB"].map(marker => { const index = pages.findIndex(text => text.includes(marker)); assert.ok(index >= 0); return index; });
	if (mode === "auto") assert.ok(indexes.every(index => index === indexes[0]), "No break keeps both short headings on the current page");
	else if (mode === "always") assert.deepEqual(indexes, [indexes[0], indexes[0] + 1, indexes[0] + 2], "Next page inserts no blank pages");
	else {
		for (const index of indexes.slice(1)) assert.equal((index + 1) % 2, mode === "left" ? 0 : 1, "Heading parity follows physical PDF pages in " + layout);
		assert.ok(indexes[0] < indexes[1] && indexes[1] < indexes[2]);
		for (let index = indexes[1] + 1; index < indexes[2]; index++) assert.equal(pages[index].trim(), "", "Inserted parity pages stay blank, without a folio");
	}
}
const contextualSources = [{ path: path.join(directory, "context-a.md"), content: [
	"### RULESTART", "*RULEEM* *NORMALEM*", "### NORMALH3", "#### LOWERH4", "### STILLNORMAL", "## PARENT", "### RULEAFTERPARENT",
	"```\nRULECODE\n```", "```\nNORMALCODE\n```", "- RULELIST", "PARAGRAPHE", "- NORMALLIST", "| ENTETE |\n|---|\n| RULECELL |", "| ENTETEDEUX |\n|---|\n| NORMALCELL |",
].join("\n\n") }, { path: path.join(directory, "context-b.md"), content: "# NEWPART\n\n### RULEAFTERPART\n\nFIN" }];
const contextualData = { fusion: { noteSeparator: "" }, pdf: { toc: false,
	headings: Object.fromEntries([1, 2, 3, 4].map(level => ["h" + level, { "page-break-before": "auto", ...(level === 3 ? { "font-family": "body", "font-size": "body" } : {}) }])), rules: {
		".bookbinder-rule-h3": { "page-break-before": "right", color: "#aa0000", "font-size": "20pt" },
		".bookbinder-rule-em > em": { "font-style": "normal", "font-size": "19pt" }, ".bookbinder-rule-pre": { "font-size": "16pt" },
		".bookbinder-rule-ul": { "font-size": "15pt" }, ".bookbinder-rule-table": { "font-size": "14pt" },
	} } };
const contextualOutput = path.join(directory, "contextual.pdf");
await exportPdf({ ...request, sources: contextualSources, project: parseProject(contextualData, "Context", "pdf"), output: contextualOutput });
const contextPages = (await exec("pdftotext", ["-bbox", contextualOutput, "-"])).stdout.match(/<page\b[\s\S]*?<\/page>/g);
for (const marker of ["RULESTART", "RULEAFTERPARENT", "RULEAFTERPART"]) {
	const index = contextPages.findIndex(page => page.includes(">" + marker + "</word>"));
	assert.ok(index >= 0); assert.equal((index + 1) % 2, 1, marker + " starts on a physical odd page");
}
const contextPage = marker => contextPages.findIndex(page => page.includes(">" + marker + "</word>"));
assert.equal(contextPage("NORMALH3"), contextPage("RULESTART"), "The second H3 keeps its normal no-break style");
assert.equal(contextPage("STILLNORMAL"), contextPage("RULESTART"), "H4 does not reset the H3 rule");
const height = marker => { const box = contextPages.join("").match(new RegExp(`<word xMin="[\\d.]+" yMin="([\\d.]+)" xMax="[\\d.]+" yMax="([\\d.]+)">${marker}</word>`)); assert.ok(box, marker); return Number(box[2]) - Number(box[1]); };
for (const [first, next] of [["RULESTART", "NORMALH3"], ["RULEEM", "NORMALEM"], ["RULECODE", "NORMALCODE"], ["RULELIST", "NORMALLIST"], ["RULECELL", "NORMALCELL"]]) assert.ok(height(first) > height(next) * 1.15, first + " uses the contextual type size; later occurrences keep their normal style");
assert.ok(Math.abs(height("NORMALH3") - height("PARAGRAPHE")) < .01, "Body-referenced H3 has the same real type size as the body");
const cancelOutput = path.join(directory, "contextual-cancel.pdf");
await exportPdf({ ...request, sources: [{ path: path.join(directory, "cancel.md"), content: "AVANTREGLE\n\n### SANSCOUPURE\n\n### AVECCOUPURE" }], project: parseProject({ pdf: { toc: false, rules: { ".bookbinder-rule-h3": { "page-break-before": "auto" } } } }, "Annulation", "pdf"), output: cancelOutput });
const cancelPages = (await exec("pdftotext", [cancelOutput, "-"])).stdout.split("\f");
const pageOf = marker => cancelPages.findIndex(text => text.includes(marker));
assert.equal(pageOf("AVANTREGLE"), pageOf("SANSCOUPURE"), "The first H3 rule cancels the base style's page break");
assert.ok(pageOf("AVECCOUPURE") > pageOf("SANSCOUPURE"), "The next H3 keeps the base style's page break");
const spacingOutput = path.join(directory, "paragraph-spacing.pdf");
await exportPdf({ ...request, sources: [{ path: path.join(directory, "spacing.md"), content: await readFile(path.join(root, "scripts/fixtures/paragraph-spacing.md"), "utf8") }], project: parseProject({ colophon: "COLONE\n\nCOLTWO", pdf: { toc: false, style: { "margin-top": "6pt", "margin-bottom": "9pt", "line-height": "12pt" }, headings: { h2: { "page-break-before": "auto" } } } }, "Spacing", "pdf"), output: spacingOutput });
const spacingBoxes = (await exec("pdftotext", ["-bbox", spacingOutput, "-"])).stdout;
const spacingY = marker => { const box = spacingBoxes.match(new RegExp(`<word xMin="[\\d.]+" yMin="([\\d.]+)"[^>]*>${marker}</word>`)); assert.ok(box, marker); return Number(box[1]); };
for (const [first, next] of [["BODYONE", "BODYTWO"], ["BODYTWO", "BODYTHREE"], ["QUOTEONE", "QUOTETWO"], ["QUOTETWO", "QUOTETHREE"], ["QUOTETHREE", "QUOTEFOUR"], ["TABONE", "TABTWO"], ["TABTWO", "TABTHREE"], ["COLONE", "COLTWO"], ["FOOTONE", "FOOTTWO"], ["FOOTTWO", "FOOTTHREE"]]) assert.ok(Math.abs(spacingY(next) - spacingY(first) - 21) < .15, first + " to " + next + " keeps 9pt below and drops 6pt above");
assert.ok(Math.abs(spacingY("BODYRESET") - spacingY("QUOTEFOUR") - 27) < .15, "A style change restores the body's 6pt top margin");
const bookFirstOutput = path.join(directory, "first-in-book.pdf");
await exportPdf({ ...request, sources: [
	{ path: path.join(directory, "book-a.md"), content: await readFile(path.join(root, "scripts/fixtures/first-in-book.md"), "utf8") },
	{ path: path.join(directory, "book-b.md"), content: "# BOOKPARENTH1\n\n### BOOKAFTERH1\n\nBOOKBODYAFTERH1" },
], project: parseProject({ title: "BOOKTITLE", pdf: { toc: false, headings: Object.fromEntries([1, 2, 3, 4].map(level => ["h" + level, { "page-break-before": "auto" }])), rules: {
	".bookbinder-first-title": { "font-size": "30pt" }, ".bookbinder-rule-title": { "font-size": "24pt" },
	".bookbinder-first-h3": { "font-size": "22pt", "page-break-before": "auto" }, ".bookbinder-rule-h3": { "font-size": "16pt", "page-break-before": "right" },
	".bookbinder-first-body + p": { "font-size": "18pt" }, ".bookbinder-after-heading-body + p::first-letter": { "font-size": "2em" },
} } }, "Book first", "pdf"), output: bookFirstOutput });
const bookFirstPages = (await exec("pdftotext", ["-bbox", bookFirstOutput, "-"])).stdout.match(/<page\b[\s\S]*?<\/page>/g);
const bookPage = marker => bookFirstPages.findIndex(page => page.includes(">" + marker + "</word>"));
assert.equal(bookPage("BOOKFIRSTH3"), 1, "First-in-book No break overrides after-heading Odd page");
for (const marker of ["BOOKAFTERH2", "BOOKAFTERH1"]) { assert.ok(bookPage(marker) > 1); assert.equal((bookPage(marker) + 1) % 2, 1, marker + " keeps the after-heading odd-page rule"); }
const bookHeight = marker => { const match = bookFirstPages.join("").match(new RegExp(`<word xMin="[\\d.]+" yMin="([\\d.]+)" xMax="[\\d.]+" yMax="([\\d.]+)">${marker}</word>`)); assert.ok(match, marker); return Number(match[2]) - Number(match[1]); };
assert.ok(Math.abs(bookHeight("BOOKFIRSTH3") / bookHeight("BOOKAFTERH2") - 22 / 16) < .02);
assert.ok(Math.abs(bookHeight("Z") / bookHeight("BOOKFIRSTBODY") - 2) < .02, "The first-book body initial uses 36pt over an 18pt paragraph");
assert.ok(!(await readdir(directory)).some(name => name.startsWith(".bookbinder-")), "No temporary manuscript or conversion resources remain");
console.log("PDF réel : A4, A5, format personnalisé, simple/double page, reliure, styles, notes locales, fusion et conservation du dernier export : OK.");
console.log("Résultats : " + directory);
