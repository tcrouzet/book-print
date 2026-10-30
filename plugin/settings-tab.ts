import { t } from "./i18n.ts";
import { App, ButtonComponent, ExtraButtonComponent, FileSystemAdapter, PluginSettingTab, Setting, TextComponent, parseYaml, requestUrl, stringifyYaml, type SettingDefinitionItem } from "obsidian";
import type BookbinderPlugin from "./main";
import { detectTool, type Tool, type ToolStatus } from "./tools";
import { checkUpdate } from "./updates";
import type { BookbinderSettings } from "./types";
import { chooseFiles, chooseOutputDirectory } from "./dialogs";
import { openProjectEditor } from "./project-modal";
import { cloneProjectFile } from "./project-clone";
import { mountFontCatalog } from "./font-catalog.ts";
import { isFontPackageInstalled } from "./font-package.ts";
import { importFonts } from "./font-import.ts";
import { readFontLibrary } from "./font-library.ts";
import { downloadModels, listModels } from "./project-models.ts";

export class BookbinderSettingTab extends PluginSettingTab {
	override icon = "bookbinder";
	private draft: BookbinderSettings;
	private generation = 0;
	private statuses: Partial<Record<Tool, HTMLElement>> = {};
	private fontCatalogEl?: HTMLElement;

	constructor(app: App, private plugin: BookbinderPlugin) {
		super(app, plugin);
		this.draft = { ...plugin.settings };
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ type: "group", heading: t("projects"), items: [
				{ name: t("projectModel"), desc: t("projectModelDescription"), aliases: [t("downloadModels")], render: setting => this.displayModels(setting) },
				{ name: t("bookProject"), desc: t("projectSettingDescription"), aliases: [t("create"), t("open"), t("styles"), t("fonts")], render: setting => this.displayProject(setting) },
				{ name: t("cloneAProject"), desc: t("cloneSettingDescription"), aliases: [t("copy"), t("duplicate")], render: setting => this.displayCloneProject(setting) },
			] },
			{ type: "group", heading: t("export"), items: [
				{ name: t("outputFolder"), desc: t("defaultTheSameFolderAsTheMarkdownSourceFile"), aliases: ["Export", "Destination", t("browse")], render: setting => this.displayOutputDirectory(setting) },
			] },
			{ type: "group", heading: t("installation"), items: [
				{ name: "Pandoc", desc: t("pandocCreatesWordAndEpubFiles"), render: setting => this.displayTool(setting, "pandoc") },
				{ name: "LaTeX", desc: t("latexIsAlsoRequiredForPdfFiles"), aliases: ["XeLaTeX"], render: setting => this.displayTool(setting, "xelatex") },
				{ name: t("customPaths"), aliases: [t("pandocPath"), t("xelatexPath"), t("checkInstallation"), t("saveAndCheck")], render: setting => this.displayCustomPaths(setting) },
			] },
			{ type: "group", heading: t("fonts"), items: [
				{ name: t("fontLibrary"), desc: t("fontLibraryDescription"), aliases: [t("importFonts"), t("fontPackageCatalog")], render: setting => this.displayFontLibrary(setting) },
				{ name: t("fontPackage"), desc: t("fontPackageDescription"), aliases: [t("fontPackageCatalog")], render: setting => this.displayFontPackage(setting) },
			] },
		];
	}

	private displayModels(setting: Setting): void {
		const status = setting.descEl.createDiv({ attr: { role: "status", "aria-live": "polite" } });
		setting.addDropdown(input => {
			input.selectEl.setAttribute("aria-label", t("projectModel"));
			const refresh = async () => {
				const names = ["base.md", ...(await listModels(this.plugin.modelDirectory)).filter(name => name !== "base.md")];
				if (!status.isConnected) return;
				input.selectEl.replaceChildren();
				for (const name of names) input.addOption(name, name === "base.md" ? t("baseProjectModel") : name.replace(/\.md$/, ""));
				if (this.plugin.settings.projectModel && !names.includes(this.plugin.settings.projectModel)) input.addOption(this.plugin.settings.projectModel, this.plugin.settings.projectModel);
				input.setValue(this.plugin.settings.projectModel);
			};
			input.setDisabled(true);
			void refresh().catch(error => status.setText(error instanceof Error ? error.message : String(error))).finally(() => { input.setDisabled(false); });
			input.onChange(async value => {
				input.setDisabled(true); status.empty();
				try {
					await this.plugin.defaultProjectData(value);
					await this.plugin.saveSettings({ ...this.plugin.settings, projectModel: value });
					this.draft.projectModel = value;
				} catch (error) { input.setValue(this.plugin.settings.projectModel); status.setText(error instanceof Error ? error.message : String(error)); }
				finally { input.setDisabled(false); }
			});
			setting.addButton(button => button.setButtonText(t("downloadModels")).onClick(async () => {
				button.setDisabled(true); input.setDisabled(true); status.setText(t("downloadingModels"));
				try {
					await downloadModels(this.plugin.modelDirectory, async url => {
						let timer: number | undefined;
						try { return await Promise.race([requestUrl({ url, throw: false }), new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new Error(t("modelDownloadTimedOut"))), 15000); })]); }
						finally { window.clearTimeout(timer); }
					}, parseYaml);
					await refresh(); status.setText(t("projectModelsReady"));
				} catch (error) { status.setText(error instanceof Error ? error.message : String(error)); }
				finally { button.setDisabled(false); input.setDisabled(false); }
			}));
		});
	}

	private displayFontLibrary(setting: Setting): void {
		this.containerEl.addClass("bookbinder-settings");
		const status = setting.descEl.createDiv({ attr: { role: "status", "aria-live": "polite" } });
		this.fontCatalogEl = setting.descEl.createDiv();
		void this.refreshFontCatalog().catch(error => status.setText(error instanceof Error ? error.message : String(error)));
		setting.addButton(button => button.setButtonText(t("importFonts")).onClick(async () => {
			button.setDisabled(true); status.empty();
			try { await importFonts(this.app, this.plugin.fontDirectory); await this.refreshFontCatalog(); }
			catch (error) { status.setText(error instanceof Error ? error.message : String(error)); }
			finally { button.setDisabled(false); }
		}));
	}

	private async refreshFontCatalog(): Promise<void> {
		const element = this.fontCatalogEl;
		if (!element) return;
		const fonts = await readFontLibrary(this.plugin.fontDirectory);
		if (!element.isConnected || element !== this.fontCatalogEl) return;
		element.empty(); mountFontCatalog(element, undefined, fonts);
	}

	private displayFontPackage(setting: Setting): void {
		const status = setting.descEl.createDiv({ attr: { role: "status", "aria-live": "polite" } });
		setting.addButton(button => {
			button.setButtonText(t("downloadFontPackage")).setDisabled(true);
			const connected = () => status.isConnected;
			void isFontPackageInstalled(this.plugin.fontDirectory).then(installed => {
				if (!connected()) return;
				button.setDisabled(installed).setButtonText(t(installed ? "fontPackageInstalled" : "downloadFontPackage"));
			}).catch(error => { if (connected()) status.setText(error instanceof Error ? error.message : String(error)); });
			button.onClick(async () => {
				button.setDisabled(true); status.setText(t("installingFontPackage"));
				try {
					await this.plugin.installFonts();
					await this.refreshFontCatalog();
					if (connected()) { status.setText(t("fontPackageReady")); button.setButtonText(t("fontPackageInstalled")); }
				} catch (error) {
					if (connected()) { status.setText(error instanceof Error ? error.message : String(error)); button.setDisabled(false); }
				}
			});
		});
	}

	private displayTool(setting: Setting, tool: Tool): () => void {
		this.containerEl.addClass("bookbinder-settings");
		const element = setting.descEl.createDiv({ text: t("searching"), attr: { role: "status", "aria-live": "polite" } });
		this.statuses[tool] = element;
		const generation = this.generation;
		void detectTool(tool, this.plugin.settings[tool === "pandoc" ? "pandocPath" : "latexPath"])
			.then(status => this.showStatus(element, status, tool, generation))
			.catch(() => { if (generation === this.generation && element.isConnected) element.setText(t("couldNotCheckInstallation")); });
		return () => { if (this.statuses[tool] === element) delete this.statuses[tool]; };
	}

	private displayCustomPaths(setting: Setting): void {
		this.containerEl.addClass("bookbinder-settings");
		this.draft = { ...this.plugin.settings };
		setting.settingEl.addClass("bookbinder-paths-row");
		setting.infoEl.hidden = true;
		setting.controlEl.hidden = true;
		const advanced = setting.settingEl.createEl("details", { cls: "bookbinder-paths" });
		advanced.createEl("summary", { text: t("customPaths") });
		advanced.createEl("p", { text: t("leaveTheseFieldsEmptyToUseAutomaticDetection") });
		for (const [key, label] of [["pandocPath", "Pandoc"], ["latexPath", "XeLaTeX"]] as const) {
			new Setting(advanced).setName(label).addText(text => text
				.setPlaceholder(t("automaticDetection")).setValue(this.draft[key])
				.onChange(value => { this.draft[key] = value; })
				.inputEl.setAttribute("aria-label", t("pathToProgram", { program: label })));
		}

		const message = advanced.createDiv({ attr: { role: "status", "aria-live": "polite" } });
		new Setting(advanced).setName(t("checkInstallation"))
			.setDesc(t("customPathsAreSavedWhenChecking"))
			.addButton(button => button.setButtonText(t("saveAndCheck")).setCta().onClick(async () => {
				const generation = ++this.generation;
				const settings = { ...this.draft };
				button.setDisabled(true).setButtonText(t("checking"));
				message.empty();
				for (const element of Object.values(this.statuses)) element.setText(t("searching"));
				try {
					await this.plugin.saveSettings(settings);
					await Promise.all((["pandoc", "xelatex"] as const).map(async tool => {
						const status = await detectTool(tool, settings[tool === "pandoc" ? "pandocPath" : "latexPath"]);
						const element = this.statuses[tool];
						if (element) await this.showStatus(element, status, tool, generation);
					}));
				} catch {
					if (generation === this.generation) {
						for (const element of Object.values(this.statuses)) element.setText(t("couldNotCheckInstallation"));
						message.setText(t("toolCheckFailed"));
					}
				} finally {
					if (generation === this.generation) button.setDisabled(false).setButtonText(t("saveAndCheck"));
				}
			}));
	}

	hide(): void {
		this.generation++;
	}

	private displayProject(project: Setting): void {
		const error = project.descEl.createDiv({ attr: { role: "status", "aria-live": "polite" } });
		project.addButton(button => button.setButtonText(t("createOpenProject")).setCta().onClick(async () => {
			button.setDisabled(true); error.empty();
			try {
				const adapter = this.app.vault.adapter;
				if (!(adapter instanceof FileSystemAdapter)) throw new Error(t("projectsRequireObsidianOnDesktop"));
				const source = this.app.workspace.getActiveFile();
				const initial = adapter.getFullPath(source?.parent?.path ?? "");
				const directory = await chooseOutputDirectory(initial, t("chooseTheBookProjectFolder"));
				if (directory) await openProjectEditor(this.app, directory, this.plugin.resources["epub/base.css"], this.plugin.fontDirectory, () => this.plugin.defaultProjectData());
			} catch (cause) { error.setText(cause instanceof Error ? cause.message : String(cause)); }
			finally { button.setDisabled(false); }
		}));
	}

	private displayCloneProject(setting: Setting): void {
		const message = setting.descEl.createDiv({ attr: { role: "status", "aria-live": "polite" } });
		setting.addButton(button => button.setButtonText(t("cloneAProject")).onClick(async () => {
			button.setDisabled(true); message.empty();
			try {
				const [filename] = await chooseFiles(t("chooseTheProjectToClone"), ["md"]);
				if (!filename) return;
				const directory = await chooseOutputDirectory(undefined, t("chooseTheNewProjectFolder"));
				if (!directory) return;
				await cloneProjectFile(filename, directory, parseYaml, stringifyYaml);
				message.setText(t("projectCloned"));
				await openProjectEditor(this.app, directory, this.plugin.resources["epub/base.css"], this.plugin.fontDirectory);
			} catch (cause) { message.setText(cause instanceof Error ? cause.message : String(cause)); }
			finally { button.setDisabled(false); }
		}));
	}

	private displayOutputDirectory(setting: Setting): void {
		const input = new TextComponent(setting.controlEl).setPlaceholder(t("sourceFileFolder"))
			.setValue(this.plugin.settings.outputDirectory);
		input.inputEl.readOnly = true;
		input.inputEl.setAttribute("aria-label", t("outputFolder"));
		const browse = new ButtonComponent(setting.controlEl).setButtonText(t("browseDialog"));
		const reset = new ExtraButtonComponent(setting.controlEl).setIcon("rotate-ccw")
			.setTooltip(t("useTheSourceFileFolder")).setDisabled(!this.plugin.settings.outputDirectory);
		const error = setting.descEl.createDiv({ attr: { role: "status", "aria-live": "polite" } });
		const update = async (select: () => Promise<string | undefined>): Promise<void> => {
			browse.setDisabled(true);
			reset.setDisabled(true);
			error.empty();
			try {
				const directory = await select();
				if (directory === undefined) return;
				await this.plugin.saveSettings({ ...this.plugin.settings, outputDirectory: directory });
				this.draft.outputDirectory = directory;
				input.setValue(directory);
			} catch (cause) {
				error.setText(t("couldNotSetTheFolderError", { error: cause instanceof Error ? cause.message : String(cause) }));
			} finally {
				browse.setDisabled(false);
				reset.setDisabled(!this.plugin.settings.outputDirectory);
			}
		};
		browse.onClick(() => update(async () => {
			const source = this.app.workspace.getActiveFile();
			const initial = this.plugin.settings.outputDirectory || (source?.extension === "md" ? this.plugin.getOutputDirectory(source) : undefined);
			return chooseOutputDirectory(initial);
		}));
		reset.onClick(() => update(async () => ""));
	}

	private async showStatus(element: HTMLElement, status: ToolStatus, tool: Tool, generation: number): Promise<void> {
		if (generation !== this.generation || !element.isConnected) return;
		element.empty();
		element.createDiv({ text: status.state === "found" ? t("detectedVersion", { version: status.version }) : status.message });
		if (status.path) element.createDiv({ text: status.path, cls: "bookbinder-tool-path" });
		const update = element.createDiv({ text: t("checkingTheOnlineVersion") });
		const result = await checkUpdate(tool, status, async url => {
			const response = await requestUrl({ url, throw: false });
			if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
			return response.text;
		});
		if (generation !== this.generation || !element.isConnected) return;
		update.setText(result.message);
		if (result.url && result.action) element.createEl("a", { text: result.action, href: result.url,
			attr: { target: "_blank", rel: "noopener noreferrer" } });
	}
}
