import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { prepareBookSources, runPandoc } from "./epub.ts";
import type { PdfRequest } from "./pdf.ts";
import { resolveLocale, t } from "./i18n.ts";
import { localResource } from "./project.ts";
import { readFontLibrary, resolveFont } from "./font-library.ts";
import { loadFont } from "./project-files.ts";
import { fontChoices, fontFace, fontResources, resolveFontFamilies } from "./presentation.ts";
import { fontEmbeddingAllowed } from "./font-metadata.ts";
import { docxPresentation, xml } from "./docx-presentation.ts";
import { saveGeneratedFile } from "./output.ts";
import { ruleDefinitions, activeRuleDefinitions } from "./book-styles.ts";
import { pdfPage } from "./page-layout.ts";

export type DocxRequest = Omit<PdfRequest, "xelatex">;

export async function exportDocx(request: DocxRequest): Promise<string | undefined> {
	const { directory, output, resources } = request;
	if (!path.isAbsolute(output) || path.extname(output).toLowerCase() !== ".docx") throw new Error(t("theOutputPathMustNameADocxFile"));
	const installed = request.fontDirectory ? await readFontLibrary(request.fontDirectory) : [];
	const faces = new Map(installed.map(font => [font.reference, font.face])), lookup = (reference: string) => faces.get(reference);
	const project = structuredClone(request.project);
	resolveFontFamilies(project, installed.map(font => font.reference), lookup);
	const { sources, pageBreak } = prepareBookSources({ ...request, project });
	const presentation = docxPresentation(project, lookup);
	for (const name of ["lua/book-reader.lua", "lua/docx.lua"]) if (!resources[name]) throw new Error(t("missingPluginResourceFilename", { filename: name }));
	await mkdir(path.dirname(output), { recursive: true });
	const temporary = await mkdtemp(path.join(path.dirname(output), ".bookbinder-"));
	try {
		const embedded = new Map<string, { key: string; file: string; id: string }>();
		for (const [index, reference] of project.fonts.entries()) {
			const font = await loadFont(resolveFont(directory, reference, request.fontDirectory));
			if (!/\.(otf|ttf)$/i.test(font.name) || !fontEmbeddingAllowed(font.data)) throw new Error(t("docxFontCannotBeEmbedded", { font: font.name }));
			const key = randomUUID().toUpperCase(), mask = Buffer.from(key.replace(/-/g, ""), "hex").reverse(), bytes = Buffer.from(font.data);
			for (let byte = 0; byte < Math.min(32, bytes.length); byte++) bytes[byte] ^= mask[byte % 16];
			const file = `font-${index}.odttf`;
			await writeFile(path.join(temporary, file), bytes);
			embedded.set(reference, { key, file, id: "bookbinderFont" + index });
		}
		let fontTable = "";
		for (const base of fontChoices(project.fonts, lookup)) {
			fontTable += `<w:font w:name="${xml(fontFace(base, lookup).family)}">`;
			for (const reference of fontResources(base, project.fonts, lookup)) {
				const face = fontFace(reference, lookup), resource = embedded.get(reference)!;
				const shape = face.weight >= 600 ? face.style === "italic" ? "BoldItalic" : "Bold" : face.style === "italic" ? "Italic" : "Regular";
				fontTable += `<w:embed${shape} r:id="${resource.id}" w:fontKey="{${resource.key}}" w:subsetted="0"/>`;
			}
			fontTable += "</w:font>";
		}
		for (const name of ["lua/book-reader.lua", "lua/docx.lua"]) await writeFile(path.join(temporary, path.basename(name)), resources[name]);
		const now = new Date(), metadata: Record<string, unknown> = { date: now.toISOString().slice(0, 10), ...project.metadata };
		const locale = resolveLocale(typeof metadata.lang === "string" ? metadata.lang : "fr");
		await writeFile(path.join(temporary, "metadata.json"), JSON.stringify({ ...metadata, title: String(metadata.title).replace(/\\n|\n/g, " "),
			"bookbinder-copyright": project.titlePage.copyright ? metadata.rights : undefined, "bookbinder-config": path.join(temporary, "presentation.json") }));
		let cover: string | undefined;
		if (project.cover) { cover = localResource(directory, project.cover); await access(cover); }
		const page = pdfPage(project.page);
		await writeFile(path.join(temporary, "presentation.json"), JSON.stringify({ ...presentation, pageBreak, ruleDefinitions, toc: project.toc, tocDepth: project.tocDepth, notesPosition: project.page["notes-position"] ?? "page-bottom", cover,
			coverMaxHeight: project.titlePage.characterCount || project.titlePage.copyright && !!metadata.rights ? (page.height - page.top - page.bottom) * 72 / 25.4 - 48 : undefined,
			fontTable, fonts: [...embedded.values()].map(font => ({ ...font, path: path.join(temporary, font.file) })),
			creditStyle: { id: "BookbinderCredit", xml: `<w:style w:type="paragraph" w:styleId="BookbinderCredit"><w:name w:val="BookbinderCredit"/><w:basedOn w:val="${presentation.styles[".bookbinder-colophon p"].id}"/><w:pPr><w:spacing w:before="660"/><w:ind w:firstLine="0" w:left="0" w:right="0"/><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="18"/></w:rPr></w:style>` } }));
		const result = path.join(temporary, "book.docx");
		await runPandoc(request.pandoc, [`--from=${path.join(temporary, "book-reader.lua")}`, `--to=${path.join(temporary, "docx.lua")}`, `--metadata-file=${path.join(temporary, "metadata.json")}`, `--output=${result}`], directory,
			JSON.stringify({ sources, pageBreak, ruleDefinitions: activeRuleDefinitions(project), separator: project.separator, disabledRules: project.disabledRules,
				characterCountLabel: project.titlePage.characterCount ? t("characterCountValue", { count: "{count}" }, locale) : undefined,
				colophon: metadata.colophon ?? "", colophonTitle: t("colophon", {}, locale), colophonCredit: t("generatedByBookbinderOn", { date: now.toLocaleDateString(locale) }, locale) }));
		return await saveGeneratedFile(result, output, request.confirmOverwrite);
	} finally { await rm(temporary, { recursive: true, force: true }); }
}
