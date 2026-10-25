import { getLocale, t } from "./i18n.ts";
import { App, ButtonComponent, Modal, Notice, Setting, parseYaml, sanitizeHTMLToDom, setIcon, stringifyYaml } from "obsidian";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { localResource, noteSeparators, parseProject, type BookProject } from "./project";
import { loadFont, projectYaml, readProjectFile, saveProjectFile, type ImportedFont, type ProjectFile } from "./project-files";
import { StyleEditor } from "./style-editor";
import { mountProjectTabs } from "./project-tabs";
import { chooseFiles } from "./dialogs";
import { readFontLibrary, resolveFont } from "./font-library.ts";
import { fontsInStyles } from "./presentation.ts";
import { bindFilenameInput } from "./filename.ts";
import type { FontType } from "./font-catalog.ts";
import { pdfBaseCss } from "./pdf-presentation.ts";
import { mountPaperFormat } from "./page-layout.ts";

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? { ...value as Record<string, unknown> } : {};
}

export async function openProjectEditor(app: App, directory: string, baseCss: string, fontDirectory: string): Promise<void> {
	const original = await readProjectFile(directory);
	const data: unknown = original === undefined ? {} : parseYaml(original.yaml);
	const project = parseProject(data, path.basename(directory));
	new ProjectModal(app, directory, baseCss, original, record(data), project, fontDirectory).open();
}

class ProjectModal extends Modal {
	private editor?: StyleEditor;
	private ruleEditors = new Map<string, StyleEditor>();
	private editors = new Map<string, StyleEditor>();
	private get styleEditors(): StyleEditor[] { return [...this.editors.values(), ...this.ruleEditors.values()]; }
	private projects: Record<"pdf" | "docx" | "epub", BookProject>;
	private nestedTabs: { panels: HTMLElement[]; select: (index: number) => void }[] = [];
	private error!: HTMLElement;
	private libraryFonts: string[] = [];
	private fontTypes = new Map<string, FontType | undefined>();
	private dirty = false;
	private discard = false;
	private saving = false;
	private pendingActions = 0;
	private closed = false;
	private cancelButton?: ButtonComponent;
	private saveButton?: ButtonComponent;
	private panels: HTMLElement[] = [];
	private selectPanel: (index: number) => void = () => {};
	private refreshFilename: () => void = () => {};

	constructor(app: App, private directory: string, private baseCss: string, private original: ProjectFile | undefined,
		private data: Record<string, unknown>, private project: BookProject, private fontDirectory: string) {
		super(app);
		this.projects = {
			pdf: parseProject(data, path.basename(directory), "pdf"),
			docx: parseProject(data, path.basename(directory), "docx"),
			epub: project,
		};
		this.data.title ??= project.metadata.title;
		this.data.lang ??= project.metadata.lang;
	}

