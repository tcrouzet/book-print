import assert from "node:assert/strict";
import { execFile } from "node:child_process";
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
	{ path: path.join(directory, "partie 1.md"), content: "# PARTIE\n\n## AOUT\n\nPREMIERPARAGRAPHE avec *italique* et **gras**, une note[^1].\n\n> CITATION avec *emphase*.\n\n\tTABULATION *en italique*.\n\n- ELEMENTLISTE\n\n| ENTETE | AUTRE |\n|---|---|\n| CELLULE | TEXTE |\n\nH~2~O et m^2^, ~~barre~~, [capitales]{.smallcaps}, `INLINECODE`.\n\n```\nCODELITTERAL\n```\n\n---\n\n[^1]: NOTEPREMIERE avec *italique*.\n" },
	{ path: path.join(directory, "partie 2.md"), content: "# PARTIE\n\n## AOUT\n\nDEUXIEMEPARAGRAPHE et sa note[^1].\n\n[^1]: NOTESECONDE.\n" },
	{ path: path.join(directory, "bookbinder.md"), content: "PROJETEXCLU" },
];
const config = { title: "TITRELIVRE", author: "AUTEURLIVRE", lang: "fr", colophon: "COLOPHONPERSONNEL", pdf: {
	page: { "paper-size": "a5", "margin-top": "17mm", "margin-bottom": "22mm", "margin-left": "24mm", "margin-right": "19mm" },
	style: { "font-family": fontFamily("NotoSerif-Regular.otf"), "font-size": "11pt", "line-height": 1.35 },
	headings: { h2: { "font-size": "19pt", "font-style": "italic", "page-position": "one-third", "text-align": "center" } },
	styles: { "h1.title": { "font-size": "27pt", "page-position": "one-third" }, "p.tab": { "text-align": "right", "font-style": "italic" }, "blockquote p": { "font-size": "9pt" }, pre: { "font-family": fontFamily("FiraSans-Regular.otf"), "font-size": "9pt" }, code: { "font-family": fontFamily("SourceSans3-Regular.otf") } },
	rules: { ".bookbinder-after-heading-body + p": { "text-indent": "0pt" }, ".bookbinder-after-heading-body + p::first-letter": { "font-size": "16pt", color: "#aa0000" } },
} };
const request = { sources, directory, pandoc: pandoc.path, xelatex: latex.path, resources, fontDirectory: path.join(root, "fonts") };
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
	const { stdout: fonts } = await exec("pdffonts", [output]);
	assert.ok(fonts.includes("FiraSans") && fonts.includes("SourceSans3"), "Code blocks and inline code use their configured fonts");
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
await exportPdf({ ...request, sources: [{ path: path.join(directory, "simple.md"), content: "## DEFAUT\n\nTEXTEAUTOMATIQUE avec *italique*, **gras** et un [lien](https://example.org)." }], project: parseProject({ title: "PARDEFAUT", pdf: { style: { "letter-spacing": "0.2pt" } } }, "Titre", "pdf"), output: autoOutput });
assert.ok((await exec("pdftotext", [autoOutput, "-"])).stdout.includes("TEXTEAUTOMATIQUE"), "The PDF works without custom fonts or project settings");
for (const mode of ["single", "double"]) {
	const output = path.join(directory, `${mode}-binding.pdf`);
	const project = parseProject({ title: "Reliure", pdf: { page: { "page-mode": mode, "margin-inner": "24mm", "margin-outer": "14mm", "margin-left": "24mm", "margin-right": "14mm", "binding-offset": "7mm" }, style: { "text-indent": "0pt" } } }, "Livre", "pdf");
	await exportPdf({ ...request, project, output, sources: [{ path: path.join(directory, "pages.md"), content: "RECTOLEFT\n\n\\newpage\n\nVERSOLEFT\n" }] });
	const { stdout: boxes } = await exec("pdftotext", ["-bbox", output, "-"]);
	const pages = boxes.match(/<page\b[\s\S]*?<\/page>/g);
	for (const [marker, expected] of [["RECTOLEFT", 31], ["VERSOLEFT", mode === "double" ? 14 : 31]]) {
		const index = pages.findIndex(page => page.includes(`>${marker}</word>`));
		assert.ok(index >= 0);
		const x = Number(pages[index].match(new RegExp(`<word xMin="([\\d.]+)"[^>]*>${marker}</word>`))[1]);
		assert.ok(Math.abs(x - expected * 72 / 25.4) < 0.1, `${mode}: ${marker} applies the binding margin on the correct side`);
		if (mode === "double") assert.equal(index % 2, marker === "RECTOLEFT" ? 0 : 1, "Mirroring follows physical page parity");
	}
}
assert.ok(!(await readdir(directory)).some(name => name.startsWith(".bookbinder-")), "No temporary manuscript or conversion resources remain");
console.log("PDF réel : A4, A5, format personnalisé, simple/double page, reliure, styles, notes locales, fusion et conservation du dernier export : OK.");
console.log("Résultats : " + directory);
