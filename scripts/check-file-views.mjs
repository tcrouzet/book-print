import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import ts from "typescript";
import { isProjectNote } from "../plugin/project-view.ts";

const root = path.resolve(import.meta.dirname, ".."), directory = await mkdtemp(path.join(tmpdir(), "bookbinder-file-views-"));
await build({
	stdin: { contents: 'export * from "./plugin/book-file-view.ts"; export * from "./plugin/i18n.ts"; export { shell } from "electron"; export { FileSystemAdapter } from "obsidian";', resolveDir: root },
	bundle: true, platform: "node", format: "cjs", outfile: path.join(directory, "views.cjs"),
	plugins: [{ name: "desktop-stubs", setup(build) {
		build.onResolve({ filter: /^(obsidian|electron)$/ }, args => ({ path: args.path, namespace: "desktop-stubs" }));
		build.onLoad({ filter: /.*/, namespace: "desktop-stubs" }, args => ({ contents: args.path === "electron"
			? 'export const shell = { opened: [], error: "", async openPath(filename) { this.opened.push(filename); return this.error; } };'
			: `export class FileView { constructor(leaf) { Object.assign(this, leaf); } }
			   export class FileSystemAdapter { getFullPath(filename) { return "/vault/" + filename; } }
			   export class ButtonComponent {
			     constructor(container) { this.button = {}; container.buttons.push(this.button); }
			     setButtonText(text) { this.button.text = text; return this; }
			     setCta() { return this; }
			     onClick(callback) { this.button.click = callback; return this; }
			   }` }));
	} }],
});
const { BookFileView, EPUB_VIEW, DOCX_VIEW, FileSystemAdapter, shell, setLocale, t } = createRequire(import.meta.url)(path.join(directory, "views.cjs"));
const source = ts.createSourceFile("main.ts", await readFile(path.join(root, "plugin/main.ts"), "utf8"), ts.ScriptTarget.Latest, true);
const plugin = source.statements.find(ts.isClassDeclaration), onload = plugin.members.find(node => node.name?.getText(source) === "onload");
const registration = onload.body.statements.find(node => ts.isForOfStatement(node) && node.initializer.declarations?.[0].name.getText(source) === "format");
const commandRegistration = onload.body.statements.find(node => ts.isForOfStatement(node) && node.statement.getText(source).includes("this.addCommand("));
assert.ok(commandRegistration, "Exports are available in the command palette independently of other plugins");
const registerCommands = new Function("TFile", "isProjectNote", ts.transpileModule(commandRegistration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText);
class TFile { constructor(name, extension = "md") { this.path = name; this.extension = extension; } }
const commands = new Map(), foreign = { id: "export-to-docx" }, calls = [];
commands.set("docx-exporter:export-to-docx", foreign);
let active = new TFile("Book/chapter.md");
registerCommands.call({ addCommand(command) { commands.set("bookbinder:" + command.id, command); }, app: { workspace: { getActiveFile() { return active; } } }, generateBook(file, format) { calls.push({ file, format }); } }, TFile, isProjectNote);
assert.equal(commands.get("docx-exporter:export-to-docx"), foreign, "Other plugins keep their own export command");
commands.delete("docx-exporter:export-to-docx");
for (const format of ["pdf", "docx", "epub"]) {
	const command = commands.get("bookbinder:book-to-" + format); assert.ok(command);
	assert.equal(command.checkCallback(true), true);
	assert.equal(calls.length, 0, "Checking command availability does not start an export");
	assert.equal(command.checkCallback(false), true);
	assert.deepEqual(calls.pop(), { file: active, format }, "The active note exports without DOCX Exporter enabled");
	for (const invalid of [undefined, new TFile("Book/bookbinder.md"), new TFile("Book/book.docx", "docx")]) {
		const previous = active; active = invalid; assert.equal(command.checkCallback(true), false); active = previous;
	}
}
assert.ok(registration, "The plugin registers its exported file formats on load");
const register = new Function("BookFileView", "EPUB_VIEW", "DOCX_VIEW", "t", "console", ts.transpileModule(registration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText);
for (const occupied of [false, true]) {
	const views = new Map(), associations = new Map(), messages = [];
	register.call({ registerView: (name, factory) => views.set(name, factory), registerExtensions: (extensions, view) => { if (occupied && extensions.includes("epub")) throw new Error("Already registered"); for (const extension of extensions) associations.set(extension, view); } }, BookFileView, EPUB_VIEW, DOCX_VIEW, t, { debug: (...args) => messages.push(args) });
	assert.equal(associations.get("docx"), DOCX_VIEW, "DOCX becomes a recognized file type even when another plugin owns EPUB");
	assert.equal(associations.has("epub"), !occupied); assert.equal(messages.length, occupied ? 1 : 0);
	assert.equal(views.get(DOCX_VIEW)({}).getViewType(), DOCX_VIEW);
	assert.equal(views.get(EPUB_VIEW)({}).getViewType(), "bookbinder-epub", "Existing EPUB tab identifiers stay valid");
}
for (const language of ["fr", "en"]) for (const format of ["epub", "docx"]) {
	setLocale(language);
	const contentEl = { children: [], buttons: [], empty() { this.children = []; this.buttons = []; }, createEl(tag, config) { this.children.push({ tag, ...config }); }, createDiv() { const error = { text: "", setText(text) { this.text = text; } }; this.children.push(error); return error; } };
	const leaf = { contentEl, app: { vault: { adapter: new FileSystemAdapter() } } }, view = new BookFileView(leaf, format);
	await view.onLoadFile({ basename: "Mon livre", path: "Livres/Mon livre." + format });
	assert.equal(contentEl.children[0].text, "Mon livre");
	assert.equal(contentEl.buttons[0].text, t(format === "docx" ? "openDocx" : "readEpub"));
	shell.error = ""; await contentEl.buttons[0].click();
	assert.equal(shell.opened.at(-1), "/vault/Livres/Mon livre." + format);
	shell.error = "Application unavailable"; await contentEl.buttons[0].click();
	assert.equal(contentEl.children[1].text, t(format === "docx" ? "couldNotOpenDocxError" : "couldNotOpenEpubError", { error: shell.error }));
	const opened = shell.opened.length; leaf.app.vault.adapter = {}; await contentEl.buttons[0].click();
	assert.equal(shell.opened.length, opened); assert.equal(contentEl.children[1].text, t("readingRequiresObsidianOnDesktop"));
}
console.log("EPUB/DOCX views: extension registration, association conflicts, bilingual opening controls and errors: OK.");
