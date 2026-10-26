import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { resolveLocale, t } from "./i18n.ts";
import { prepareBookSources, runPandoc, type BookSource, type EpubRequest } from "./epub.ts";
import { localResource, type BookProject } from "./project.ts";
import { readFontLibrary, resolveFont } from "./font-library.ts";
import { fontFamiliesInStyles, fontFamily, resolveFontFamilies, fontVariants } from "./presentation.ts";
import { loadFont } from "./project-files.ts";
import { pdfPage } from "./page-layout.ts";
import { pdfPresentation } from "./pdf-presentation.ts";
import { saveGeneratedFile, type ExistingOutputChoice } from "./output.ts";
import { ruleDefinitions, activeRuleDefinitions } from "./book-styles.ts";

export interface PdfRequest {
	project: BookProject;
	sources: BookSource[];
	directory: string;
	output: string;
	pandoc: string;
	xelatex: string;
	resources: Readonly<Record<string, string>>;
	fontDirectory?: string;
	resolveImage?: EpubRequest["resolveImage"];
	confirmOverwrite?: (filename: string) => Promise<ExistingOutputChoice>;
}

function texPath(filename: string): string {
	const value = filename.replace(/\\/g, "/");
	if (/[{}%\r\n]/.test(value)) throw new Error(t("expectedALocalResourceFilename", { filename }));
	return "\\detokenize{" + value + "}";
}

export async function exportPdf(request: PdfRequest): Promise<string | undefined> {
	const { directory, output, resources } = request;
	if (!path.isAbsolute(output) || path.extname(output).toLowerCase() !== ".pdf") throw new Error(t("theOutputPathMustNameAPdfFile"));
	const installed = request.fontDirectory ? await readFontLibrary(request.fontDirectory) : [];
	const library = installed.map(font => font.reference), faces = new Map(installed.map(font => [font.reference, font.face]));
	const lookup = (reference: string) => faces.get(reference);
	const project = structuredClone(request.project);
	resolveFontFamilies(project, library, lookup);
	const { sources, pageBreak } = prepareBookSources({ ...request, project });
	const page = pdfPage(project.page), presentation = pdfPresentation(project, project.fonts);
	for (const name of ["lua/book-reader.lua", "lua/pdf.lua", "latex/book.latex"]) {
		if (!resources[name]) throw new Error(t("missingPluginResourceFilename", { filename: name }));
	}
	await mkdir(path.dirname(output), { recursive: true });
	const temporary = await mkdtemp(path.join(path.dirname(output), ".bookbinder-"));
	try {
		let header = presentation.header;
		const bodyFamily = fontFamiliesInStyles({ style: project.style, headings: {}, fonts: [] }).values().next().value;
		const variants = new Map(project.fonts.map(reference => [reference, fontVariants(reference, [...project.fonts, ...library], lookup)]));
		const files = [...new Set([...project.fonts, ...Array.from(variants.values()).flatMap(faces => Object.values(faces))])];
		const staged = new Map<string, string>();
		for (const [index, reference] of files.entries()) {
			const font = resolveFont(directory, reference, request.fontDirectory), extension = path.extname(font).toLowerCase();
			if (![".otf", ".ttf"].includes(extension)) throw new Error(t("pdfFontMustBeOtfOrTtf", { font: reference }));
			const filename = `font-${index}${extension}`;
			await writeFile(path.join(temporary, filename), (await loadFont(font)).data);
			staged.set(reference, filename);
		}
		for (const [index, reference] of project.fonts.entries()) {
			const faces = variants.get(reference)!;
			const options = [["BoldFont", faces.bold], ["ItalicFont", faces.italic], ["BoldItalicFont", faces.boldItalic]]
				.flatMap(([name, face]) => face ? [name + "=" + staged.get(face)] : []);
			const definition = `[Path=${texPath(temporary + "/")},Scale=1${options.length ? "," + options.join(",") : ""}]{${staged.get(reference)}}\n`;
			header += `\\expandafter\\newfontfamily\\csname bookbinderfont${index}\\endcsname` + definition;
			if (fontFamily(reference) === bodyFamily) header += "\\setmainfont" + definition;
		}
		await writeFile(path.join(temporary, "presentation.tex"), header);
		for (const name of ["lua/book-reader.lua", "lua/pdf.lua", "latex/book.latex"]) await writeFile(path.join(temporary, path.basename(name)), resources[name]);
		const now = new Date();
		const metadata: Record<string, unknown> = { date: now.toISOString().slice(0, 10), ...project.metadata };
		const locale = resolveLocale(typeof metadata.lang === "string" ? metadata.lang : "fr");
		await writeFile(path.join(temporary, "metadata.json"), JSON.stringify({ ...metadata, title: String(metadata.title).replace(/\\n|\n/g, " "),
			"bookbinder-copyright": project.titlePage.copyright ? metadata.rights : undefined,
			"bookbinder-title-details": project.titlePage.characterCount || project.titlePage.copyright && !!metadata.rights,
			...(project.cover ? { graphics: true } : {}),
			documentclass: "book", classoption: [page.double ? "twoside" : "oneside", "openany"], fontsize: "11pt", geometry: [
				`paperwidth=${page.width}mm`, `paperheight=${page.height}mm`, `top=${page.top}mm`, `bottom=${page.bottom}mm`,
				`${page.double ? "inner" : "left"}=${page.left}mm`, `${page.double ? "outer" : "right"}=${page.right}mm`, `bindingoffset=${page.binding}mm`,
			], "bookbinder-config": path.join(temporary, "presentation.json") }));
		await writeFile(path.join(temporary, "presentation.json"), JSON.stringify({ ...presentation, overrides: project.styles, pageBreak, ruleDefinitions }));
		const result = path.join(temporary, "book.pdf");
		const title = presentation.styles["h1.title"];
		const args = ["--to=latex", "--standalone", "--wrap=none", `--toc=${project.toc}`, `--toc-depth=${project.tocDepth}`, `--pdf-engine=${request.xelatex}`, "--pdf-engine-opt=-no-shell-escape",
			`--from=${path.join(temporary, "book-reader.lua")}`, `--lua-filter=${path.join(temporary, "pdf.lua")}`, `--template=${path.join(temporary, "book.latex")}`,
			`--metadata-file=${path.join(temporary, "metadata.json")}`, `--include-in-header=${path.join(temporary, "presentation.tex")}`,
			`--variable=bookbinder-title-before:${title.hidden ? "\\setbox0=\\vbox\\bgroup" : title.before}`, `--variable=bookbinder-title-after:${title.hidden ? "\\egroup" : title.after}`, `--output=${result}`];
		if (project.cover) {
			const cover = localResource(directory, project.cover); await access(cover);
			args.push(`--variable=bookbinder-cover:${texPath(cover)}`);
		}
		await runPandoc(request.pandoc, args, directory, JSON.stringify({ sources, pageBreak, ruleDefinitions: activeRuleDefinitions(project), separator: project.separator, disabledRules: project.disabledRules,
			characterCountLabel: project.titlePage.characterCount ? t("kCharacterCountValue", { count: "{count}" }, locale) : undefined, characterCountDivisor: 1000,
			colophon: metadata.colophon ?? "", colophonTitle: t("colophon", {}, locale), colophonCredit: t("generatedByBookbinderOn", { date: now.toLocaleDateString(locale) }, locale) }));
		return await saveGeneratedFile(result, output, request.confirmOverwrite);
	} finally { await rm(temporary, { recursive: true, force: true }); }
}
