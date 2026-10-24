import { FileSystemAdapter, Notice, Plugin, TFile, TFolder, parseYaml } from "obsidian";
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

export default class BookbinderPlugin extends Plugin {
	readonly resources = resources;
	settings: BookbinderSettings = { ...DEFAULT_SETTINGS };
	private exporting = false;

	async onload(): Promise<void> {
		this.settings = parseSettings(await this.loadData());
		this.addSettingTab(new BookbinderSettingTab(this.app, this));
		this.registerView(EPUB_VIEW, leaf => new EpubView(leaf));
		try { this.registerExtensions(["epub"], EPUB_VIEW); }
		catch (error) { console.debug("Bookbinder : l’association des EPUB n’a pas été modifiée.", error); }
		for (const protocol of ["bookbinder", "book-print"]) this.registerObsidianProtocolHandler(protocol, async parameters => {
			try {
				const file = parameters.file === undefined ? this.app.workspace.getActiveFile() : this.app.vault.getAbstractFileByPath(parameters.file);
				if (!(file instanceof TFile) || !isProjectNote(file.path) || !file.parent) throw new Error("Ouvrez bookbinder.md pour modifier le projet.");
				const adapter = this.app.vault.adapter;
				if (!(adapter instanceof FileSystemAdapter)) throw new Error("Les projets nécessitent Obsidian sur ordinateur.");
				await openProjectEditor(this.app, adapter.getFullPath(file.parent.path), resources["epub/base.css"]);
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
		if (this.exporting) { new Notice("Un export Bookbinder est déjà en cours."); return; }
		this.exporting = true;
		const notice = new Notice("Préparation de l’ePub…", 0);
		try {
			const adapter = this.app.vault.adapter;
			if (!(adapter instanceof FileSystemAdapter)) throw new Error("La génération nécessite Obsidian sur ordinateur.");
			const folder = source instanceof TFolder ? source : source.parent;
			if (!folder) throw new Error("Le dossier du manuscrit est introuvable.");
			const directory = adapter.getFullPath(folder.path);
			const projectFile = await readProjectFile(directory);
			let config: unknown;
			try { config = projectFile === undefined ? undefined : parseYaml(projectFile.yaml); }
			catch (error) { throw new Error(`${projectFile?.name ?? "Projet"} invalide : ${error instanceof Error ? error.message : String(error)}`); }
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
			if (!files.length) throw new Error("Aucun fichier Markdown à exporter dans ce dossier.");
			const sources: BookSource[] = [];
			for (const file of files) {
				const content = await this.app.vault.read(file);
				sources.push({ path: adapter.getFullPath(file.path), content });
			}
			const pandoc = await detectTool("pandoc", this.settings.pandocPath);
			if (pandoc.state !== "found") throw new Error(`${pandoc.message} Ouvrez Réglages → Bookbinder.`);
			if (compareVersions(pandoc.version, "3.1.1") === -1) throw new Error("L’export EPUB nécessite Pandoc 3.1.1 ou plus récent. Ouvrez Réglages → Bookbinder pour le mettre à jour.");
			notice.setMessage("Génération de l’EPUB…");
			const output = path.join(this.settings.outputDirectory || directory, `${name}.epub`);
			await exportEpub({ project, sources, directory, output, pandoc: pandoc.path, resources, renderCover, resolveImage: (target, sourcePath) => {
				const vaultPath = path.relative(adapter.getBasePath(), sourcePath).split(path.sep).join("/");
				const destination = this.app.metadataCache.getFirstLinkpathDest(target, vaultPath);
				if (!destination) throw new Error(`Image introuvable dans ${vaultPath} : ${target}`);
				if (destination.extension.toLowerCase() === "md") throw new Error(`L’inclusion de note ![[${target}]] dans ${vaultPath} n’est pas encore prise en charge.`);
				return adapter.getFullPath(destination.path);
			} });
			new Notice(`EPUB créé : ${output}`, 10000);
		} catch (error) {
			new Notice(`Book to ePub : ${error instanceof Error ? error.message : String(error)}`, 15000);
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
		if (!(adapter instanceof FileSystemAdapter)) throw new Error("La génération nécessite Obsidian sur ordinateur.");
		return resolveOutputDirectory(adapter.getFullPath(source.path), this.settings.outputDirectory);
	}
}
