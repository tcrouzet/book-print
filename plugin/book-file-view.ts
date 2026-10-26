import { t } from "./i18n.ts";
import { shell } from "electron";
import { ButtonComponent, FileSystemAdapter, FileView, type TFile, type WorkspaceLeaf } from "obsidian";

// Obsidian conserve cet identifiant dans les onglets déjà ouverts.
export const EPUB_VIEW = "bookbinder-epub";
export const DOCX_VIEW = "bookbinder-docx";

export class BookFileView extends FileView {
	constructor(leaf: WorkspaceLeaf, private format: "epub" | "docx") { super(leaf); }
	getViewType(): string { return this.format === "docx" ? DOCX_VIEW : EPUB_VIEW; }
	getIcon(): string { return this.format === "docx" ? "file-text" : "book-open"; }

	async onLoadFile(file: TFile): Promise<void> {
		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: file.basename });
		const error = this.contentEl.createDiv({ attr: { role: "alert" } });
		new ButtonComponent(this.contentEl).setButtonText(t(this.format === "docx" ? "openDocx" : "readEpub")).setCta().onClick(async () => {
			try {
				const adapter = this.app.vault.adapter;
				if (!(adapter instanceof FileSystemAdapter)) throw new Error(t("readingRequiresObsidianOnDesktop"));
				const message = await shell.openPath(adapter.getFullPath(file.path));
				if (message) throw new Error(t(this.format === "docx" ? "couldNotOpenDocxError" : "couldNotOpenEpubError", { error: message }));
			} catch (cause) { error.setText(cause instanceof Error ? cause.message : String(cause)); }
		});
	}
}
