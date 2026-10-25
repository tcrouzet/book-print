import { setLocale, t } from "./i18n.ts";
import { FileSystemAdapter, Notice, Plugin, TFile, TFolder, getLanguage, parseYaml } from "obsidian";
import * as path from "node:path";
import { BookbinderSettingTab } from "./settings-tab";
import { DEFAULT_SETTINGS, parseSettings, type BookbinderSettings } from "./types";
import { resolveOutputDirectory } from "./output";
import { resources } from "../scripts/resources";
import { excluded, isProjectNote, parseProject } from "./project";
import { exportEpub, type BookSource } from "./epub";
import { renderCover } from "./cover";
import { compareVersions, detectTool } from "./tools";
import { EPUB_VIEW, EpubView } from "./epub-view";
import { readProjectFile } from "./project-files";
import { linkProjectNote } from "./project-view";
import { openProjectEditor } from "./project-modal";
import { confirmOverwrite } from "./dialogs";
import { loadTranslationFiles } from "./locale-files.ts";
import { fontCatalog } from "./font-catalog.ts";

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
	get fontPackageFile(): string { return path.join(this.pluginDirectory, "fonts", fontCatalog.archive.file); }

	async onload(): Promise<void> {
		setLocale(getLanguage());
		for (const error of await loadTranslationFiles(path.join(this.pluginDirectory, "locales"))) new Notice(error);
		this.settings = parseSettings(await this.loadData());
		this.addSettingTab(new BookbinderSettingTab(this.app, this));
		this.registerView(EPUB_VIEW, leaf => new EpubView(leaf));
		try { this.registerExtensions(["epub"], EPUB_VIEW); }
		catch (error) { console.debug(t("bookbinderTheEpubAssociationWasLeftUnchanged"), error); }
		for (const protocol of ["bookbinder", "book-print"]) this.registerObsidianProtocolHandler(protocol, async parameters => {
			try {
				const file = parameters.file === undefined ? this.app.workspace.getActiveFile() : this.app.vault.getAbstractFileByPath(parameters.file);
				if (!(file instanceof TFile) || !isProjectNote(file.path) || !file.parent) throw new Error(t("openBookbinderMdToEditTheProject"));
				const adapter = this.app.vault.adapter;
				if (!(adapter instanceof FileSystemAdapter)) throw new Error(t("projectsRequireObsidianOnDesktop"));
				await openProjectEditor(this.app, adapter.getFullPath(file.parent.path), resources["epub/base.css"], this.fontDirectory);
			} catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
		});
		this.registerMarkdownPostProcessor((element, context) => linkProjectNote(element, context.sourcePath, this.app.vault.getName()));
		this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
			if (!(file instanceof TFolder) && !(file instanceof TFile && file.extension.toLowerCase() === "md")) return;
			if (file instanceof TFile && isProjectNote(file.path)) return;
			menu.addItem(item => item.setTitle("Book to ePub").setIcon("book-open").onClick(() => {
				void this.generateEpub(file);
			}));
		}));
	}

	async generateEpub(source: TFile | TFolder): Promise<void> {
		if (this.exporting) { new Notice(t("aBookbinderExportIsAlreadyRunning")); return; }
		this.exporting = true;
		const notice = new Notice(t("preparingEpub"), 0);
		try {
			const adapter = this.app.vault.adapter;
			if (!(adapter instanceof FileSystemAdapter)) throw new Error(t("exportRequiresObsidianOnDesktop"));
			const folder = source instanceof TFolder ? source : source.parent;
			if (!folder) throw new Error(t("theManuscriptFolderCouldNotBeFound"));
			const directory = adapter.getFullPath(folder.path);
			const projectFile = await readProjectFile(directory);
			let config: unknown;
			try { config = projectFile === undefined ? undefined : parseYaml(projectFile.yaml); }
			catch (error) { throw new Error(t("invalidFileError", { file: projectFile?.name ?? "Projet", error: error instanceof Error ? error.message : String(error) })); }
			const name = source instanceof TFile ? source.basename : source.isRoot() ? this.app.vault.getName() : source.name;
			const project = parseProject(config, name);
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
			notice.setMessage(t("generatingEpub"));
			const output = path.join(this.settings.outputDirectory || directory, `${project.filename}.epub`);
			const generated = await exportEpub({ project, sources, directory, output, pandoc: pandoc.path, resources, renderCover, confirmOverwrite, fontDirectory: this.fontDirectory, resolveImage: (target, sourcePath) => {
				const vaultPath = path.relative(adapter.getBasePath(), sourcePath).split(path.sep).join("/");
				const destination = this.app.metadataCache.getFirstLinkpathDest(target, vaultPath);
				if (!destination) throw new Error(t("imageNotFoundInSourceTarget", { source: vaultPath, target: target }));
				if (destination.extension.toLowerCase() === "md") throw new Error(t("embeddingNoteTargetInSourceIsNotSupportedYet", { target: target, source: vaultPath }));
				return adapter.getFullPath(destination.path);
			} });
			if (generated) new Notice(t("epubCreatedFilename", { filename: generated }), 10000);
		} catch (error) {
			new Notice(t("bookToEpubError", { error: error instanceof Error ? error.message : String(error) }), 15000);
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
