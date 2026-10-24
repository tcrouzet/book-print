import { App, ButtonComponent, Modal, Notice, Setting, parseYaml, setIcon, stringifyYaml } from "obsidian";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { localResource, parseProject, type BookProject } from "./project";
import { loadFont, readProjectFile, saveProjectFile, type ImportedFont, type ProjectFile } from "./project-files";
import { StyleEditor } from "./style-editor";
import { mountProjectTabs } from "./project-tabs";

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? { ...value as Record<string, unknown> } : {};
}

async function chooseFiles(title: string, extensions: string[], multiple = false): Promise<string[]> {
	const { remote } = require("electron") as { remote: { dialog: { showOpenDialog(options: {
		title: string; properties: string[]; filters: { name: string; extensions: string[] }[];
	}): Promise<{ canceled: boolean; filePaths: string[] }> } } };
	const result = await remote.dialog.showOpenDialog({ title, properties: multiple ? ["openFile", "multiSelections"] : ["openFile"], filters: [{ name: title, extensions }] });
	return result.canceled ? [] : result.filePaths;
}

export async function openProjectEditor(app: App, directory: string, baseCss: string): Promise<void> {
	const original = await readProjectFile(directory);
	const data: unknown = original === undefined ? {} : parseYaml(original.yaml);
	const project = parseProject(data, path.basename(directory));
	new ProjectModal(app, directory, baseCss, original, record(data), project).open();
}

class ProjectModal extends Modal {
	private editor?: StyleEditor;
	private ruleEditor?: StyleEditor;
	private editors = new Map<string, StyleEditor>();
	private get styleEditors(): StyleEditor[] { return [...this.editors.values(), ...(this.ruleEditor ? [this.ruleEditor] : [])]; }
	private projects: Record<"pdf" | "docx" | "epub", BookProject>;
	private nestedTabs: { panels: HTMLElement[]; select: (index: number) => void }[] = [];
	private error!: HTMLElement;
	private pendingFonts = new Map<string, ImportedFont>();
	private dirty = false;
	private discard = false;
	private saving = false;
	private pendingActions = 0;
	private closed = false;
	private cancelButton?: ButtonComponent;
	private saveButton?: ButtonComponent;
	private panels: HTMLElement[] = [];
	private selectPanel: (index: number) => void = () => {};

	constructor(app: App, private directory: string, private baseCss: string, private original: ProjectFile | undefined,
		private data: Record<string, unknown>, private project: BookProject) {
		super(app);
		this.projects = {
			pdf: parseProject({ epub: data.pdf }, path.basename(directory)),
			docx: parseProject({ epub: data.docx }, path.basename(directory)),
			epub: project,
		};
		for (const format of Object.values(this.projects)) format.fonts = project.fonts;
		this.data.title ??= project.metadata.title;
		this.data.lang ??= project.metadata.lang;
	}

