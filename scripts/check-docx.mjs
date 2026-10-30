import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";

const exec = promisify(execFile), root = path.resolve(import.meta.dirname, "..");
const directory = await mkdtemp(path.join(tmpdir(), "bookbinder-docx-"));
await build({ stdin: { contents: 'export * from "./plugin/docx.ts"; export * from "./plugin/project.ts"; export * from "./plugin/presentation.ts"; export * from "./plugin/tools.ts"; export { resources } from "./scripts/resources.ts";', resolveDir: root }, bundle: true, platform: "node", format: "cjs", outfile: path.join(directory, "core.cjs"), loader: { ".lua": "text", ".latex": "text", ".css": "text" } });
const { exportDocx, parseProject, fontFamily, detectTool, resources } = createRequire(import.meta.url)(path.join(directory, "core.cjs"));
const pandoc = await detectTool("pandoc"); assert.equal(pandoc.state, "found");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");
await writeFile(path.join(directory, "image.png"), png);
const sources = [
	{ path: path.join(directory, "01.md"), content: "# PARTIE\n\n## AOUT\n\nPREMIERPARAGRAPHE *italique*, **gras**, ***grasitalique*** avec une note[^1].\n\n> CITATION\n\n\tTABULATION *italique*.\n\n```\nCODELITTERAL\n```\n\n- ELEMENTLISTE\n\n| ENTETE | AUTRE |\n|---|---|\n| CELLULE | TEXTE |\n\nH~2~O m^2^ [lien](https://example.org).\n\n[^1]: NOTEPREMIERE.\n" },
	{ path: path.join(directory, "02.md"), content: "# PARTIE\n\n## AOUT\n\nDEUXIEMEPARAGRAPHE.[^1]\n\n[^1]: NOTESECONDE.\n" },
	{ path: path.join(directory, "bookbinder.md"), content: "PROJETEXCLU" },
];
const request = { sources, directory, pandoc: pandoc.path, resources, fontDirectory: path.join(root, "fonts") };
const sourceHashes = new Set(await Promise.all((await readdir(request.fontDirectory)).filter(name => /\.(otf|ttf)$/i.test(name)).map(async name => createHash("sha256").update(await readFile(path.join(request.fontDirectory, name))).digest("hex"))));
const extract = async (file, part) => (await exec("unzip", ["-p", file, part === "[Content_Types].xml" ? "\\[Content_Types\\].xml" : part], { maxBuffer: 16 * 1024 * 1024 })).stdout;
for (const position of [undefined, "page-bottom", "document-end"]) {
	const output = path.join(directory, "notes-" + (position ?? "default") + ".docx");
	await exportDocx({ ...request, output, project: parseProject({ docx: { toc: false, page: position ? { "notes-position": position } : {}, styles: { "section.footnotes p": { "page-break-before": "always" }, ".bookbinder-note-reference": { "font-size": "8pt", color: "#123456", "vertical-align": "super" }, ".bookbinder-footnote-index": { "font-size": "12pt", color: "#654321", "vertical-align": "baseline" }, ".bookbinder-footnote-separator": { width: "60%", "border-top-width": "1pt", color: "#ABCDEF", "text-align": "center" } } } }, "Notes", "docx"), sources: [
		{ path: path.join(directory, "note-a.md"), content: "Text[^1].\n\n[^1]: FIRSTNOTE **bold** [link](https://example.org/notes).\n\n    Second paragraph.\n" },
		{ path: path.join(directory, "note-b.md"), content: "More text[^1].\n\n[^1]: SECONDNOTE *italic* ![image](image.png).\n" },
	] });
	const kind = position === "document-end" ? "endnote" : "footnote";
	const document = await extract(output, "word/document.xml"), notes = await extract(output, `word/${kind}s.xml`), relationships = await extract(output, `word/_rels/${kind}s.xml.rels`), settings = await extract(output, "word/settings.xml");
	const references = [...document.matchAll(new RegExp(`<w:${kind}Reference\\b[^>]*w:id="(\\d+)"`, "g"))].map(match => match[1]);
	assert.equal(references.length, 2, "References from independently numbered source files are preserved");
	assert.equal(new Set(references).size, 2, "Notes keep distinct identifiers across files");
	const styles = await extract(output, "word/styles.xml");
	const referenceStyle = [...styles.matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([^]*?)<\/w:style>/g)].find(match => match[2].includes('w:name w:val="Footnote call"'));
	assert.ok(referenceStyle); assert.match(referenceStyle[2], /w:sz w:val="16"/); assert.match(referenceStyle[2], /w:color w:val="123456"/);
	const noteStyles = new Map([...styles.matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([^]*?)<\/w:style>/g)].map(match => [match[1], match[2]]));
	const indexStyle = [...noteStyles].find(([, value]) => value.includes('w:name w:val="Footnote index"'));
	assert.ok(indexStyle); assert.match(indexStyle[1], /w:sz w:val="24"/); assert.match(indexStyle[1], /w:vertAlign w:val="baseline"/); assert.match(indexStyle[1], /w:color w:val="654321"/);
	const separatorStyle = noteStyles.get("BookbinderFootnoteSeparator"); assert.match(separatorStyle, /w:sz="8"[^>]*w:color="ABCDEF"/);
	assert.match(notes, /w:pStyle w:val="BookbinderFootnoteSeparator"/); assert.doesNotMatch(notes, /<w:(?:continuationSeparator|separator)\s/);
	for (const match of document.matchAll(/<w:r>([^]*?)<\/w:r>/g)) if (match[1].includes(`<w:${kind}Reference`)) assert.ok(match[1].includes(`w:rStyle w:val="${referenceStyle[1]}"`), "Every body note reference uses its own character style");
	for (const id of references) assert.match(notes, new RegExp(`<w:${kind}\\b[^>]*w:id="${id}"`));
	for (const text of ["FIRSTNOTE", "SECONDNOTE"]) {
		const paragraph = [...notes.matchAll(/<w:p[ >][^]*?<\/w:p>/g)].find(match => match[0].includes(text))?.[0];
		assert.match(paragraph, new RegExp(`<w:${kind}Ref\\b`), "The note number and its first text share a paragraph");
		assert.ok(paragraph.includes(`w:rStyle w:val="${indexStyle[0]}"`), "The note number uses Footnote index");
		assert.ok(!paragraph.includes(`w:rStyle w:val="${referenceStyle[1]}"`), "The body reference style does not change note text or its marker");
	}
	assert.doesNotMatch(notes, /<!--bookbinder-/);
	for (const text of ["FIRSTNOTE", "SECONDNOTE", "Second paragraph."]) assert.ok(notes.includes(text));
	assert.match(notes, /<w:hyperlink /); assert.match(notes, /<w:drawing>/);
	assert.match(relationships, /https:\/\/example.org\/notes/); assert.match(relationships, /relationships\/image/);
	const noteRelationship = [...(await extract(output, "word/_rels/document.xml.rels")).matchAll(/<Relationship\s[^>]*\/>/g)].find(match => match[0].includes(`/relationships/${kind}s"`));
	assert.ok(noteRelationship); assert.match(noteRelationship[0], new RegExp(`Target="${kind}s\\.xml"`));
	assert.match(await extract(output, "[Content_Types].xml"), new RegExp(`wordprocessingml\\.${kind}s\\+xml`));
	assert.match(settings, new RegExp(`<w:${kind}Pr><w:pos w:val="${kind === "endnote" ? "docEnd" : "pageBottom"}"/><w:numFmt w:val="decimal"/>`));
	assert.match(settings, new RegExp(`<w:${kind} w:id="-1"/><w:${kind} w:id="0"/>`), "Word settings reference both custom separators");
	if (kind === "endnote") {
		assert.doesNotMatch(document, /<w:footnoteReference/);
		const files = (await exec("unzip", ["-Z1", output])).stdout.split("\n");
		assert.ok(!files.includes("word/footnotes.xml") && !files.includes("word/_rels/footnotes.xml.rels"));
	}
	for (const xml of [document, notes, relationships, settings]) execFileSync("xmllint", ["--noout", "-"], { input: xml });
}
console.log("DOCX notes: native footnotes/endnotes, separate source numbering, paragraphs, links and images: OK.");
const charactersOutput = path.join(directory, "character-formatting.docx");
await exportDocx({ ...request, output: charactersOutput, sources: [{ path: path.join(directory, "characters.md"), content: await readFile(path.join(root, "scripts/fixtures/character-formatting.md"), "utf8") }], project: parseProject({ docx: { toc: false, headings: { h3: { "text-transform": "uppercase" } }, styles: { em: { "vertical-align": "super" }, strong: { "vertical-align": "sub" }, "blockquote p": { "font-variant": "small-caps" }, sup: { "vertical-align": "baseline" }, ".smallcaps": { "font-variant": "normal" }, ul: { "text-transform": "uppercase" }, table: { "text-transform": "uppercase" } } } }, "Livre", "docx") });
const charactersStyles = await extract(charactersOutput, "word/styles.xml");
for (const [name, property] of [["heading 3", '<w:caps w:val="1"/>'], ["Emphasis", '<w:vertAlign w:val="superscript"/>'], ["Strong emphasis", '<w:vertAlign w:val="subscript"/>']]) {
	const style = [...charactersStyles.matchAll(/<w:style\b[^>]*>[^]*?<\/w:style>/g)].find(match => match[0].includes(`<w:name w:val="${name}"/>`));
	assert.ok(style && style[0].includes(property), "Native Word style exports character formatting: " + name);
}
const characterStyles = new Map([...charactersStyles.matchAll(/<w:style\s[^>]*w:styleId="([^"]+)"[^>]*>([^]*?)<\/w:style>/g)].map(match => [match[1], match[2]]));
const charactersDocument = await extract(charactersOutput, "word/document.xml");
for (const marker of ["Liste minuscule.", "Cellule minuscule."]) {
	const paragraph = [...charactersDocument.matchAll(/<w:p[ >][^]*?<\/w:p>/g)].find(match => match[0].includes(marker))[0];
	let id = paragraph.match(/<w:pStyle w:val="([^"]+)"/)[1], caps;
	while (id && caps === undefined) { const style = characterStyles.get(id); caps = style.match(/<w:caps w:val="(\d)"/)?.[1]; id = style.match(/<w:basedOn w:val="([^"]+)"/)?.[1]; }
	assert.equal(caps, "1", "Word list/table text inherits its container's character formatting");
}
const typographyOutput = path.join(directory, "heading-leading-hyphenation.docx");
await exportDocx({ ...request, output: typographyOutput, sources: [{ path: path.join(directory, "typography.md"), content: "### TITRENORMAL\n\nCORPSSANSCESURE\n\n> PREMIERECITATION\n\n> SECONDECITATION" }], project: parseProject({ docx: { toc: false, style: { "line-height": "30pt", hyphens: "none" }, styles: { "blockquote p": { hyphens: "auto" } }, rules: { "blockquote .bookbinder-first-quote + p": { hyphens: "none" } } } }, "Livre", "docx") });
const typographyStyles = await extract(typographyOutput, "word/styles.xml"), typographyDocument = await extract(typographyOutput, "word/document.xml");
assert.match(await extract(typographyOutput, "word/settings.xml"), /<w:autoHyphenation w:val="true"\/>/);
const typographyMap = new Map([...typographyStyles.matchAll(/<w:style\s[^>]*w:styleId="([^"]+)"[^>]*>([^]*?)<\/w:style>/g)].map(match => [match[1], match[2]]));
for (const [marker, suppress] of [["CORPSSANSCESURE", 1], ["PREMIERECITATION", 1], ["SECONDECITATION", 0]]) {
	const paragraph = [...typographyDocument.matchAll(/<w:p[ >][^]*?<\/w:p>/g)].find(match => match[0].includes(marker))[0];
	let style = typographyMap.get(paragraph.match(/<w:pStyle w:val="([^"]+)"/)[1]);
	while (!style.includes("<w:suppressAutoHyphens")) style = typographyMap.get(style.match(/<w:basedOn w:val="([^"]+)"/)[1]);
	assert.match(style, new RegExp(`<w:suppressAutoHyphens w:val="${suppress}"/>`), "Native Word paragraph style honors hyphenation and first-quote rule: " + marker);
}
for (let level = 1; level <= 6; level++) assert.match(typographyMap.get("Heading" + level), /w:line="288" w:lineRule="auto"/, "Every Word heading uses normal leading independently of fixed body leading");
const separatorOutput = path.join(directory, "characters-separator.docx");
await exportDocx({ ...request, output: separatorOutput, sources: [
	{ path: path.join(directory, "separator-a.md"), content: "PREMIER\n\n---\n\nDEUXIEME\n\n***\n\nTROISIEME\n\n___\n\nQUATRIEME" },
	{ path: path.join(directory, "separator-b.md"), content: "CINQUIEME" },
], project: parseProject({ fusion: { noteSeparator: "---" }, docx: { toc: false, separator: "* & *", styles: { hr: { "font-size": "18pt", "text-align": "center" } } } }, "Livre", "docx") });
const separatorXml = await extract(separatorOutput, "word/document.xml"), separatorStyles = await extract(separatorOutput, "word/styles.xml");
const separatorParagraphs = [...separatorXml.matchAll(/<w:p[ >][^]*?<\/w:p>/g)].filter(match => match[0].includes("* &amp; *"));
assert.equal(separatorParagraphs.length, 4, "All Markdown thematic breaks and the note separator use literal custom characters");
assert.doesNotMatch(separatorXml, /<w:pBdr>/, "Character separators have no horizontal rule");
assert.doesNotMatch(separatorXml, /<w:instrText[^>]*>\s*(?:TC|TOC)\s/, "A book without contents has no unused index fields");
assert.match(await extract(separatorOutput, "word/settings.xml"), /<w:updateFields w:val="false"\/>/, "A book without contents does not request a global field update at opening");
const separatorStyleId = separatorParagraphs[0][0].match(/<w:pStyle w:val="([^"]+)"/)[1];
const separatorStyle = [...separatorStyles.matchAll(/<w:style\s[^>]*w:styleId="([^"]+)"[^>]*>([^]*?)<\/w:style>/g)].find(match => match[1] === separatorStyleId)[2];
assert.match(separatorStyle, /<w:sz w:val="36"\/>/); assert.match(separatorStyle, /<w:jc w:val="center"\/>/);
for (const [copyright, count, cover] of [[true, true, false], [false, false, false], [true, false, true], [false, true, true]]) {
	const output = path.join(directory, `title-details-${copyright}-${count}-${cover}.docx`);
	await exportDocx({ ...request, output, sources: [
		{ path: path.join(directory, "count.md"), content: "# Été\n\nBonjour *toi* [là](https://example.org).[^1]\n\n[^1]: Note cachée." },
		{ path: path.join(directory, "bookbinder.md"), content: "NEPASCOMPTER" },
	], project: parseProject({ title: "TITRECOMPTE", author: "AUTEURCOMPTE", rights: "© 2026 Auteur & Éditeur", cover: cover ? "image.png" : undefined, colophon: "COLOPHONNONCOMPTE", docx: { toc: true, "title-page": { copyright, "character-count": count } } }, "Livre", "docx") });
	const document = await extract(output, "word/document.xml");
	assert.equal(document.includes("© 2026 Auteur &amp; Éditeur"), copyright);
	assert.equal(document.includes("32 signes, espaces compris"), count, "Counts rendered accented text and footnotes, excluding markup, project and colophon");
	const toc = document.indexOf("<w:sdt>");
	for (const marker of [copyright && "© 2026", count && "32 signes"]) if (marker) {
		const position = document.indexOf(marker);
		assert.ok(position > document.indexOf(cover ? 'w:val="BookbinderCover"' : "AUTEURCOMPTE") && position < toc, "Details follow the title/cover and precede the contents");
	}
	execFileSync("xmllint", ["--noout", "-"], { input: document });
}
for (const [index, size] of ["a5", "a4", "custom"].entries()) {
	const project = parseProject({ title: "TITRELIVRE", author: "AUTEURLIVRE", colophon: "COLOPHONPERSONNEL", docx: {
		page: { "paper-size": size, "paper-width": "160mm", "paper-height": "240mm", "page-mode": "double", "margin-inner": "24mm", "margin-outer": "14mm", "binding-offset": "7mm", "folio-position": "outer", "folio-offset": "8mm" },
		styles: { ".bookbinder-folio": { "font-family": fontFamily("FiraSans-Regular.otf"), "font-size": "10pt", "font-style": "italic", color: "#aabbcc" } },
	} }, "Livre", "docx");
	const output = path.join(directory, size + ".docx");
	assert.equal(await exportDocx({ ...request, project, output }), output);
	assert.equal((await readFile(output)).subarray(0, 2).toString(), "PK");
	await exec("unzip", ["-t", output]);
	const contentTypes = await extract(output, "[Content_Types].xml");
	for (const [element, attribute] of [["Default", "Extension"], ["Override", "PartName"]]) {
		const keys = [...contentTypes.matchAll(new RegExp(`<${element}\\b[^>]*${attribute}="([^"]+)"`, "g"))].map(match => match[1]);
		assert.equal(new Set(keys).size, keys.length, "A DOCX package declares each content type once: " + element);
	}
	const entries = (await exec("unzip", ["-Z1", output])).stdout.trim().split("\n");
	for (const part of entries.filter(part => /\.(xml|rels)$/.test(part))) execFileSync("xmllint", ["--noout", "-"], { input: await extract(output, part) });
	const document = await extract(output, "word/document.xml"), styles = await extract(output, "word/styles.xml"), settings = await extract(output, "word/settings.xml");
	const odd = await extract(output, "word/bookbinder-footer-Odd.xml"), even = await extract(output, "word/bookbinder-footer-Even.xml");
	assert.match(odd, /w:jc w:val="right"/); assert.match(even, /w:jc w:val="left"/);
	assert.match(odd, /w:instr="PAGE"/); assert.match(odd, /w:pStyle w:val="BookbinderFolio"/);
	assert.match(styles, /w:styleId="BookbinderFolio"[^]*?<w:sz w:val="20"/);
	assert.match(styles, /w:styleId="BookbinderFolio"[^]*?<w:color w:val="aabbcc"/);
	assert.match(styles, /w:line="288" w:lineRule="auto"/, "Word uses native Auto leading at 1.2 times the font size");
	assert.match(styles, /w:rFonts w:ascii="EB Garamond"/);
	const styleMap = new Map([...styles.matchAll(/<w:style\s[^>]*w:styleId="([^"]+)"[^>]*>([^]*?)<\/w:style>/g)].map(match => [match[1], match[2]]));
	const italicBoldRun = [...document.matchAll(/<w:r>([^]*?)<\/w:r>/g)].find(match => match[1].includes(">grasitalique</w:t>"))[1];
	let current = italicBoldRun.match(/w:rStyle w:val="([^"]+)"/)[1], bold, italic;
	while (current) {
		const definition = styleMap.get(current); assert.ok(definition, "Every character style exists");
		if (bold === undefined && definition.includes("<w:b ")) bold = definition.match(/<w:b w:val="([^"]+)"/)[1];
		if (italic === undefined && definition.includes("<w:i ")) italic = definition.match(/<w:i w:val="([^"]+)"/)[1];
		current = definition.match(/<w:basedOn w:val="([^"]+)"/)?.[1];
	}
	assert.equal(bold, "1", "Nested Markdown preserves bold"); assert.equal(italic, "1", "Nested Markdown preserves italic");
	for (const marker of ["ELEMENTLISTE", "CELLULE", "ENTETE"]) {
		const paragraph = [...document.matchAll(/<w:p[ >][^]*?<\/w:p>/g)].find(match => match[0].includes(">" + marker + "</w:t>"))[0];
		assert.match(paragraph, /w:pStyle w:val="BookbinderStyle\d+"/, "Lists and cells retain their configured paragraph styles");
	}
	assert.match(settings, /<w:mirrorMargins\/>/); assert.match(settings, /<w:evenAndOddHeaders\/>/);
	const settingOrder = ["embedTrueTypeFonts", "embedSystemFonts", "saveSubsetFonts", "mirrorMargins", "proofState", "evenAndOddHeaders", "drawingGridHorizontalSpacing", "updateFields", "rsids"];
	for (let index = 1; index < settingOrder.length; index++) assert.ok(settings.indexOf("<w:" + settingOrder[index - 1]) < settings.indexOf("<w:" + settingOrder[index]), "DOCX settings follow the ECMA-376 order: " + settingOrder[index]);
	const orderedProperties = (styleId, names) => {
		const style = [...styles.matchAll(/<w:style\s[^>]*w:styleId="([^"]+)"[^>]*>([^]*?)<\/w:style>/g)].find(match => match[1] === styleId)?.[2]; assert.ok(style, styleId);
		const properties = style.match(/<w:pPr>([^]*?)<\/w:pPr>/)?.[1]; assert.ok(properties, styleId);
		for (let index = 1; index < names.length; index++) assert.ok(properties.indexOf("<w:" + names[index - 1]) < properties.indexOf("<w:" + names[index]), styleId + " follows paragraph property order: " + names[index]);
	};
	for (let level = 1; level <= 6; level++) orderedProperties("Heading" + level, ["keepNext", "pageBreakBefore", "spacing", "ind", "jc", "outlineLvl"]);
	orderedProperties("BookbinderCredit", ["spacing", "ind", "jc"]);
	assert.match(document, /w:footer="454"/); assert.match(document, /w:gutter="397"/);
	const [width, height] = size === "a4" ? [210, 297] : size === "a5" ? [148, 210] : [160, 240];
	assert.match(document, new RegExp(`w:pgSz w:w="${Math.round(width * 1440 / 25.4)}" w:h="${Math.round(height * 1440 / 25.4)}"`));
	const tableGrid = document.match(/<w:tblGrid>([^]*?)<\/w:tblGrid>/)[1];
	const tableWidth = [...tableGrid.matchAll(/w:w="(\d+)"/g)].reduce((total, match) => total + Number(match[1]), 0);
	assert.ok(tableWidth <= Math.round((width - 24 - 14 - 7) * 1440 / 25.4) + 2, "Tables fit between the configured margins and binding allowance");
	const roundtrip = (await exec(pandoc.path, [output, "--to=json"])).stdout;
	for (const marker of ["TITRELIVRE", "AUTEURLIVRE", "PREMIERPARAGRAPHE", "DEUXIEMEPARAGRAPHE", "CODELITTERAL", "CITATION", "TABULATION", "ELEMENTLISTE", "CELLULE", "NOTEPREMIERE", "NOTESECONDE", "COLOPHONPERSONNEL", "Bookbinder"]) assert.ok(roundtrip.includes(marker), "DOCX preserves " + marker);
	assert.ok(!roundtrip.includes("PROJETEXCLU"));
	const bookmarks = [...document.matchAll(/<w:bookmarkStart[^>]*w:name="([^"]+)"/g)].map(match => match[1]);
	assert.equal(bookmarks.length, 4, "Every part and chapter has a bookmark");
	assert.equal(new Set(bookmarks).size, 4, "Repeated headings have unique Word-compatible bookmarks");
	const fonts = await extract(output, "word/fontTable.xml");
	assert.match(fonts, /<w:embedRegular/); assert.match(fonts, /<w:embedBoldItalic/);
	const relationships = await extract(output, "word/_rels/fontTable.xml.rels");
	for (const match of fonts.matchAll(/r:id="([^"]+)" w:fontKey="\{([^}]+)\}"/g)) {
		const target = relationships.match(new RegExp(`Id="${match[1]}"[^>]*Target="([^"]+)"`))[1];
		const bytes = (await exec("unzip", ["-p", output, "word/" + target], { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 })).stdout;
		const mask = Buffer.from(match[2].replace(/-/g, ""), "hex").reverse();
		for (let byte = 0; byte < 32; byte++) bytes[byte] ^= mask[byte % 16];
		assert.equal(bytes.readUInt32BE(0), 0x10000, "Embedded fonts decode to their original OpenType data");
		assert.ok(sourceHashes.has(createHash("sha256").update(bytes).digest("hex")), "Every embedded font restores byte-for-byte to the original file");
	}
	if (index === 0) {
		const previous = await readFile(output);
		await assert.rejects(exportDocx({ ...request, project, output, pandoc: path.join(directory, "no-pandoc") }));
		assert.deepEqual(await readFile(output), previous);
		assert.equal(await exportDocx({ ...request, project, output, confirmOverwrite: async () => "cancel" }), undefined);
		assert.deepEqual(await readFile(output), previous);
	}
}
const hidden = path.join(directory, "no-folio.docx");
await exportDocx({ ...request, project: parseProject({ docx: { page: { "folio-position": "none" } } }, "Livre", "docx"), output: hidden });
assert.doesNotMatch(await extract(hidden, "word/bookbinder-footer-Odd.xml"), /PAGE/);
const illustrated = path.join(directory, "cover.docx");
await exportDocx({ ...request, sources: [{ path: path.join(directory, "illustrated.md"), content: "## CHAPITREILLUSTRE\n\n![Illustration](image.png)\n\n![Encore](image.png)\n\nTEXTEILLUSTRE." }], project: parseProject({ cover: "image.png" }, "Couverture", "docx"), output: illustrated });
const illustratedXml = await extract(illustrated, "word/document.xml"), illustratedStyles = await extract(illustrated, "word/styles.xml");
assert.ok(illustratedXml.indexOf('w:val="BookbinderCover"') < illustratedXml.indexOf("<w:sdt>"), "The cover comes before the table of contents");
assert.ok(illustratedXml.indexOf("<w:sdt>") < illustratedXml.indexOf(">CHAPITREILLUSTRE</w:t>"), "The table of contents precedes the manuscript");
assert.match(illustratedStyles, /w:styleId="BookbinderCover"[^]*?<w:spacing[^>]*w:lineRule="atLeast"/, "The cover is never clipped to the body leading");
assert.match(illustratedStyles, /w:styleId="BookbinderStyle0Image"[^]*?<w:spacing[^>]*w:lineRule="atLeast"/, "Illustrations can expand their paragraph height");
const illustratedIds = [...illustratedStyles.matchAll(/w:styleId="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(illustratedIds).size, illustratedIds.length, "Generated image styles have no duplicate identifiers");
const facing = path.join(directory, "facing.docx");
await exportDocx({ ...request, project: parseProject({ fusion: { noteSeparator: "odd" }, docx: { page: { "page-mode": "double", "folio-position": "inner" } } }, "Livre", "docx"), output: facing });
const facingXml = await extract(facing, "word/document.xml");
assert.match(facingXml, /<w:type w:val="oddPage"\/>/);
const sections = [...facingXml.matchAll(/<w:sectPr[^>]*>([^]*?)<\/w:sectPr>/g)].map(match => match[1]);
assert.equal(sections.length, 2);
assert.doesNotMatch(sections[0], /w:type w:val="oddPage"/);
assert.match(sections[1], /w:type w:val="oddPage"/, "The odd-page break belongs to the section that starts the next note");
assert.equal((facingXml.match(/<w:titlePg\/>/g) ?? []).length, 1, "Only the first book page uses a blank footer, not the start of every note");
assert.match(await extract(facing, "word/bookbinder-footer-Odd.xml"), /w:jc w:val="left"/);
assert.match(await extract(facing, "word/bookbinder-footer-Even.xml"), /w:jc w:val="right"/);
for (const [toc, depth] of [[false, 6], [true, 1], [true, 3], [true, 6]]) {
	const output = path.join(directory, `toc-${toc}-${depth}.docx`);
	await exportDocx({ ...request, project: parseProject({ docx: { toc, "toc-depth": depth } }, "Sommaire", "docx"), output });
	const document = await extract(output, "word/document.xml");
	assert.match(await extract(output, "word/settings.xml"), new RegExp(`<w:updateFields w:val="${toc}"/>`), "Only a requested table of contents asks Word to update fields at opening");
	if (toc) assert.match(document, new RegExp(`TOC \\\\o &quot;1-${depth}&quot;`), "Word requests the selected heading depth");
	else { assert.doesNotMatch(document, /TOC \\o|<w:sdt>/); assert.match(document, />PREMIERPARAGRAPHE<\/w:t>/, "Disabling the TOC preserves the manuscript"); }
}
const headingSources = [{ path: path.join(directory, "heading-a.md"), content: "AVANTPARITE\n\n## TITREPARITEA\n\nAPRESTITREA" }, { path: path.join(directory, "heading-b.md"), content: "## TITREPARITEB\n\nAPRESTITREB" }];
for (const mode of ["auto", "always", "left", "right"]) {
	const parity = mode === "left" || mode === "right", output = path.join(directory, `heading-${mode}.docx`);
	await exportDocx({ ...request, sources: headingSources, project: parseProject({ fusion: { noteSeparator: parity ? "odd" : "" }, docx: { toc: false, headings: { h2: { "page-break-before": mode, ...(parity ? { "page-position": "one-third" } : {}) } } } }, "Titres", "docx"), output });
	const document = await extract(output, "word/document.xml"), styles = await extract(output, "word/styles.xml");
	const sections = [...document.matchAll(/<w:sectPr[^>]*>([^]*?)<\/w:sectPr>/g)].map(match => match[1]);
	assert.equal(sections.length, parity ? 3 : 1, "A heading’s parity replaces the note break without adding duplicate sections");
	if (parity) {
		assert.doesNotMatch(sections[0], /w:type w:val="(?:even|odd)Page"/);
		for (const section of sections.slice(1)) assert.match(section, new RegExp(`w:type w:val="${mode === "left" ? "even" : "odd"}Page"`), "Parity belongs to each heading’s new section");
	}
	const headingStyle = styles.match(/<w:style[^>]*w:styleId="Heading2"[^>]*>([^]*?)<\/w:style>/)[1];
	assert.match(headingStyle, new RegExp(`w:pageBreakBefore w:val="${mode === "always" ? 1 : 0}"`), "Parity sections do not add a second ordinary page break");
	for (const marker of ["AVANTPARITE", "TITREPARITEA", "APRESTITREA", "TITREPARITEB", "APRESTITREB"]) assert.ok(document.includes(">" + marker + "</w:t>"));
}
const contextualSources = [{ path: path.join(directory, "context-a.md"), content: [
	"### RULESTART", "*RULEEM* *NORMALEM*", "### NORMALH3", "#### LOWERH4", "### STILLNORMAL", "## PARENT", "### RULEAFTERPARENT",
	"```\nRULECODE\n```", "```\nNORMALCODE\n```", "- RULELIST", "PARAGRAPHE", "- NORMALLIST", "| ENTETE |\n|---|\n| RULECELL |", "| ENTETEDEUX |\n|---|\n| NORMALCELL |",
].join("\n\n") }, { path: path.join(directory, "context-b.md"), content: "# NEWPART\n\n### RULEAFTERPART\n\nFIN" }];
const contextualProject = parseProject({ fusion: { noteSeparator: "" }, docx: { toc: false,
	headings: Object.fromEntries([1, 2, 3, 4].map(level => ["h" + level, { "page-break-before": "auto", ...(level === 3 ? { "font-family": "body", "font-size": "body" } : {}) }])), rules: {
		".bookbinder-rule-h3": { "page-break-before": "right", color: "#aa0000", "font-size": "20pt" },
		".bookbinder-rule-em > em": { "font-style": "normal", "font-size": "19pt" }, ".bookbinder-rule-pre": { "font-size": "16pt" },
		".bookbinder-rule-ul": { "font-size": "15pt" }, ".bookbinder-rule-table": { "font-size": "14pt" },
	} } }, "Context", "docx");
const contextualOutput = path.join(directory, "contextual.docx");
await exportDocx({ ...request, sources: contextualSources, project: contextualProject, output: contextualOutput });
const contextualXml = await extract(contextualOutput, "word/document.xml"), contextualStyles = await extract(contextualOutput, "word/styles.xml");
const contextParagraphs = [...contextualXml.matchAll(/<w:p[ >][^]*?<\/w:p>/g)].map(match => match[0]);
const paragraphId = marker => contextParagraphs.find(paragraph => paragraph.includes(">" + marker + "</w:t>"))?.match(/<w:pStyle w:val="([^"]+)"/)?.[1];
const ruleHeadingId = paragraphId("RULESTART"); assert.match(ruleHeadingId, /^BookbinderRule/);
for (const marker of ["RULEAFTERPARENT", "RULEAFTERPART"]) assert.equal(paragraphId(marker), ruleHeadingId);
for (const marker of ["NORMALH3", "STILLNORMAL"]) assert.equal(paragraphId(marker), "Heading3");
const contextSections = [...contextualXml.matchAll(/<w:sectPr[^>]*>([^]*?)<\/w:sectPr>/g)].map(match => match[1]);
assert.equal(contextSections.length, 4, "Only the first H3 and the first H3 after H1/H2 open odd-page sections");
for (const section of contextSections.slice(1)) assert.match(section, /w:type w:val="oddPage"/);
const contextStyleMap = new Map([...contextualStyles.matchAll(/<w:style\s[^>]*w:styleId="([^"]+)"[^>]*>([^]*?)<\/w:style>/g)].map(match => [match[1], match[2]]));
const inheritedProperty = (id, pattern) => {
	while (id) { const value = contextStyleMap.get(id); if (!value) return; const match = value.match(pattern); if (match) return match[1]; id = value.match(/<w:basedOn w:val="([^"]+)"/)?.[1]; }
};
assert.equal(inheritedProperty(ruleHeadingId, /w:outlineLvl w:val="([^"]+)"/), "2", "Conditional H3 retains its outline level and bookmark");
assert.equal(inheritedProperty("Heading3", /<w:sz w:val="([^"]+)"/), "22", "H3 body references resolve to the body's 11pt size");
assert.equal(inheritedProperty("Heading3", /<w:rFonts w:ascii="([^"]+)"/), "EB Garamond", "H3 body references resolve to the body family");
for (const [first, next, size] of [["RULECODE", "NORMALCODE", "32"], ["RULELIST", "NORMALLIST", "30"], ["RULECELL", "NORMALCELL", "28"]]) {
	assert.equal(inheritedProperty(paragraphId(first), /<w:sz w:val="([^"]+)"/), size, first + " receives the contextual size");
	assert.notEqual(inheritedProperty(paragraphId(next), /<w:sz w:val="([^"]+)"/), size, next + " keeps its normal size");
}
const inlineRuleRun = [...contextualXml.matchAll(/<w:r>([^]*?)<\/w:r>/g)].find(match => match[1].includes(">RULEEM</w:t>"))[1];
assert.equal(inheritedProperty(inlineRuleRun.match(/w:rStyle w:val="([^"]+)"/)[1], /<w:i w:val="([^"]+)"/), "0", "A character rule can cancel Markdown italics");
assert.doesNotMatch(contextualXml, /<!--bookbinder-/, "No internal writer markers remain in Word");
execFileSync("xmllint", ["--noout", "-"], { input: contextualXml });
const spacingOutput = path.join(directory, "paragraph-spacing.docx");
await exportDocx({ ...request, sources: [{ path: path.join(directory, "spacing.md"), content: await readFile(path.join(root, "scripts/fixtures/paragraph-spacing.md"), "utf8") }], project: parseProject({ colophon: "COLONE\n\nCOLTWO", docx: { toc: false, style: { "margin-top": "6pt", "margin-bottom": "9pt", "line-height": "12pt" } } }, "Spacing", "docx"), output: spacingOutput });
const spacingXml = (await extract(spacingOutput, "word/document.xml")) + (await extract(spacingOutput, "word/footnotes.xml"));
const spacingStyles = new Map([...(await extract(spacingOutput, "word/styles.xml")).matchAll(/<w:style\s[^>]*w:styleId="([^"]+)"[^>]*>([^]*?)<\/w:style>/g)].map(match => [match[1], match[2]]));
const margin = (marker, property) => {
	const paragraph = [...spacingXml.matchAll(/<w:p[ >][^]*?<\/w:p>/g)].find(match => match[0].includes(">" + marker + "</w:t>"))?.[0]; assert.ok(paragraph, marker);
	let id = paragraph.match(/<w:pStyle w:val="([^"]+)"/)?.[1];
	while (id) { const style = spacingStyles.get(id); if (!style) break; const value = style.match(new RegExp(`<w:spacing[^>]*w:${property}="(\\d+)"`)); if (value) return Number(value[1]); id = style.match(/<w:basedOn w:val="([^"]+)"/)?.[1]; }
};
for (const marker of ["BODYONE", "QUOTEONE", "BODYRESET", "TABONE", "BODYAFTERTAB", "FOOTONE", "COLONE"]) assert.equal(margin(marker, "before"), 120, marker + " keeps its leading top margin");
for (const marker of ["BODYTWO", "BODYTHREE", "QUOTETWO", "QUOTETHREE", "QUOTEFOUR", "TABTWO", "TABTHREE", "FOOTTWO", "FOOTTHREE", "COLTWO"]) { assert.equal(margin(marker, "before"), 0, marker + " drops the repeated top margin"); assert.equal(margin(marker, "after"), 180, marker + " inherits its original bottom margin"); }
const bookFirstOutput = path.join(directory, "first-in-book.docx");
await exportDocx({ ...request, sources: [
	{ path: path.join(directory, "book-a.md"), content: await readFile(path.join(root, "scripts/fixtures/first-in-book.md"), "utf8") },
	{ path: path.join(directory, "book-b.md"), content: "# BOOKPARENTH1\n\n### BOOKAFTERH1\n\nBOOKBODYAFTERH1" },
], project: parseProject({ title: "BOOKTITLE", docx: { toc: false, headings: Object.fromEntries([1, 2, 3, 4].map(level => ["h" + level, { "page-break-before": "auto" }])), rules: {
	".bookbinder-first-title": { "font-size": "30pt" }, ".bookbinder-rule-title": { "font-size": "24pt" },
	".bookbinder-first-h3": { "font-size": "22pt", "page-break-before": "auto" }, ".bookbinder-rule-h3": { "font-size": "16pt", "page-break-before": "right" },
	".bookbinder-first-body + p": { "font-size": "18pt" }, ".bookbinder-after-heading-body + p::first-letter": { "font-size": "2em" },
} } }, "Book first", "docx"), output: bookFirstOutput });
const bookFirstXml = await extract(bookFirstOutput, "word/document.xml"), bookFirstStyles = new Map([...(await extract(bookFirstOutput, "word/styles.xml")).matchAll(/<w:style\s[^>]*w:styleId="([^"]+)"[^>]*>([^]*?)<\/w:style>/g)].map(match => [match[1], match[2]]));
const bookParagraphs = [...bookFirstXml.matchAll(/<w:p[ >][^]*?<\/w:p>/g)].map(match => match[0]);
const bookParagraph = marker => bookParagraphs.find(paragraph => paragraph.replace(/<[^>]+>/g, "").includes(marker));
const bookSize = id => { while (id) { const style = bookFirstStyles.get(id); const value = style?.match(/<w:sz w:val="([^"]+)"/); if (value) return Number(value[1]); id = style?.match(/<w:basedOn w:val="([^"]+)"/)?.[1]; } };
for (const [marker, size] of [["BOOKFIRSTH3", 44], ["BOOKSECONDH3", 28], ["BOOKAFTERH2", 32], ["BOOKAFTERH1", 32], ["ZBOOKFIRSTBODY", 36]]) assert.equal(bookSize(bookParagraph(marker)?.match(/w:pStyle w:val="([^"]+)"/)?.[1]), size, marker + " uses its proper rule");
const initialRun = [...bookParagraph("ZBOOKFIRSTBODY").matchAll(/<w:r>([^]*?)<\/w:r>/g)].find(match => match[1].includes(">Z</w:t>"));
assert.equal(bookSize(initialRun?.[1].match(/w:rStyle w:val="([^"]+)"/)?.[1]), 72, "The first-book initial follows its paragraph size");
assert.equal((bookFirstXml.match(/<w:type w:val="oddPage"\/>/g) ?? []).length, 2, "Only the later H3 rules open odd-page sections");
assert.ok(!(await readdir(directory)).some(name => name.startsWith(".bookbinder-")));
console.log("DOCX réel : formats, marges, reliure, folios, styles, polices intégrées, fusion, notes locales et conservation des exports : OK.");
console.log("Résultats : " + directory);
