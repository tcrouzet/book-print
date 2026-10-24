import { App, ButtonComponent, ExtraButtonComponent, FileSystemAdapter, PluginSettingTab, Setting, TextComponent, requestUrl, type SettingDefinitionItem } from "obsidian";
import type BookbinderPlugin from "./main";
import { detectTool, type Tool, type ToolStatus } from "./tools";
import { checkUpdate } from "./updates";
import type { BookbinderSettings } from "./types";
import { chooseOutputDirectory } from "./dialogs";
import { openProjectEditor } from "./project-modal";

export class BookbinderSettingTab extends PluginSettingTab {
	private draft: BookbinderSettings;
	private generation = 0;
	private statuses: Partial<Record<Tool, HTMLElement>> = {};

	constructor(app: App, private plugin: BookbinderPlugin) {
		super(app, plugin);
		this.draft = { ...plugin.settings };
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ type: "group", heading: "Projets", items: [
				{ name: "Projet de livre", desc: "Choisissez un dossier pour définir un livre, sa présentation et ses polices. Un projet existant peut être modifié.", aliases: ["Créer", "Ouvrir", "Styles", "Polices"], render: setting => this.displayProject(setting) },
			] },
			{ type: "group", heading: "Génération", items: [
				{ name: "Dossier de génération", desc: "Par défaut : même dossier que le fichier Markdown source.", aliases: ["Export", "Destination", "Parcourir"], render: setting => this.displayOutputDirectory(setting) },
			] },
			{ type: "group", heading: "Installation", items: [
				{ name: "Pandoc", desc: "Pandoc produit les fichiers Word et EPUB.", render: setting => this.displayTool(setting, "pandoc") },
				{ name: "LaTeX", desc: "LaTeX est également nécessaire pour les PDF.", aliases: ["XeLaTeX"], render: setting => this.displayTool(setting, "xelatex") },
				{ name: "Chemins personnalisés", aliases: ["Chemin Pandoc", "Chemin XeLaTeX", "Vérifier l’installation", "Enregistrer et vérifier"], render: setting => this.displayCustomPaths(setting) },
			] },
		];
	}

	private displayTool(setting: Setting, tool: Tool): () => void {
		this.containerEl.addClass("bookbinder-settings");
		const element = setting.descEl.createDiv({ text: "Recherche en cours…", attr: { role: "status", "aria-live": "polite" } });
		this.statuses[tool] = element;
		const generation = this.generation;
		void detectTool(tool, this.plugin.settings[tool === "pandoc" ? "pandocPath" : "latexPath"])
			.then(status => this.showStatus(element, status, tool, generation))
			.catch(() => { if (generation === this.generation && element.isConnected) element.setText("Vérification impossible."); });
		return () => { if (this.statuses[tool] === element) delete this.statuses[tool]; };
	}

	private displayCustomPaths(setting: Setting): void {
		this.containerEl.addClass("bookbinder-settings");
		this.draft = { ...this.plugin.settings };
		setting.settingEl.addClass("bookbinder-paths-row");
		setting.infoEl.hidden = true;
		setting.controlEl.hidden = true;
		const advanced = setting.settingEl.createEl("details", { cls: "bookbinder-paths" });
		advanced.createEl("summary", { text: "Chemins personnalisés" });
		advanced.createEl("p", { text: "Laissez ces champs vides pour utiliser la détection automatique." });
		for (const [key, label] of [["pandocPath", "Pandoc"], ["latexPath", "XeLaTeX"]] as const) {
			new Setting(advanced).setName(label).addText(text => text
				.setPlaceholder("Détection automatique").setValue(this.draft[key])
				.onChange(value => { this.draft[key] = value; })
				.inputEl.setAttribute("aria-label", `Chemin de ${label}`));
		}

		const message = advanced.createDiv({ attr: { role: "status", "aria-live": "polite" } });
		new Setting(advanced).setName("Vérifier l’installation")
			.setDesc("Les chemins personnalisés sont enregistrés lors de la vérification.")
			.addButton(button => button.setButtonText("Enregistrer et vérifier").setCta().onClick(async () => {
				const generation = ++this.generation;
				const settings = { ...this.draft };
				button.setDisabled(true).setButtonText("Vérification…");
				message.empty();
				for (const element of Object.values(this.statuses)) element.setText("Recherche en cours…");
				try {
					await this.plugin.saveSettings(settings);
					await Promise.all((["pandoc", "xelatex"] as const).map(async tool => {
						const status = await detectTool(tool, settings[tool === "pandoc" ? "pandocPath" : "latexPath"]);
						const element = this.statuses[tool];
						if (element) await this.showStatus(element, status, tool, generation);
					}));
				} catch {
					if (generation === this.generation) {
						for (const element of Object.values(this.statuses)) element.setText("Vérification impossible.");
						message.setText("La vérification a échoué. Vérifiez l’accès aux réglages et aux programmes, puis réessayez.");
					}
				} finally {
					if (generation === this.generation) button.setDisabled(false).setButtonText("Enregistrer et vérifier");
				}
			}));
	}

	hide(): void {
		this.generation++;
	}

	private displayProject(project: Setting): void {
		const error = project.descEl.createDiv({ attr: { role: "status", "aria-live": "polite" } });
		project.addButton(button => button.setButtonText("Créer/ouvrir projet").setCta().onClick(async () => {
			button.setDisabled(true); error.empty();
			try {
				const adapter = this.app.vault.adapter;
				if (!(adapter instanceof FileSystemAdapter)) throw new Error("Les projets nécessitent Obsidian sur ordinateur.");
				const source = this.app.workspace.getActiveFile();
				const initial = adapter.getFullPath(source?.parent?.path ?? "");
				const directory = await chooseOutputDirectory(initial, "Choisir le dossier du projet de livre");
				if (directory) await openProjectEditor(this.app, directory, this.plugin.resources["epub/base.css"]);
			} catch (cause) { error.setText(cause instanceof Error ? cause.message : String(cause)); }
			finally { button.setDisabled(false); }
		}));
	}

	private displayOutputDirectory(setting: Setting): void {
		const input = new TextComponent(setting.controlEl).setPlaceholder("Dossier du fichier source")
			.setValue(this.plugin.settings.outputDirectory);
		input.inputEl.readOnly = true;
		input.inputEl.setAttribute("aria-label", "Dossier de génération");
		const browse = new ButtonComponent(setting.controlEl).setButtonText("Parcourir…");
		const reset = new ExtraButtonComponent(setting.controlEl).setIcon("rotate-ccw")
			.setTooltip("Utiliser le dossier du fichier source").setDisabled(!this.plugin.settings.outputDirectory);
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
				error.setText(`Impossible de définir le dossier : ${cause instanceof Error ? cause.message : String(cause)}`);
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
		element.createDiv({ text: status.state === "found" ? `Détecté · ${status.version}` : status.message });
		if (status.path) element.createDiv({ text: status.path, cls: "bookbinder-tool-path" });
		const update = element.createDiv({ text: "Recherche de la version en ligne…" });
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