	onOpen(): void {
		this.modalEl.addClass("bookbinder-project-modal");
		this.setTitle(this.original === undefined ? t("createABookProject") : t("editBookProject"));
		this.contentEl.createDiv({ text: this.directory, cls: "bookbinder-project-path" });
		const navigation = this.contentEl.createDiv({ cls: "bookbinder-project-tabs", attr: { role: "tablist", "aria-label": t("projectConfiguration") } });
		const layout = this.contentEl.createDiv({ cls: "bookbinder-project-layout" });
		const information = layout.createDiv({ cls: "bookbinder-project-information" });
		const formats = ["pdf", "docx", "epub"] as const;
		const formatPanels = formats.map(() => layout.createDiv({ cls: "bookbinder-project-format" }));
		this.panels = [information, ...formatPanels];
		this.selectPanel = mountProjectTabs(navigation, this.panels, [t("general"), "PDF", "DOCX", "ePub"], () => {
			layout.scrollTop = 0;
			for (const editor of this.styleEditors) editor.refresh();
		});
		this.metadata(information, "title", t("title"), true, true);
		this.metadata(information, "subtitle", t("subtitle"), true);
		this.metadata(information, "author", t("author"), true);
		new Setting(information).setName(t("fileName")).setDesc(t("fileNameDescription")).addText(input => {
			input.inputEl.setAttribute("aria-label", t("fileName"));
			this.refreshFilename = bindFilenameInput(input.inputEl, this.data, this.project.metadata, () => this.markDirty());
		});
		this.metadata(information, "lang", t("language"), false, true);
		const paper = information.createDiv({ cls: "bookbinder-paper-format" });
		mountPaperFormat(paper, this.projects.pdf.page, () => {
			this.markDirty(); this.editors.get("pdf")?.refresh(); this.ruleEditors.get("pdf")?.refresh();
		});
		const publication = information.createEl("details");
		publication.createEl("summary", { text: t("publication") });
		for (const [key, label] of [
			["description", t("description")], ["subject", t("subjects")], ["rights", t("rights")], ["identifier", t("bookIdentifier")],
			["publisher", t("publisher")], ["author-url", t("authorWebsite")], ["publisher-url", t("publisherWebsite")],
			["isbn", t("printIsbn")], ["isbn-ebook", t("digitalIsbn")], ["date", t("publicationDate")],
			["colophon", t("colophon")],
		]) this.metadata(publication, key, label, key === "description" || key === "colophon");
		const cover = information.createEl("details");
		cover.createEl("summary", { text: t("cover") });
		this.image(cover, "cover", t("cover"), t("automatic"));
		this.image(cover, "cover-background", t("backgroundImage"), t("noBackgroundImage"));
		let fontBusy = true;
		const fusion = information.createEl("details");
		fusion.createEl("summary", { text: t("fileAssembly") });
		for (const [key, label] of [["excludeCharacters", t("charactersToExcludeFromNames")], ["excludeNames", t("namesToExcludeSeparatedByCommas")]] as const) {
			new Setting(fusion).setName(label).addText(input => {
				input.setValue(this.project.fusion[key]).onChange(value => { this.project.fusion[key] = value; this.markDirty(); });
				input.inputEl.setAttribute("aria-label", label);
			});
		}
		const currentSeparator = this.project.fusion.noteSeparator;
		let customSeparator = noteSeparators.has(currentSeparator) ? "" : currentSeparator;
		let separatorInput: HTMLInputElement;
		new Setting(fusion).setName(t("separatorBetweenNotes")).addDropdown(input => {
			for (const [value, choice] of noteSeparators) input.addOption(value, choice.label);
			input.addOption("__custom__", t("customCharacters"));
			input.setValue(noteSeparators.has(currentSeparator) ? currentSeparator : "__custom__").onChange(value => {
				separatorInput.hidden = value !== "__custom__";
				this.project.fusion.noteSeparator = value === "__custom__" ? customSeparator : value;
				this.markDirty();
				if (!separatorInput.hidden) separatorInput.focus();
			});
			input.selectEl.setAttribute("aria-label", t("separatorBetweenNotes"));
		}).addText(input => {
			separatorInput = input.inputEl;
			separatorInput.hidden = noteSeparators.has(currentSeparator);
			separatorInput.setAttribute("aria-label", t("customCharacters"));
			input.setValue(customSeparator).onChange(value => {
				customSeparator = value;
				this.project.fusion.noteSeparator = value;
				this.markDirty();
			});
		});
		const selectFont = (reference: string, apply: () => void): Promise<void> => this.action(async () => {
			if (fontBusy) return;
			fontBusy = true;
			try { await this.loadProjectFont(reference); if (!this.closed) apply(); }
			finally { fontBusy = false; }
		});
		for (const [index, format] of formats.entries()) {
			const panel = formatPanels[index];
			const tabs = panel.createDiv({ cls: "bookbinder-project-tabs", attr: { "aria-label": t("formatSettings", { format: format.toUpperCase() }) } });
			panel.prepend(tabs);
			const page = panel.createDiv({ cls: "bookbinder-project-page" });
			const presentation = panel.createDiv({ cls: "bookbinder-project-presentation" });
			page.createEl("h3", { text: t("margins") });
			page.createEl("p", { text: format === "epub"
				? t("epubPageDescription")
				: t("autoKeepsTheTemplateMarginsValuesEnteredHereUseMillimetres"), cls: "bookbinder-muted" });
			const pageFields = page.createDiv({ cls: "bookbinder-page-fields" });
			presentation.createEl("h3", { text: t("styles") });
			const editor = new StyleEditor(presentation, this.projects[format], format === "pdf" ? pdfBaseCss : this.baseCss, () => this.markDirty(), () => this.close(), { format, setIcon, sanitizeHTMLToDom, fontLibrary: () => this.libraryFonts, fontType: reference => this.fontTypes.get(reference), selectFont });
			this.editors.set(format, editor);
			void editor.mountPage(pageFields);
			const panels = [page, presentation];
			const labels = [t("page"), t("styles")];
			if (format !== "docx") {
				const rules = panel.createDiv({ cls: "bookbinder-project-presentation" });
				rules.createEl("h3", { text: t("afterAHeading") });
				rules.createEl("p", { text: t("headingRuleDescription"), cls: "bookbinder-muted" });
				const ruleEditor = new StyleEditor(rules, this.projects[format], format === "pdf" ? pdfBaseCss : this.baseCss, () => this.markDirty(), () => this.close(), { format, setIcon, sanitizeHTMLToDom, rules: true, fontLibrary: () => this.libraryFonts, fontType: reference => this.fontTypes.get(reference), selectFont });
				this.ruleEditors.set(format, ruleEditor);
				panels.push(rules); labels.push(t("rules"));
			}
			const select = mountProjectTabs(tabs, panels, labels, () => { editor.refresh(); this.ruleEditors.get(format)?.refresh(); });
			this.nestedTabs.push({ panels, select });
		}
		this.editor = this.editors.get("epub");
		this.error = this.contentEl.createDiv({ cls: "bookbinder-project-error", attr: { role: "alert", "aria-live": "polite" } });
		const footer = this.contentEl.createDiv({ cls: "bookbinder-project-actions" });
		this.cancelButton = new ButtonComponent(footer).setButtonText(t("cancel")).onClick(() => this.close());
		this.saveButton = new ButtonComponent(footer).setButtonText(t("saveProject")).setCta().onClick(() => this.action(() => this.save()));
		void this.action(async () => {
			try {
				await Promise.all(this.styleEditors.map(editor => editor.ready));
				if (this.closed) return;
				if (this.project.css.length) {
					const css = (await Promise.all(this.project.css.map(filename => readFile(localResource(this.directory, filename), "utf8")))).join("\n");
					this.editor!.setBaseCss(css); this.ruleEditors.get("epub")?.setBaseCss(css);
				}
				await this.loadFontLibrary();
				for (const format of Object.values(this.projects)) format.fonts = fontsInStyles(format, this.libraryFonts);
				for (const filename of new Set(Object.values(this.projects).flatMap(format => format.fonts))) {
					const font = await loadFont(resolveFont(this.directory, filename, this.fontDirectory));
					await this.loadProjectFont(filename, font);
				}
				this.refreshFonts();
			} finally { fontBusy = false; }
		});
		this.contentEl.querySelector<HTMLTextAreaElement>("textarea")?.focus();
	}

