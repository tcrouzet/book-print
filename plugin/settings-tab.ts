import { App, ButtonComponent, ExtraButtonComponent, FileSystemAdapter, PluginSettingTab, Setting, TextComponent, requestUrl } from "obsidian";
import type BookbinderPlugin from "./main";
import { detectTool, type Tool, type ToolStatus } from "./tools";
import { checkUpdate } from "./updates";
import type { BookbinderSettings } from "./types";
import { chooseOutputDirectory } from "./output";
import { openProjectEditor } from "./project-modal";

export class BookbinderSettingTab extends PluginSettingTab {
	private draft: BookbinderSettings;
	private generation = 0;

	constructor(app: App, private plugin: BookbinderPlugin) {
		super(app, plugin);
		this.draft = { ...plugin.settings };
	}

	display(): void {
		this.generation++;
		this.draft = { ...this.plugin.settings };
		this.containerEl.empty();
		this.containerEl.addClass("bookbinder-settings");
		this.displayProjects();
		this.displayOutputDirectory();
		new Setting(this.containerEl).setName("Installation").setHeading()
			.setDesc("Pandoc produit les fichiers Word et EPUB. LaTeX est également nécessaire pour les PDF.");

		const statuses = {} as Record<"pandocPath" | "latexPath", HTMLElement>;
		for (const tool of [
			{ key: "pandocPath", name: "Pandoc" },
			{ key: "latexPath", name: "LaTeX" },
		] as const) {
			const setting = new Setting(this.containerEl).setName(tool.name);
			statuses[tool.key] = setting.descEl.createDiv({ attr: { role: "status", "aria-live": "polite" } });
		}

		const advanced = this.containerEl.createEl("details", { cls: "bookbinder-paths" });
		advanced.createEl("summary", { text: "Chemins personnalisés" });
		advanced.createEl("p", { text: "Laissez ces champs vides pour utiliser la détection automatique." });
		for (const [key, label] of [["pandocPath", "Pandoc"], ["latexPath", "XeLaTeX"]] as const) {
			new Setting(advanced).setName(label).addText(text => text
				.setPlaceholder("Détection automatique").setValue(this.draft[key])
				.onChange(value => { this.draft[key] = value; })
				.inputEl.setAttribute("aria-label", `Chemin de ${label}`));
		}

		const message = advanced.createDiv({ attr: { role: "status", "aria-live": "polite" } });
		const action = new Setting(advanced).setName("Vérifier l’installation")
			.setDesc("Les chemins personnalisés sont enregistrés lors de la vérification.");
		action.addButton(button => {
			const check = async (save: boolean): Promise<void> => {
				const generation = ++this.generation;
				const settings = { ...this.draft };
				button.setDisabled(true).setButtonText("Vérification…");
				message.empty();
				for (const element of Object.values(statuses)) element.setText("Recherche en cours…");
				try {
					if (save) await this.plugin.saveSettings(settings);
					const results = await Promise.all([
						detectTool("pandoc", settings.pandocPath),
						detectTool("xelatex", settings.latexPath),
					]);
					if (generation !== this.generation) return;
					await Promise.all([
						this.showStatus(statuses.pandocPath, results[0], "pandoc", generation),
						this.showStatus(statuses.latexPath, results[1], "xelatex", generation),
					]);
				} catch {
					if (generation === this.generation) {
						for (const element of Object.values(statuses)) element.setText("Vérification impossible.");
						message.setText("La vérification a échoué. Vérifiez l’accès aux réglages et aux programmes, puis réessayez.");
					}
				} finally {
					if (generation === this.generation) button.setDisabled(false).setButtonText("Enregistrer et vérifier");
				}
			};
			button.setButtonText("Enregistrer et vérifier").setCta().onClick(() => check(true));
			void check(false);
		});
	}

	hide(): void {
		this.generation++;
	}

	private displayProjects(): void {
		new Setting(this.containerEl).setName("Projets").setHeading();
		const project = new Setting(this.containerEl).setName("Projet de livre")
			.setDesc("Choisissez un dossier pour définir un livre, sa présentation et ses polices. Un projet existant peut être modifié.");
		const error = project.descEl.createDiv({ attr: { role: "status", "aria-live": "polite" } });
		project.addButton(button => button.setButtonText("Créer/Ouvrir projet").setCta().onClick(async () => {
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

	private displayOutputDirectory(): void {
		new Setting(this.containerEl).setName("Génération").setHeading();
		const setting = new Setting(this.containerEl).setName("Dossier de génération")
			.setDesc("Par défaut : même dossier que le fichier Markdown source.");
		const input = new TextComponent(setting.controlEl).setPlaceholder("Dossier du Markdown source")
			.setValue(this.plugin.settings.outputDirectory);
		input.inputEl.readOnly = true;
		input.inputEl.setAttribute("aria-label", "Dossier de génération");
		const browse = new ButtonComponent(setting.controlEl).setButtonText("Parcourir…");
		const reset = new ExtraButtonComponent(setting.controlEl).setIcon("rotate-ccw")
			.setTooltip("Utiliser le dossier du Markdown source").setDisabled(!this.plugin.settings.outputDirectory);
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
		element.empty();
		element.createDiv({ text: status.state === "found" ? `Détecté · ${status.version}` : status.message });
		if (status.path) element.createDiv({ text: status.path, cls: "bookbinder-tool-path" });
		const update = element.createDiv({ text: "Recherche de la version en ligne…" });
		const result = await checkUpdate(tool, status, async url => {
			const response = await requestUrl({ url, throw: false });
			if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
			return response.text;
		});
		if (generation !== this.generation) return;
		update.setText(result.message);
		if (result.url && result.action) element.createEl("a", { text: result.action, href: result.url,
			attr: { target: "_blank", rel: "noopener noreferrer" } });
	}
}