	onOpen(): void {
		this.modalEl.addClass("bookbinder-project-modal");
		this.setTitle(this.original === undefined ? "Créer un projet de livre" : "Modifier le projet de livre");
		this.contentEl.createDiv({ text: this.directory, cls: "bookbinder-project-path" });
		const navigation = this.contentEl.createDiv({ cls: "bookbinder-project-tabs", attr: { role: "tablist", "aria-label": "Configuration du projet" } });
		const layout = this.contentEl.createDiv({ cls: "bookbinder-project-layout" });
		const information = layout.createDiv({ cls: "bookbinder-project-information" });
		const formats = ["pdf", "docx", "epub"] as const;
		const formatPanels = formats.map(() => layout.createDiv({ cls: "bookbinder-project-format" }));
		this.panels = [information, ...formatPanels];
		this.selectPanel = mountProjectTabs(navigation, this.panels, ["Généralités", "PDF", "DOCX", "ePub"], () => {
			layout.scrollTop = 0;
			for (const editor of this.styleEditors) editor.refresh();
		});
		information.createEl("h3", { text: "Généralités" });
		this.metadata(information, "title", "Titre", true, true);
		this.metadata(information, "subtitle", "Sous-titre", true);
		this.metadata(information, "author", "Auteur ou autrice", true);
		this.metadata(information, "lang", "Langue", false, true);
		const publication = information.createEl("details");
		publication.createEl("summary", { text: "Publication" });
		for (const [key, label] of [
			["description", "Description"], ["subject", "Sujets"], ["rights", "Droits"], ["identifier", "Identifiant du livre"],
			["publisher", "Éditeur"], ["author-url", "Site de l’auteur"], ["publisher-url", "Site de l’éditeur"],
			["isbn", "ISBN papier"], ["isbn-ebook", "ISBN numérique"], ["date", "Date de publication"],
		]) this.metadata(publication, key, label, key === "description");
		const cover = information.createEl("details");
		cover.createEl("summary", { text: "Couverture" });
		this.image(cover, "cover", "Couverture", "Automatique");
		this.image(cover, "cover-background", "Image de fond", "Sans image de fond");
		const fonts = information.createDiv({ cls: "bookbinder-fonts" });
		fonts.createEl("h3", { text: "Polices" });
		const fontList = fonts.createDiv({ cls: "bookbinder-font-list" });
		let fontBusy = true;
		const showFonts = () => {
			fontList.empty();
			if (!this.project.fonts.length) fontList.createDiv({ text: "Polices par défaut (Auto)", cls: "bookbinder-muted" });
			for (const filename of this.project.fonts) {
				const row = fontList.createDiv({ cls: "bookbinder-font-row" });
				row.createSpan({ text: filename.split(/[/\\]/).pop() });
				new ButtonComponent(row).setButtonText("Retirer").setDisabled(fontBusy).setTooltip("Retirer du projet sans supprimer le fichier").onClick(() => {
					for (const editor of this.styleEditors) editor.removeFont(filename);
					this.pendingFonts.delete(path.basename(filename)); showFonts(); importButton.buttonEl.focus();
				});
			}
		};
		showFonts();
		const importButton = new ButtonComponent(fonts).setButtonText("Importer des polices…").setDisabled(true);
		const setFontBusy = (busy: boolean) => {
			fontBusy = busy;
			if (this.closed) return;
			importButton.setDisabled(busy).setButtonText(busy ? "Chargement des polices…" : "Importer des polices…"); showFonts();
		};
		importButton.onClick(() => this.action(async () => {
			setFontBusy(true);
			try {
				const filenames = await chooseFiles("Choisir les polices", ["otf", "ttf", "woff", "woff2"], true);
				const loaded = await Promise.all(filenames.map(loadFont));
				for (const font of loaded) {
					const existing = this.pendingFonts.get(font.name);
					if (existing && !Buffer.from(existing.data).equals(Buffer.from(font.data))) throw new Error(`Deux polices différentes portent le nom ${font.name}. Renommez-en une.`);
					const relative = `fonts/${font.name}`;
					if (this.project.fonts.some(filename => path.basename(filename) === font.name && filename !== relative)) throw new Error(`La police ${font.name} est déjà dans le projet. Vous pouvez la choisir dans la barre de mise en forme.`);
					for (const editor of this.styleEditors) await editor.addFont(relative, font.data);
					if (this.closed) return;
					this.pendingFonts.set(font.name, font);
					if (!this.project.fonts.includes(relative)) this.project.fonts.push(relative);
					for (const editor of this.styleEditors) editor.presentation.fonts = this.project.fonts;
					this.markDirty();
					showFonts();
				}
			} finally { setFontBusy(false); }
		}));
		fonts.createEl("p", { text: "Les polices importées seront enregistrées dans le dossier fonts du projet et proposées dans la barre de mise en forme.", cls: "bookbinder-muted" });
		const epub = formatPanels[2].createEl("details");
		epub.createEl("summary", { text: "Sommaire et fichiers de style" });
		for (const [key, label] of [["tocDepth", "Profondeur du sommaire"], ["splitLevel", "Niveau de découpage"]] as const) {
			new Setting(epub).setName(label).addDropdown(input => {
				for (let level = 1; level <= 6; level++) input.addOption(String(level), String(level));
				const name = key === "tocDepth" ? "toc-depth" : "split-level";
				const explicit = record(this.data.epub)[name] ?? (key === "tocDepth" ? this.data.toc_level : undefined);
				input.addOption("", "Auto").setValue(explicit === undefined ? "" : String(this.project[key])).onChange(value => {
					this.project[key] = value ? Number(value) : 2;
					const data = record(this.data.epub);
					if (value) data[name] = Number(value);
					else { delete data[name]; if (key === "tocDepth") delete this.data.toc_level; }
					this.data.epub = data; this.markDirty();
				});
				input.selectEl.setAttribute("aria-label", label);
			});
		}
		const css = new Setting(epub).setName("Feuille de style existante").setDesc(this.project.css.join(", ") || "Présentation intégrée");
		css.addButton(button => button.setButtonText("Parcourir…").onClick(() => this.action(async () => {
			const filenames = await chooseFiles("Choisir les feuilles de style", ["css"], true);
			if (!filenames.length) return;
			const contents = await Promise.all(filenames.map(filename => readFile(filename, "utf8")));
			this.project.css = filenames.map(filename => this.relative(filename));
			this.editor!.setBaseCss(contents.join("\n")); this.ruleEditor?.setBaseCss(contents.join("\n"));
			css.setDesc(this.project.css.join(", ")); this.markDirty();
		})));
		css.addButton(button => button.setButtonText("Réinitialiser").onClick(() => {
			this.project.css = []; css.setDesc("Présentation intégrée"); this.editor!.setBaseCss(this.baseCss); this.ruleEditor?.setBaseCss(this.baseCss); this.markDirty();
		}));
		const fusion = information.createEl("details");
		fusion.createEl("summary", { text: "Assemblage des fichiers" });
		for (const [key, label] of [["excludeCharacters", "Caractères à exclure des noms"], ["excludeNames", "Noms à exclure, séparés par des virgules"], ["noteSeparator", "Séparateur entre les notes"]] as const) {
			new Setting(fusion).setName(label).addText(input => {
				input.setValue(this.project.fusion[key]).onChange(value => { this.project.fusion[key] = value; this.markDirty(); });
				input.inputEl.setAttribute("aria-label", label);
			});
		}
		for (const [index, format] of formats.entries()) {
			const panel = formatPanels[index];
			const tabs = panel.createDiv({ cls: "bookbinder-project-tabs", attr: { "aria-label": "Réglages " + format.toUpperCase() } });
			panel.prepend(tabs);
			const page = panel.createDiv({ cls: "bookbinder-project-page" });
			const presentation = panel.createDiv({ cls: "bookbinder-project-presentation" });
			page.createEl("h3", { text: "Page" });
			page.createEl("p", { text: format === "epub"
				? "Le format d’un EPUB s’adapte à l’écran de la liseuse. Les marges sont exprimées en em. Auto conserve les valeurs du modèle."
				: "Auto conserve les marges du modèle ; les valeurs saisies ici sont exprimées en millimètres.", cls: "bookbinder-muted" });
			const pageFields = page.createDiv({ cls: "bookbinder-page-fields" });
			presentation.createEl("h3", { text: "Styles" });
			const editor = new StyleEditor(presentation, this.projects[format], this.baseCss, () => this.markDirty(), () => this.close(), { format, setIcon });
			this.editors.set(format, editor);
			void editor.mountPage(pageFields);
			const panels = [page, presentation];
			const labels = ["Page", "Styles"];
			if (format === "epub") {
				const rules = panel.createDiv({ cls: "bookbinder-project-presentation" });
				rules.createEl("h3", { text: "Règles" });
				rules.createEl("p", { text: "Premiers paragraphes après un titre et lettrine du modèle après un titre 2.", cls: "bookbinder-muted" });
				this.ruleEditor = new StyleEditor(rules, this.project, this.baseCss, () => this.markDirty(), () => this.close(), { format, setIcon, rules: true });
				panels.push(rules); labels.push("Règles");
			}
			const select = mountProjectTabs(tabs, panels, labels, () => { editor.refresh(); if (format === "epub") this.ruleEditor?.refresh(); });
			this.nestedTabs.push({ panels, select });
		}
		this.editor = this.editors.get("epub");
		this.error = this.contentEl.createDiv({ cls: "bookbinder-project-error", attr: { role: "alert", "aria-live": "polite" } });
		const footer = this.contentEl.createDiv({ cls: "bookbinder-project-actions" });
		this.cancelButton = new ButtonComponent(footer).setButtonText("Annuler").onClick(() => this.close());
		this.saveButton = new ButtonComponent(footer).setButtonText("Enregistrer le projet").setCta().onClick(() => this.action(() => this.save()));
		void this.action(async () => {
			setFontBusy(true);
			try {
				await Promise.all(this.styleEditors.map(editor => editor.ready));
				if (this.closed) return;
				if (this.project.css.length) {
					const css = (await Promise.all(this.project.css.map(filename => readFile(localResource(this.directory, filename), "utf8")))).join("\n");
					this.editor!.setBaseCss(css); this.ruleEditor?.setBaseCss(css);
				}
				for (const filename of this.project.fonts) {
					const font = await loadFont(localResource(this.directory, filename));
					for (const editor of this.styleEditors) await editor.addFont(filename, font.data);
				}
			} finally { setFontBusy(false); }
		});
		this.contentEl.querySelector<HTMLTextAreaElement>("textarea")?.focus();
	}

