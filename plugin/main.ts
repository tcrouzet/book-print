import { setLocale, t } from "./i18n.ts";
import { FileSystemAdapter, Notice, Plugin, TFile, TFolder, getLanguage, parseYaml, requestUrl, stringifyYaml } from "obsidian";
import * as path from "node:path";
import { BookbinderSettingTab } from "./settings-tab";
import { DEFAULT_SETTINGS, parseSettings, type BookbinderSettings } from "./types";
import { resolveOutputDirectory } from "./output";
import { resources } from "../scripts/resources";
import { excluded, isProjectNote, parseProject } from "./project";
import { exportEpub, type BookSource } from "./epub";
import { exportPdf } from "./pdf.ts";
import { exportDocx } from "./docx.ts";
import { renderCover } from "./cover";
import { compareVersions, detectTool } from "./tools";
import { EPUB_VIEW, DOCX_VIEW, BookFileView } from "./book-file-view";
import { projectYaml, readProjectFile, saveProjectFile } from "./project-files";
import { linkProjectNote } from "./project-view";
import { openProjectEditor } from "./project-modal";
import { confirmOverwrite } from "./dialogs";
import { loadTranslationFiles } from "./locale-files.ts";
import { fontCatalog } from "./font-catalog.ts";
import { readModel } from "./project-models.ts";
import baseModel from "../models/base.md";
import { installFontPackage, needsFontPackage, readFontPackage } from "./font-package.ts";

export default class BookbinderPlugin extends Plugin {
	readonly resources = resources;
	settings: BookbinderSettings = { ...DEFAULT_SETTINGS };
	private exporting = false;

