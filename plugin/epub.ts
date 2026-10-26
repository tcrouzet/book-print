import { resolveLocale, t } from "./i18n.ts";
import * as timers from "node:timers";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { prepareMarkdown, projectCss, localResource, isProjectNote, noteSeparators, type BookProject } from "./project";
import type { CoverOptions } from "./cover";
import { saveGeneratedFile, type ExistingOutputChoice } from "./output";
import { readFontLibrary, resolveFont } from "./font-library.ts";
import { resolveFontFamilies } from "./presentation.ts";
import { activeRuleDefinitions } from "./book-styles.ts";

export interface BookSource { path: string; content: string }

export interface EpubRequest {
	project: BookProject;
	sources: BookSource[];
	directory: string;
	output: string;
	pandoc: string;
	resources: Readonly<Record<string, string>>;
	renderCover: (options: CoverOptions) => Promise<Uint8Array>;
	resolveImage?: (target: string, sourcePath: string) => string;
	confirmOverwrite?: (filename: string) => Promise<ExistingOutputChoice>;
	fontDirectory?: string;
}

export function runPandoc(executable: string, args: string[], cwd: string, input: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(executable, args, { cwd, windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
		let errorText = "";
		let timedOut = false;
		const timer = timers.setTimeout(() => { timedOut = true; child.kill(); }, 300_000);
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => { errorText = (errorText + chunk).slice(-65536); });
		child.on("error", error => { timers.clearTimeout(timer); reject(error); });
		child.on("close", code => {
			timers.clearTimeout(timer);
			if (timedOut) reject(new Error(t("pandocDidNotFinishWithinFiveMinutes")));
			else if (code !== 0) reject(new Error(errorText.trim() || t("pandocStoppedCodeCode", { code: String(code) })));
			else resolve();
		});
		child.stdin.on("error", error => {
			if ((error as NodeJS.ErrnoException).code !== "EPIPE") { child.kill(); reject(error); }
		});
		child.stdin.end(input);
	});
}

export function prepareBookSources(request: Pick<EpubRequest, "sources" | "project" | "resolveImage">): { sources: { directory: string; content: string }[]; pageBreak?: string } {
	const { project } = request;
	const manuscript = request.sources.filter(source => !isProjectNote(source.path.replace(/\\/g, "/")));
	if (!manuscript.length) throw new Error(t("noMarkdownFilesToExport"));
	const pageBreak = noteSeparators.get(project.fusion.noteSeparator)?.pageBreak || undefined;
	const customSeparator = pageBreak ? "" : project.fusion.noteSeparator;
	const sources = manuscript.map((source, index) => {
		let content = prepareMarkdown(source.content);
		content = content.replace(/!\[\[([^\]\n]+)\]\]/g, (_original, link: string) => {
			const [target, label] = link.split("|");
			if (!request.resolveImage) throw new Error(t("couldNotResolveImageTargetInSource", { target: target, source: source.path }));
			const imagePath = request.resolveImage(target, source.path).replace(/\\/g, "/").replace(/</g, "%3C").replace(/>/g, "%3E");
			return `![${(label ?? "").replace(/[[\]]/g, "")}](<${imagePath}>)`;
		});
		return { directory: path.dirname(source.path), content: content + "\n\n" + (index < manuscript.length - 1 ? customSeparator : "") };
	});
	return { sources, pageBreak };
}

