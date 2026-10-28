import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import ts from "typescript";
import { readModel } from "../plugin/project-models.ts";
import { projectYaml, readProjectFile, saveProjectFile } from "../plugin/project-files.ts";
import { excluded, isProjectNote, parseProject } from "../plugin/project.ts";
import { DEFAULT_SETTINGS } from "../plugin/types.ts";
import { setLocale, t } from "../plugin/i18n.ts";
import { compareVersions } from "../plugin/tools.ts";

setLocale("en");
const root = await mkdtemp(path.join(tmpdir(), "bookbinder-auto-project-"));
const source = ts.createSourceFile("main.ts", await readFile(new URL("../plugin/main.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const plugin = source.statements.find(ts.isClassDeclaration);
const method = name => ts.transpileModule(plugin.members.find(node => node.name?.getText(source) === name).getText(source).replace(/^async /, "async function "), { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const model = { title: "", author: "", rights: "", pdf: { headings: { h3: { "font-size": "body" } } }, docx: { style: { "font-size": "12pt" } }, epub: { style: { "text-indent": "1em" } } };
const baseModel = "---\n" + JSON.stringify(model) + "\n---\n";
const defaultProjectData = new Function("readModel", "parseYaml", "baseModel", method("defaultProjectData") + "return defaultProjectData;")(readModel, JSON.parse, baseModel);
class TFolder {
	constructor(name) { this.name = this.path = name; this.children = []; }
	isRoot() { return false; }
}
class TFile {
	constructor(name, parent) { this.path = parent.path + "/" + name; this.basename = path.basename(name, ".md"); this.extension = "md"; this.parent = parent; parent.children.push(this); }
}
class FileSystemAdapter {
	getFullPath(relative) { return path.join(root, relative); }
}
const notices = [], exports = [];
class Notice {
	messageEl = { classList: { add() {} }, setAttribute() {} };
	constructor(message) { notices.push(message); }
	setMessage() {}
	hide() {}
}
const generateBook = new Function("FileSystemAdapter", "TFolder", "TFile", "Notice", "t", "path", "readProjectFile", "parseYaml", "parseProject", "projectYaml", "stringifyYaml", "saveProjectFile", "excluded", "isProjectNote", "detectTool", "compareVersions", "resources", "renderCover", "confirmOverwrite", "exportPdf", "exportDocx", "exportEpub", method("generateBook") + "return generateBook;")(
	FileSystemAdapter, TFolder, TFile, Notice, t, path, readProjectFile, JSON.parse, parseProject, projectYaml, JSON.stringify, saveProjectFile, excluded, isProjectNote,
	async tool => ({ state: "found", version: "3.9", path: tool }), compareVersions, {}, () => {}, () => {},
	...(["pdf", "docx", "epub"].map(format => async request => { exports.push({ format, request }); return request.output; })),
);
for (const format of ["pdf", "docx", "epub"]) for (const kind of ["file", "folder"]) {
	const folder = new TFolder(format + "-" + kind), file = new TFile("Chapter.md", folder);
	const directory = path.join(root, folder.path); await mkdir(directory);
	await writeFile(path.join(root, file.path), "# Heading\n\nManuscript.\n");
	const context = { settings: { ...DEFAULT_SETTINGS }, modelDirectory: path.join(root, "models"), defaultProjectData, app: { vault: { adapter: new FileSystemAdapter(), async read(file) { return await readFile(path.join(root, file.path), "utf8"); } } } };
	const input = kind === "folder" ? folder : file;
	await generateBook.call(context, input, format);
	assert.equal(exports.length, 1, notices.join("\n"));
	const generated = exports.pop();
	assert.equal(generated.format, format);
	assert.equal(generated.request.sources.length, 1);
	assert.equal(generated.request.sources[0].content, "# Heading\n\nManuscript.\n");
	let saved = await readProjectFile(directory);
	assert.ok(saved, "Book to creates bookbinder.md before exporting " + format);
	const data = JSON.parse(saved.yaml);
	assert.equal(data.title, kind === "folder" ? folder.name : file.basename);
	for (const section of ["pdf", "docx", "epub"]) assert.deepEqual(data[section], model[section], "All format settings remain editable in the project");
	assert.match(saved.body, /obsidian:\/\/bookbinder/);
	await saveProjectFile(directory, projectYaml({ ...data, title: "My edited book", author: "My author" }, JSON.stringify), saved);
	saved = await readProjectFile(directory);
	new TFile("bookbinder.md", folder);
	context.settings.projectModel = "missing.md";
	await generateBook.call(context, input, format);
	assert.equal(exports.length, 1, notices.join("\n"));
	assert.equal(exports.pop().request.project.metadata.title, "My edited book");
	assert.deepEqual(await readProjectFile(directory), saved, "An existing project is preserved even if the selected model is missing");
}
assert.equal(exports.length, 0);
console.log("Book to: PDF, Docx and ePub create a project from the included base for files and folders; existing projects and manuscript contents are preserved: OK.");