	private get pluginDirectory(): string {
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) throw new Error(t("projectsRequireObsidianOnDesktop"));
		return adapter.getFullPath(this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`);
	}
	get fontDirectory(): string { return path.join(this.pluginDirectory, "data", "_fonts"); }
	get modelDirectory(): string { return path.join(this.pluginDirectory, "models"); }
	get fontPackageFile(): string { return path.join(this.pluginDirectory, "fonts", fontCatalog.archive.file); }
	async defaultProjectData(model = this.settings.projectModel): Promise<Record<string, unknown>> {
		return await readModel(this.modelDirectory, model, parseYaml, baseModel);
	}

	async installFonts(): Promise<void> {
		const data = await readFontPackage(this.fontPackageFile, async () => {
			const response = await requestUrl({ url: fontCatalog.archive.url, throw: false });
			if (response.status !== 200) throw new Error(t("fontPackageDownloadFailed", { status: response.status }));
			return response.arrayBuffer;
		});
		await installFontPackage(this.fontDirectory, data);
	}

	async onload(): Promise<void> {
		setLocale(getLanguage());
		for (const error of await loadTranslationFiles(path.join(this.pluginDirectory, "locales"))) new Notice(error);
		this.settings = parseSettings(await this.loadData());
		this.addSettingTab(new BookbinderSettingTab(this.app, this));
		for (const format of ["epub", "docx"] as const) {
			const view = format === "docx" ? DOCX_VIEW : EPUB_VIEW;
			this.registerView(view, leaf => new BookFileView(leaf, format));
			try { this.registerExtensions([format], view); }
			catch (error) { console.debug(t(format === "docx" ? "bookbinderTheDocxAssociationWasLeftUnchanged" : "bookbinderTheEpubAssociationWasLeftUnchanged"), error); }
		}
		this.registerObsidianProtocolHandler("bookbinder", async parameters => {
			try {
				const file = parameters.file === undefined ? this.app.workspace.getActiveFile() : this.app.vault.getAbstractFileByPath(parameters.file);
				if (!(file instanceof TFile) || !isProjectNote(file.path) || !file.parent) throw new Error(t("openBookbinderMdToEditTheProject"));
				const adapter = this.app.vault.adapter;
				if (!(adapter instanceof FileSystemAdapter)) throw new Error(t("projectsRequireObsidianOnDesktop"));
				await openProjectEditor(this.app, adapter.getFullPath(file.parent.path), resources["epub/base.css"], this.fontDirectory);
			} catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
		});
		this.registerMarkdownPostProcessor((element, context) => linkProjectNote(element, context.sourcePath, this.app.vault.getName()));
		for (const format of ["pdf", "docx", "epub"] as const) this.addCommand({
			id: `book-to-${format}`,
			name: format === "pdf" ? "Book to PDF" : format === "docx" ? "Book to Docx" : "Book to ePub",
			checkCallback: checking => {
				const file = this.app.workspace.getActiveFile();
				if (!(file instanceof TFile) || file.extension.toLowerCase() !== "md" || isProjectNote(file.path)) return false;
				if (!checking) void this.generateBook(file, format);
				return true;
			},
		});
		this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
			if (!(file instanceof TFolder) && !(file instanceof TFile && file.extension.toLowerCase() === "md")) return;
			if (file instanceof TFile && isProjectNote(file.path)) return;
			for (const format of ["pdf", "docx", "epub"] as const) menu.addItem(item => item.setTitle(format === "pdf" ? "Book to PDF" : format === "docx" ? "Book to Docx" : "Book to ePub").setIcon("book-open").onClick(() => {
				void this.generateBook(file, format);
			}));
		}));
	}

	async generateBook(source: TFile | TFolder, format: "epub" | "pdf" | "docx"): Promise<void> {
		if (this.exporting) { new Notice(t("aBookbinderExportIsAlreadyRunning")); return; }
		this.exporting = true;
		const notice = new Notice(t(format === "pdf" ? "preparingPdf" : format === "docx" ? "preparingDocx" : "preparingEpub"), 0);
		notice.messageEl.classList.add("bookbinder-export-progress");
		notice.messageEl.setAttribute("role", "status");
		try {
			const adapter = this.app.vault.adapter;
			if (!(adapter instanceof FileSystemAdapter)) throw new Error(t("exportRequiresObsidianOnDesktop"));
			const folder = source instanceof TFolder ? source : source.parent;
			if (!folder) throw new Error(t("theManuscriptFolderCouldNotBeFound"));
			const directory = adapter.getFullPath(folder.path);
			const name = source instanceof TFile ? source.basename : source.isRoot() ? this.app.vault.getName() : source.name;
			const projectFile = await readProjectFile(directory);
			let config: unknown;
			try { config = projectFile === undefined ? await this.defaultProjectData() : parseYaml(projectFile.yaml); }
			catch (error) { throw new Error(t("invalidFileError", { file: projectFile?.name ?? (this.settings.projectModel || "bookbinder.md"), error: error instanceof Error ? error.message : String(error) })); }
			const project = parseProject(config, name, format);
			if (projectFile === undefined) await saveProjectFile(directory, projectYaml({ ...config as Record<string, unknown>, title: project.metadata.title }, stringifyYaml), undefined);
			const files: TFile[] = [];
			const collect = (entry: TFile | TFolder): void => {
				if (entry !== source && excluded(folder.isRoot() ? entry.path : entry.path.slice(folder.path.length + 1), project.fusion)) return;
				if (entry instanceof TFile) { if (entry.extension.toLowerCase() === "md" && !isProjectNote(entry.path)) files.push(entry); }
				else for (const child of entry.children) if (child instanceof TFile || child instanceof TFolder) collect(child);
			};
			collect(source);
			files.sort((left, right) => left.path.localeCompare(right.path));
			if (!files.length) throw new Error(t("noMarkdownFilesToExportInThisFolder"));
			const sources: BookSource[] = [];
			for (const file of files) {
				const content = await this.app.vault.read(file);
				sources.push({ path: adapter.getFullPath(file.path), content });
			}
			const pandoc = await detectTool("pandoc", this.settings.pandocPath);
			if (pandoc.state !== "found") throw new Error(t("errorOpenSettingsBookbinder", { error: pandoc.message }));
			if (compareVersions(pandoc.version, "3.1.1") === -1) throw new Error(t("pandocVersionRequired"));
			let xelatex = "";
			if (format === "pdf") {
				const latex = await detectTool("xelatex", this.settings.latexPath);
				if (latex.state !== "found") throw new Error(t("errorOpenSettingsBookbinder", { error: latex.message }));
				xelatex = latex.path;
			}
			if (await needsFontPackage(project, this.fontDirectory)) {
				notice.setMessage(t("installingFontPackage"));
				await this.installFonts();
			}
			notice.setMessage(t(format === "pdf" ? "generatingPdf" : format === "docx" ? "generatingDocx" : "generatingEpub"));
			const output = path.join(this.settings.outputDirectory || directory, `${project.filename}.${format}`);
			const request = { project, sources, directory, output, pandoc: pandoc.path, resources, renderCover, confirmOverwrite, fontDirectory: this.fontDirectory, resolveImage: (target: string, sourcePath: string) => {
				const vaultPath = path.relative(adapter.getBasePath(), sourcePath).split(path.sep).join("/");
				const destination = this.app.metadataCache.getFirstLinkpathDest(target, vaultPath);
				if (!destination) throw new Error(t("imageNotFoundInSourceTarget", { source: vaultPath, target: target }));
				if (destination.extension.toLowerCase() === "md") throw new Error(t("embeddingNoteTargetInSourceIsNotSupportedYet", { target: target, source: vaultPath }));
				return adapter.getFullPath(destination.path);
			} };
			const generated = format === "pdf" ? await exportPdf({ ...request, xelatex }) : format === "docx" ? await exportDocx(request) : await exportEpub(request);
			if (generated) new Notice(t(format === "pdf" ? "pdfCreatedFilename" : format === "docx" ? "docxCreatedFilename" : "epubCreatedFilename", { filename: generated }), 10000);
		} catch (error) {
			new Notice(t(format === "pdf" ? "bookToPdfError" : format === "docx" ? "bookToDocxError" : "bookToEpubError", { error: error instanceof Error ? error.message : String(error) }), 15000);
		} finally {
			notice.hide();
			this.exporting = false;
		}
	}

	async saveSettings(settings: BookbinderSettings): Promise<void> {
		const next = parseSettings(settings);
		await this.saveData(next);
		this.settings = next;
	}

	getOutputDirectory(source: TFile): string {
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) throw new Error(t("exportRequiresObsidianOnDesktop"));
		return resolveOutputDirectory(adapter.getFullPath(source.path), this.settings.outputDirectory);
	}
}