export async function exportEpub(request: EpubRequest): Promise<string | undefined> {
	const { directory, output, resources } = request;
	const library = request.fontDirectory ? await readFontLibrary(request.fontDirectory) : [];
	const faces = new Map(library.map(font => [font.reference, font.face]));
	const lookup = (reference: string) => faces.get(reference);
	const project = structuredClone(request.project);
	resolveFontFamilies(project, library.map(font => font.reference), lookup);
	const { sources, pageBreak } = prepareBookSources({ ...request, project });
	if (!path.isAbsolute(output) || path.extname(output).toLowerCase() !== ".epub") throw new Error(t("theOutputPathMustNameAnEpubFile"));
	const fonts = project.fonts.map(filename => resolveFont(directory, filename, request.fontDirectory));
	const cssFiles = project.css.map(filename => localResource(directory, filename));
	const cover = project.cover ? localResource(directory, project.cover) : undefined;
	const background = !cover && project.background ? localResource(directory, project.background) : undefined;
	for (const filename of [...fonts, ...cssFiles, ...(cover ? [cover] : []), ...(background ? [background] : [])]) {
		try { await access(filename); } catch { throw new Error(t("resourceNotFoundFilename", { filename: filename })); }
	}
	await mkdir(path.dirname(output), { recursive: true });
	// Staging beside the destination keeps replacement on the same filesystem.
	const temporary = await mkdtemp(path.join(path.dirname(output), ".bookbinder-"));
	try {
		const args = ["--to=epub3", "--standalone", "--fail-if-warnings", `--toc-depth=${project.tocDepth}`, `--split-level=${project.splitLevel}`, "--wrap=none"];
		if (project.toc) args.push("--toc");
		for (const name of ["book-reader.lua", "epub-tab.lua", "epub-thin-space.lua"]) {
			const key = `lua/${name}`;
			if (!resources[key]) throw new Error(t("missingPluginResourceFilename", { filename: key }));
			const filename = path.join(temporary, name);
			await writeFile(filename, resources[key]);
			args.push(name === "book-reader.lua" ? `--from=${filename}` : `--lua-filter=${filename}`);
		}
		if (cssFiles.length) {
			args.push(...cssFiles.map(filename => `--css=${filename}`));
		} else {
			const css = resources["epub/base.css"];
			if (!css) throw new Error(t("thePluginSEpubPresentationIsMissing"));
			await writeFile(path.join(temporary, "base.css"), css);
			args.push(`--css=${path.join(temporary, "base.css")}`);
		}
		const separatorCss = pageBreak ? `\nbody .bookbinder-note-start{page-break-before:${pageBreak};break-before:${pageBreak === "always" ? "page" : pageBreak}}` : "";
		await writeFile(path.join(temporary, "presentation.css"), projectCss(project, lookup) + separatorCss);
		args.push(`--css=${path.join(temporary, "presentation.css")}`, ...fonts.map(filename => `--epub-embed-font=${filename}`));
		const now = new Date();
		let count = 0;
		for (const source of request.sources) count += Array.from(source.content).length;
		const metadata: Record<string, unknown> = { date: now.toISOString().slice(0, 10), ...project.metadata };
		const bookLocale = resolveLocale(typeof metadata.lang === "string" ? metadata.lang : "fr");
		const title = String(project.metadata.title);
		Object.assign(metadata, { title: title.replace(/\\n|\n/g, " ") });
		await writeFile(path.join(temporary, "metadata.json"), JSON.stringify(metadata));
		let coverFile = cover;
		if (!coverFile) {
			const extension = background ? path.extname(background).slice(1).toLowerCase() : "";
			const format = extension === "svg" ? "svg+xml" : extension === "jpg" ? "jpeg" : extension;
			const backgroundData = background ? `data:image/${format};base64,${(await readFile(background)).toString("base64")}` : undefined;
			const image = await request.renderCover({
				title, author: Array.isArray(metadata.author) ? metadata.author.join(", ") : typeof metadata.author === "string" ? metadata.author : "",
				subtitle: typeof metadata.subtitle === "string" ? metadata.subtitle : "", background: backgroundData,
				footer: t("countKCharactersDate", { count: Math.floor(count / 1000), date: now.toLocaleDateString(bookLocale) }, bookLocale),
			});
			coverFile = path.join(temporary, "cover.jpg");
			await writeFile(coverFile, image);
		}
		const result = path.join(temporary, "book.epub");
		args.push(`--metadata-file=${path.join(temporary, "metadata.json")}`, `--epub-cover-image=${coverFile}`, `--output=${result}`);
		await runPandoc(request.pandoc, args, directory, JSON.stringify({ sources, pageBreak, ruleDefinitions: activeRuleDefinitions(project), disabledRules: project.disabledRules, separator: project.separator,
			colophon: metadata.colophon ?? "", colophonTitle: t("colophon", {}, bookLocale), colophonCredit: t("generatedByBookbinderOn", { date: now.toLocaleDateString(bookLocale) }, bookLocale) }));
		return await saveGeneratedFile(result, output, request.confirmOverwrite);
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}
