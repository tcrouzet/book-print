import { App, ButtonComponent, Modal, Setting } from "obsidian";
import { chooseFiles } from "./dialogs.ts";
import { fontFamily } from "./presentation.ts";
import { bundledFontType, fontTypes, fontTypeLabel, type FontType } from "./font-catalog.ts";
import { readFontLibrary, saveLibraryFont } from "./font-library.ts";
import { loadFont, type ImportedFont } from "./project-files.ts";
import { detectFontType } from "./font-metadata.ts";
import { t } from "./i18n.ts";

export async function importFonts(app: App, directory: string): Promise<void> {
	const files = await chooseFiles(t("chooseFonts"), ["otf", "ttf", "woff", "woff2"], true);
	if (!files.length) return;
	const fonts = await Promise.all(files.map(loadFont));
	const known = await readFontLibrary(directory);
	const types = new Map(known.map(font => [font.reference.slice("library:".length), font.type] as const));
	for (const font of fonts) types.set(font.name, types.get(font.name) ?? detectFontType(font.data) ?? bundledFontType(font.name));
	const save = async () => {
		for (const font of fonts) {
			try { await new FontFace(fontFamily(font.name), new Uint8Array(font.data).buffer).load(); }
			catch { throw new Error(t("theFontFontCouldNotBeLoadedChooseAValidFontFile", { font: font.name })); }
		}
		for (const font of fonts) await saveLibraryFont(directory, font, types.get(font.name));
	};
	const unknown = fonts.filter(font => !types.get(font.name));
	if (!unknown.length) { await save(); return; }
	await new Promise<void>(resolve => new FontImportModal(app, unknown, types, save, resolve).open());
}

class FontImportModal extends Modal {
	private busy = false;
	constructor(app: App, private fonts: ImportedFont[], private types: Map<string, FontType | undefined>,
		private save: () => Promise<void>, private finished: () => void) { super(app); }

	onOpen(): void {
		this.modalEl.addClass("bookbinder-font-import-modal");
		this.setTitle(t("importFonts"));
		this.contentEl.createEl("p", { text: t("chooseFontTypes") });
		const types = this.types;
		const error = this.contentEl.createDiv({ attr: { role: "alert" } });
		let save: ButtonComponent;
		const refresh = () => save?.setDisabled(this.fonts.some(font => !types.get(font.name)));
		for (const font of this.fonts) {
			new Setting(this.contentEl).setName(font.name).addDropdown(input => {
				input.addOption("", t("chooseFontType"));
				for (const type of fontTypes) input.addOption(type, fontTypeLabel(type));
				input.setValue(types.get(font.name) ?? "").onChange(value => { types.set(font.name, value as FontType || undefined); refresh(); });
				input.selectEl.setAttribute("aria-label", font.name);
			});
		}
		const actions = new Setting(this.contentEl);
		actions.addButton(button => button.setButtonText(t("cancel")).onClick(() => this.close()));
		actions.addButton(button => {
			save = button.setButtonText(t("importFonts")).setCta().onClick(async () => {
				this.busy = true; error.empty();
				const controls = this.contentEl.querySelectorAll<HTMLButtonElement | HTMLSelectElement>("button,select");
				for (const control of controls) control.disabled = true;
				try {
					for (const font of this.fonts) {
						if (!types.get(font.name)) throw new Error(t("chooseFontType"));
					}
					await this.save();
					this.busy = false; this.close();
				} catch (cause) { error.setText(cause instanceof Error ? cause.message : String(cause)); }
				finally { this.busy = false; for (const control of controls) control.disabled = false; refresh(); }
			});
		});
		refresh();
	}

	close(): void { if (!this.busy) super.close(); }
	onClose(): void { this.finished(); this.contentEl.empty(); }
}
