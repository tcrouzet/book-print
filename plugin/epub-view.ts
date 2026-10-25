import { t } from "./i18n.ts";
import { shell } from "electron";
import { ButtonComponent, FileSystemAdapter, FileView, type TFile } from "obsidian";

// Obsidian conserve cet identifiant dans les onglets déjà ouverts.
export const EPUB_VIEW = "bookbinder-epub";

export class EpubView extends FileView {
	getViewType(): string { return EPUB_VIEW; }
	getIcon(): string { return "book-open"; }

	async onLoadFile(file: TFile): Promise<void> {
		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: file.basename });
		const error = this.contentEl.createDiv({ attr: { role: "alert" } });
		new ButtonComponent(this.contentEl).setButtonText(t("readEpub")).setCta().onClick(async () => {
			try {
				const adapter = this.app.vault.adapter;
				if (!(adapter instanceof FileSystemAdapter)) throw new Error(t("readingRequiresObsidianOnDesktop"));
				const message = await shell.openPath(adapter.getFullPath(file.path));
				if (message) throw new Error(t("couldNotOpenEpubError", { error: message }));
			} catch (cause) { error.setText(cause instanceof Error ? cause.message : String(cause)); }
		});
	}
}
