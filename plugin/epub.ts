import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { prepareMarkdown, projectCss, localResource, isProjectNote, type BookProject } from "./project";
import type { CoverOptions } from "./cover";

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
}

function runPandoc(executable: string, args: string[], cwd: string, input: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(executable, args, { cwd, windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
		let errorText = "";
		let timedOut = false;
		const timer = setTimeout(() => { timedOut = true; child.kill(); }, 300_000);
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => { errorText = (errorText + chunk).slice(-65536); });
		child.on("error", error => { clearTimeout(timer); reject(error); });
		child.on("close", code => {
			clearTimeout(timer);
			if (timedOut) reject(new Error("Pandoc n’a pas terminé après cinq minutes."));
			else if (code !== 0) reject(new Error(errorText.trim() || `Pandoc s’est arrêté (code ${code}).`));
			else resolve();
		});
		child.stdin.on("error", error => {
			if ((error as NodeJS.ErrnoException).code !== "EPIPE") { child.kill(); reject(error); }
		});
		child.stdin.end(input);
	});
}

export async function exportEpub(request: EpubRequest): Promise<string> {
	const { project, directory, output, resources } = request;
	const manuscript = request.sources.filter(source => !isProjectNote(source.path.replace(/\\/g, "/")));
	if (!manuscript.length) throw new Error("Aucun fichier Markdown à exporter.");
	if (!path.isAbsolute(output) || path.extname(output).toLowerCase() !== ".epub") throw new Error("Le chemin de sortie doit désigner un EPUB.");
	const sources = manuscript.map(source => {
		let content = prepareMarkdown(source.content);
		content = content.replace(/!\[\[([^\]\n]+)\]\]/g, (_original, link: string) => {
			const [target, label] = link.split("|");
			if (!request.resolveImage) throw new Error(`Impossible de résoudre l’image ![[${target}]] dans ${source.path}.`);
			const imagePath = request.resolveImage(target, source.path).replace(/\\/g, "/").replace(/</g, "%3C").replace(/>/g, "%3E");
			return `![${(label ?? "").replace(/[\[\]]/g, "")}](<${imagePath}>)`;
		});
		return { directory: path.dirname(source.path), content: content + "\n\n" + project.fusion.noteSeparator };
	});
	const fonts = project.fonts.map(filename => localResource(directory, filename));
	const cssFiles = project.css.map(filename => localResource(directory, filename));
	const cover = project.cover ? localResource(directory, project.cover) : undefined;
	const background = !cover && project.background ? localResource(directory, project.background) : undefined;
	for (const filename of [...fonts, ...cssFiles, ...(cover ? [cover] : []), ...(background ? [background] : [])]) {
		try { await access(filename); } catch { throw new Error(`Ressource introuvable : ${filename}`); }
	}
	await mkdir(path.dirname(output), { recursive: true });
	// Staging beside the destination lets rename preserve the last successful export.
	const temporary = await mkdtemp(path.join(path.dirname(output), ".bookbinder-"));
	try {
		const args = ["--to=epub3", "--standalone", "--fail-if-warnings", `--toc-depth=${project.tocDepth}`, `--split-level=${project.splitLevel}`, "--wrap=none"];
		for (const name of ["book-reader.lua", "epub-thin-space.lua", "epub-tab.lua"]) {
			const key = `lua/${name}`;
			if (!resources[key]) throw new Error(`Ressource du plugin absente : ${key}`);
			const filename = path.join(temporary, name);
			await writeFile(filename, resources[key]);
			args.push(name === "book-reader.lua" ? `--from=${filename}` : `--lua-filter=${filename}`);
		}
		if (cssFiles.length) {
			args.push(...cssFiles.map(filename => `--css=${filename}`));
		} else {
			let css = resources["epub/base.css"];
			if (!css) throw new Error("La présentation EPUB du plugin est absente.");
			const embeddedNames = new Set(fonts.map(filename => path.basename(filename)));
			css = css.replace(/@font-face\s*\{[^}]*\}/g, face => {
				const filename = face.match(/fonts\/([^'"]+)/)?.[1];
				return filename && embeddedNames.has(filename) ? face : "";
			});
			await writeFile(path.join(temporary, "base.css"), css);
			args.push(`--css=${path.join(temporary, "base.css")}`);
		}
		await writeFile(path.join(temporary, "presentation.css"), projectCss(project));
		args.push(`--css=${path.join(temporary, "presentation.css")}`, ...fonts.map(filename => `--epub-embed-font=${filename}`));
		const now = new Date();
		let count = 0;
		for (const source of request.sources) for (const _character of source.content) count++;
		const metadata: Record<string, unknown> = { date: now.toISOString().slice(0, 10), ...project.metadata };
		const title = String(project.metadata.title);
		Object.assign(metadata, { title: title.replace(/\\n|\n/g, " ") });
		await writeFile(path.join(temporary, "metadata.json"), JSON.stringify(metadata));
		let coverFile = cover;
		if (!coverFile) {
			const extension = background ? path.extname(background).slice(1).toLowerCase() : "";
			const format = extension === "svg" ? "svg+xml" : extension === "jpg" ? "jpeg" : extension;
			const backgroundData = background ? `data:image/${format};base64,${(await readFile(background)).toString("base64")}` : undefined;
			const image = await request.renderCover({
				title, author: Array.isArray(metadata.author) ? metadata.author.join(", ") : String(metadata.author ?? ""),
				subtitle: String(metadata.subtitle ?? ""), background: backgroundData,
				footer: `${Math.floor(count / 1000)}k signes - ${now.toLocaleDateString("fr-FR")}`,
			});
			coverFile = path.join(temporary, "cover.jpg");
			await writeFile(coverFile, image);
		}
		const result = path.join(temporary, "book.epub");
		args.push(`--metadata-file=${path.join(temporary, "metadata.json")}`, `--epub-cover-image=${coverFile}`, `--output=${result}`);
		await runPandoc(request.pandoc, args, directory, JSON.stringify({ sources }));
		await rename(result, output);
		return output;
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}