	private metadata(container: HTMLElement, key: string, label: string, multiline = false, required = false): void {
		const value = this.project.metadata[key];
		const text = Array.isArray(value) ? value.join(key === "author" ? "\n" : ", ") : value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "");
		const setting = new Setting(container).setName(label);
		if (key === "lang") {
			const current = text || "fr";
			this.data.lang = current;
			const codes = ["fr", "en", "es", "de", "it", "pt", "nl", "sv", "da", "no", "fi", "pl", "cs", "ru", "uk", "el", "tr", "ar", "he", "zh", "ja", "ko"];
			if (!codes.includes(current)) codes.push(current);
			const names = new Intl.DisplayNames(["fr"], { type: "language" });
			const name = (code: string) => { try { return names.of(code) || code; } catch { return code; } };
			setting.addDropdown(input => {
				for (const code of codes.sort((left, right) => name(left).localeCompare(name(right), "fr"))) input.addOption(code, name(code));
				input.setValue(current).onChange(value => { this.data.lang = value; this.markDirty(); });
				input.selectEl.setAttribute("aria-label", label);
			});
			return;
		}
		const configure = (input: HTMLInputElement | HTMLTextAreaElement) => {
			if (key === "date" && input instanceof HTMLInputElement) input.type = "date";
			input.value = key === "title" ? text.replace(/\\n/g, "\n") : text;
			if (key === "date" && /^\d{4}-\d{2}-\d{2}/.test(text)) input.value = text.slice(0, 10);
			input.required = required;
			input.setAttribute("aria-label", label);
			if (input instanceof HTMLTextAreaElement) input.rows = key === "description" ? 4 : 2;
			input.addEventListener("input", () => {
				let value: string | string[] = input.value;
				if (key === "author") { const names = value.split("\n").map(name => name.trim()).filter(Boolean); value = names.length > 1 ? names : names[0] ?? ""; }
				if (key === "subject") value = input.value.split(",").map(item => item.trim()).filter(Boolean);
				this.data[key] = value;
				if (key === "author-url") delete this.data.author_url;
				this.markDirty();
			});
		};
		if (multiline) setting.addTextArea(component => configure(component.inputEl));
		else setting.addText(component => configure(component.inputEl));
	}

	private image(container: HTMLElement, key: string, label: string, fallback: string): void {
		const value = this.data[key] ?? (key === "cover" ? this.project.cover : this.project.background);
		const setting = new Setting(container).setName(label).setDesc(String(value || fallback));
		setting.addButton(button => button.setButtonText("Parcourir…").onClick(() => this.action(async () => {
			const [filename] = await chooseFiles(label, ["jpg", "jpeg", "png", "webp", "gif", "svg"]);
			if (!filename) return;
			this.data[key] = this.relative(filename); setting.setDesc(String(this.data[key])); this.markDirty();
		})));
		setting.addButton(button => button.setButtonText("Réinitialiser").onClick(() => { this.data[key] = ""; setting.setDesc(fallback); this.markDirty(); }));
	}

	private relative(filename: string): string { return path.relative(this.directory, filename).split(path.sep).join("/"); }

	private markDirty(): void {
		this.dirty = true; this.discard = false; this.cancelButton?.setButtonText("Annuler");
	}

	private async action(callback: () => Promise<void>): Promise<void> {
		if (this.saving || this.closed) return;
		this.error?.empty();
		this.pendingActions++;
		try { await callback(); }
		catch (error) {
			if (!this.closed) {
				const code = (error as NodeJS.ErrnoException).code;
				this.error.setText(code === "EACCES" || code === "EPERM"
					? "Accès refusé. Vérifiez les droits d’accès au dossier du projet et aux fichiers choisis."
					: error instanceof Error ? error.message : String(error));
			}
		}
		finally { this.pendingActions--; }
	}

	private async save(): Promise<void> {
		if (this.pendingActions > 1) throw new Error("Attendez la fin du chargement des polices et des ressources avant d’enregistrer.");
		const invalid = Array.from(this.contentEl.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea")).find(input => !input.checkValidity());
		if (invalid) {
			const index = this.panels.findIndex(panel => panel.contains(invalid));
			if (index >= 0) this.selectPanel(index);
			for (const tabs of this.nestedTabs) {
				const nested = tabs.panels.findIndex(panel => panel.contains(invalid));
				if (nested >= 0) tabs.select(nested);
			}
			for (const editor of this.styleEditors) editor.revealField(invalid);
			invalid.reportValidity(); invalid.focus(); return;
		}
		const data: Record<string, unknown> = { ...this.data, fusion: this.project.fusion };
		this.ruleEditor?.normalizeUnits();
		for (const [format, editor] of this.editors) {
			editor.normalizeUnits();
			const presentation = editor.presentation;
			const settings = { ...record(this.data[format]), style: presentation.style, page: presentation.page,
				headings: Object.fromEntries(Object.entries(presentation.headings).filter(([, values]) => Object.keys(values).length)),
				styles: Object.fromEntries(Object.entries(presentation.styles ?? {}).filter(([, values]) => Object.keys(values).length)),
				rules: Object.fromEntries(Object.entries(presentation.rules ?? {}).filter(([, values]) => Object.keys(values).length)) };
			data[format] = format === "epub" ? { ...settings, fonts: this.project.fonts, css: this.project.css } : settings;
			parseProject({ epub: data[format] }, path.basename(this.directory));
		}
		parseProject(data, path.basename(this.directory));
		this.saving = true;
		this.saveButton?.setButtonText("Enregistrement…");
		const controls = this.contentEl.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("button,input,textarea,select");
		for (const control of controls) control.disabled = true;
		try {
			await saveProjectFile(this.directory, stringifyYaml(data), this.original, Array.from(this.pendingFonts.values()));
			this.dirty = false;
			new Notice(`Projet enregistré : ${path.join(this.directory, "bookbinder.md")}`);
		} finally {
			this.saving = false;
			this.saveButton?.setButtonText("Enregistrer le projet");
			for (const control of controls) control.disabled = false;
		}
		this.close();
	}

	close(): void {
		if (this.saving) return;
		if (this.dirty && !this.discard) {
			this.error.setText("Modifications non enregistrées. Enregistrez le projet ou choisissez Fermer sans enregistrer.");
			this.discard = true;
			this.cancelButton?.setButtonText("Fermer sans enregistrer");
			return;
		}
		super.close();
	}

	onClose(): void {
		this.closed = true;
		for (const editor of this.styleEditors) editor.dispose();
		this.pendingFonts.clear();
		this.contentEl.empty();
	}
}
