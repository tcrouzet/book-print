import { ButtonComponent, FileSystemAdapter, FileView, type TFile } from "obsidian";

export const EPUB_VIEW = "book-print-epub";

export class EpubView extends FileView {
	getViewType(): string { return EPUB_VIEW; }
	getIcon(): string { return "book-open"; }

	async onLoadFile(file: TFile): Promise<void> {
		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: file.basename });
		const error = this.contentEl.createDiv({ attr: { role: "alert" } });
		new ButtonComponent(this.contentEl).setButtonText("Lire l’EPUB").setCta().onClick(async () => {
			try {
				const adapter = this.app.vault.adapter;
				if (!(adapter instanceof FileSystemAdapter)) throw new Error("La lecture nécessite Obsidian sur ordinateur.");
				const { shell } = require("electron") as { shell: { openPath(filename: string): Promise<string> } };
				const message = await shell.openPath(adapter.getFullPath(file.path));
				if (message) throw new Error(`Impossible d’ouvrir l’EPUB : ${message}`);
			} catch (cause) { error.setText(cause instanceof Error ? cause.message : String(cause)); }
		});
	}
}