	private refreshFonts(): void {
		for (const editor of this.styleEditors) editor.refreshFonts();
	}

	private async loadFontLibrary(): Promise<void> {
		const fonts = await readFontLibrary(this.fontDirectory);
		this.libraryFonts = fonts.map(font => font.reference);
		this.fontTypes = new Map(fonts.map(font => [font.reference, font.type]));
	}

	private async loadProjectFont(reference: string, font?: ImportedFont): Promise<void> {
		font ??= await loadFont(resolveFont(this.directory, reference, this.fontDirectory));
		for (const editor of this.styleEditors) await editor.addFont(reference, font.data);
	}

	private metadata(container: HTMLElement, key: string, label: string, multiline = false, required = false): void {
		const value = this.project.metadata[key];
		const text = Array.isArray(value) ? value.join(key === "author" ? "\n" : ", ") : value instanceof Date ? value.toISOString().slice(0, 10) : typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "";
		const setting = new Setting(container).setName(label);
		if (key === "lang") {
			const current = text || "fr";
			this.data.lang = current;
			const codes = ["fr", "en", "es", "de", "it", "pt", "nl", "sv", "da", "no", "fi", "pl", "cs", "ru", "uk", "el", "tr", "ar", "he", "zh", "ja", "ko"];
			if (!codes.includes(current)) codes.push(current);
			const names = new Intl.DisplayNames([getLocale()], { type: "language" });
			const name = (code: string) => { try { return names.of(code) || code; } catch { return code; } };
			setting.addDropdown(input => {
				for (const code of codes.sort((left, right) => name(left).localeCompare(name(right), getLocale()))) input.addOption(code, name(code));
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
			if (input instanceof HTMLTextAreaElement) input.rows = 1;
			input.addEventListener("input", () => {
				let value: string | string[] = input.value;
				if (key === "author") { const names = value.split("\n").map(name => name.trim()).filter(Boolean); value = names.length > 1 ? names : names[0] ?? ""; }
				if (key === "subject") value = input.value.split(",").map(item => item.trim()).filter(Boolean);
				this.data[key] = value;
				if (key === "title" || key === "author") this.refreshFilename();
				this.markDirty();
			});
		};
		if (multiline) setting.addTextArea(component => configure(component.inputEl));
		else setting.addText(component => configure(component.inputEl));
	}

	private image(container: HTMLElement, key: string, label: string, fallback: string): void {
		const value = this.data[key] ?? (key === "cover" ? this.project.cover : this.project.background);
		const setting = new Setting(container).setName(label).setDesc(typeof value === "string" && value ? value : fallback);
		setting.addButton(button => button.setButtonText(t("browseDialog")).onClick(() => this.action(async () => {
			const [filename] = await chooseFiles(label, ["jpg", "jpeg", "png", "webp", "gif", "svg"]);
			if (!filename) return;
			this.data[key] = this.relative(filename); setting.setDesc(String(this.data[key])); this.markDirty();
		})));
		setting.addButton(button => button.setButtonText(t("reset")).onClick(() => { this.data[key] = ""; setting.setDesc(fallback); this.markDirty(); }));
	}

	private relative(filename: string): string { return path.relative(this.directory, filename).split(path.sep).join("/"); }

	private markDirty(): void {
		this.dirty = true; this.discard = false; this.cancelButton?.setButtonText(t("cancel"));
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
					? t("projectAccessDenied")
					: error instanceof Error ? error.message : String(error));
			}
		}
		finally { this.pendingActions--; }
	}

	private async save(): Promise<void> {
		if (this.pendingActions > 1) throw new Error(t("waitForFontsAndResourcesToFinishLoadingBeforeSaving"));
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
		for (const editor of this.ruleEditors.values()) editor.normalizeUnits();
		for (const [format, editor] of this.editors) {
			editor.normalizeUnits();
			const presentation = editor.presentation;
			const settings: Record<string, unknown> = { ...record(this.data[format]), fonts: presentation.fonts, style: presentation.style, page: presentation.page,
				headings: Object.fromEntries(Object.entries(presentation.headings).filter(([, values]) => Object.keys(values).length)),
				styles: Object.fromEntries(Object.entries(presentation.styles ?? {}).filter(([, values]) => Object.keys(values).length)),
				"disabled-rules": presentation.disabledRules ?? [],
				rules: Object.fromEntries(Object.entries(presentation.rules ?? {}).filter(([, values]) => Object.keys(values).length)) };
			if (format !== "docx") {
				delete settings.separator;
				if (presentation.separator !== undefined) settings.separator = presentation.separator;
			}
			data[format] = format === "epub" ? { ...settings, css: this.project.css } : settings;
			parseProject(data, path.basename(this.directory), format as "epub" | "pdf" | "docx");
		}
		parseProject(data, path.basename(this.directory));
		this.saving = true;
		this.saveButton?.setButtonText(t("saving"));
		const controls = this.contentEl.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("button,input,textarea,select");
		for (const control of controls) control.disabled = true;
		try {
			await saveProjectFile(this.directory, projectYaml(data, stringifyYaml), this.original);
			this.dirty = false;
			new Notice(t("projectSavedFilename", { filename: path.join(this.directory, "bookbinder.md") }));
		} finally {
			this.saving = false;
			this.saveButton?.setButtonText(t("saveProject"));
			for (const control of controls) control.disabled = false;
		}
		this.close();
	}

	close(): void {
		if (this.saving) return;
		if (this.dirty && !this.discard) {
			this.error.setText(t("projectUnsavedChanges"));
			this.discard = true;
			this.cancelButton?.setButtonText(t("closeWithoutSaving"));
			return;
		}
		super.close();
	}

	onClose(): void {
		this.closed = true;
		for (const editor of this.styleEditors) editor.dispose();
		this.contentEl.empty();
	}
}
