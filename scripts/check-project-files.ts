import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { loadFont, projectYaml, readProjectFile, saveProjectFile } from "../plugin/project-files.ts";
import { fontFamily, projectCss } from "../plugin/presentation.ts";
import { parseProject } from "../plugin/project.ts";
import { cloneProjectFile } from "../plugin/project-clone.ts";
import { setLocale } from "../plugin/i18n.ts";
import { listFontLibrary, readFontLibrary, resolveFont, saveLibraryFont } from "../plugin/font-library.ts";
import "./check-font-package.ts";

setLocale("fr");

const root = await mkdtemp(path.join(tmpdir(), "bookbinder-project-"));
const directory = path.join(root, "project"); await mkdir(directory);
const fontDirectory = path.join(root, "plugin", "data", "_fonts");
const interleaved = { epub: { style: {} }, title: "Un livre", fusion: { noteSeparator: "page" }, pdf: {}, author: ["Auteur"], docx: {}, rights: "Droits", custom: { preserved: true } };
const ordered = JSON.parse(projectYaml(interleaved, JSON.stringify)) as typeof interleaved;
assert.deepEqual(Object.keys(ordered), ["title", "author", "rights", "custom", "fusion", "pdf", "docx", "epub"]);
assert.deepEqual(ordered, interleaved);
assert.equal(Object.keys(interleaved)[0], "epub", "Le tri ne modifie pas les données de l’éditeur");
assert.deepEqual(Object.keys(JSON.parse(projectYaml({ title: "Sans sections" }, JSON.stringify))), ["title"]);
assert.equal(await readProjectFile(directory), undefined);
const source = path.join(directory, "font.otf");
await writeFile(source, "invalid font");
await assert.rejects(loadFont(source), /illisible/);
await assert.rejects(loadFont(path.join(directory, "font.js")), /OTF/);
await assert.rejects(loadFont(path.join(directory, "missing.otf")), /missing\.otf.*Bookbinder/);
const font = { name: "test.ttf", data: new Uint8Array([0, 1, 0, 0, 1]) };
assert.deepEqual(await listFontLibrary(fontDirectory), []);
const reference = await saveLibraryFont(fontDirectory, font);
assert.equal(reference, "library:test.ttf");
assert.deepEqual(await readFontLibrary(fontDirectory), [{ reference, type: undefined }], "Font files without a type can be inspected before classification");
await saveLibraryFont(fontDirectory, font, "sans-serif");
assert.deepEqual(await readFontLibrary(fontDirectory), [{ reference, type: "sans-serif" }]);
await saveLibraryFont(fontDirectory, font, "serif");
assert.deepEqual(await readFontLibrary(fontDirectory), [{ reference, type: "serif" }], "Reimporting can correct a personal font classification");
await assert.rejects(saveLibraryFont(fontDirectory, { ...font, data: new Uint8Array([4]) }, "symbol"), /déjà/);
assert.deepEqual(await readFontLibrary(fontDirectory), [{ reference, type: "serif" }], "A font conflict preserves its classification");
await assert.rejects(saveLibraryFont(fontDirectory, font, "script" as "serif"), /invalide/);
await writeFile(path.join(fontDirectory, "test.ttf.type.json"), JSON.stringify("script"));
await assert.rejects(readFontLibrary(fontDirectory), /invalide/);
await saveLibraryFont(fontDirectory, font, "serif");
assert.equal(resolveFont(directory, reference, fontDirectory), path.join(fontDirectory, "test.ttf"));
assert.equal(resolveFont(directory, "fonts/external.ttf", fontDirectory), path.join(directory, "fonts/external.ttf"));
assert.throws(() => resolveFont(directory, reference), /bibliothèque/);
assert.throws(() => resolveFont(directory, "library:../escape.ttf", fontDirectory), /invalide/);
await assert.rejects(saveLibraryFont(fontDirectory, { ...font, name: "../escape.ttf" }), /invalide/);
await assert.rejects(saveLibraryFont(fontDirectory, { ...font, name: "font.js" }), /OTF/);
assert.deepEqual(await Promise.all([saveLibraryFont(fontDirectory, font), saveLibraryFont(fontDirectory, font)]), [reference, reference]);
await writeFile(path.join(fontDirectory, "notes.txt"), "Not a font");
assert.deepEqual(await listFontLibrary(fontDirectory), [reference]);
assert.equal((await readdir(fontDirectory)).some(name => name.startsWith(".bookbinder-font-")), false);
const data = { title: "Un projet", epub: { fonts: [reference], toc: true, "toc-depth": 6 }, pdf: { toc: false, "toc-depth": 1, "title-page": { copyright: true, "character-count": false }, headings: { h2: { "page-break-before": "left" } } }, docx: { toc: true, "toc-depth": 3, "title-page": { copyright: false, "character-count": true }, headings: { h2: { "page-break-before": "right" } } }, custom: { preserved: true } };
const initial = JSON.stringify(data);
await saveProjectFile(directory, initial, undefined);
let saved = (await readProjectFile(directory))!;
assert.equal(saved.name, "bookbinder.md");
assert.equal(saved.yaml.trimEnd(), initial);
assert.match(saved.content, /^---\n/);
assert.match(saved.body, /\[Modifier le projet\]\(obsidian:\/\/bookbinder\)/);
for (const format of ["pdf", "docx", "epub"] as const) {
	const restored = parseProject(JSON.parse(saved.yaml), "Livre", format);
	assert.equal(restored.toc, data[format].toc); assert.equal(restored.tocDepth, data[format]["toc-depth"], "Saving and reopening retains each format’s table of contents settings");
	if (format !== "epub") assert.deepEqual(restored.titlePage, { copyright: data[format]["title-page"].copyright, characterCount: data[format]["title-page"]["character-count"] }, "Title page options survive saving independently per format");
	if (format !== "epub") assert.equal(restored.headings.h2["page-break-before"], data[format].headings.h2["page-break-before"], "Heading page parity survives saving and reopening");
}
assert.deepEqual(await readFile(resolveFont(directory, reference, fontDirectory)), Buffer.from(font.data));
await assert.rejects(readdir(path.join(directory, "fonts")), /ENOENT/);
await assert.rejects(saveProjectFile(directory, "wrong", undefined), /modifié/);
assert.deepEqual(await readProjectFile(directory), saved);
await assert.rejects(saveLibraryFont(fontDirectory, { ...font, data: new Uint8Array([4]) }), /déjà/);
assert.deepEqual(await readFile(resolveFont(directory, reference, fontDirectory)), Buffer.from(font.data));
const updated = JSON.stringify({ ...data, title: "Titre modifié" });
await saveProjectFile(directory, updated, saved);
saved = (await readProjectFile(directory))!;
assert.equal(JSON.parse(saved.yaml).custom.preserved, true);
assert.equal(JSON.parse(saved.yaml).title, "Titre modifié");
const body = saved.body + "\n## Notes personnelles\n\nCe texte reste modifiable.\n---\n";
await writeFile(path.join(directory, "bookbinder.md"), `\uFEFF---\r\n${updated}\r\n---\r\n${body}`);
const handwritten = (await readProjectFile(directory))!;
assert.equal(handwritten.body, body);
await assert.rejects(saveProjectFile(directory, initial, saved), /modifié/);
await saveProjectFile(directory, initial, handwritten);
assert.equal((await readProjectFile(directory))!.body, body);
const beforeBodyEdit = (await readProjectFile(directory))!;
await writeFile(path.join(directory, "bookbinder.md"), beforeBodyEdit.content + "Autre modification\n");
await assert.rejects(saveProjectFile(directory, updated, beforeBodyEdit), /modifié/);
const unsupported = path.join(directory, "unsupported"); await mkdir(unsupported);
for (const name of ["book-print.md", "book-print.yml"]) {
 await writeFile(path.join(unsupported, name), initial);
 await assert.rejects(cloneProjectFile(path.join(unsupported, name), path.join(directory, "unused-clone"), JSON.parse, JSON.stringify), /bookbinder\.md/);
}
assert.equal(await readProjectFile(unsupported), undefined, "Only bookbinder.md is a project file");
await saveProjectFile(unsupported, updated, undefined);
const currentProject = await readProjectFile(unsupported);
assert.ok(currentProject);
assert.equal(JSON.parse(currentProject.yaml).title, "Titre modifié");
for (const name of ["book-print.md", "book-print.yml"]) assert.equal(await readFile(path.join(unsupported, name), "utf8"), initial, "Unsupported notes are not converted or overwritten");
const malformed = path.join(directory, "malformed"); await mkdir(malformed);
await writeFile(path.join(malformed, "book-print.yml"), initial);
for (const content of ["# Sans propriétés\n", "---\ntitle: Sans fin\n", "Texte avant\n---\ntitle: Caché\n---\n"]) {
	await writeFile(path.join(malformed, "bookbinder.md"), content);
	await assert.rejects(readProjectFile(malformed), /doit commencer/);
}
await writeFile(path.join(malformed, "bookbinder.md"), "---\n---\nTexte seul\n");
assert.equal((await readProjectFile(malformed))!.yaml, "");
assert.equal((await readProjectFile(malformed))!.body, "Texte seul\n");
for (const newline of ["\n", "\r\n"]) {
	for (const prefix of ["", "\uFEFF"]) {
		for (const text of ["", "## Notes\n\n---\nLien [projet](obsidian://bookbinder)\n", "Été 漢字 \u202eRTL\u202c\n```yaml\ntitle: Faux titre\n```\n"]) {
			const properties = ["title: Un livre", "description: |", "  ---", "  Texte"].join(newline) + newline;
			await writeFile(path.join(malformed, "bookbinder.md"), prefix + "---" + newline + properties + "---" + newline + text);
			const parsed = (await readProjectFile(malformed))!;
			assert.equal(parsed.yaml, properties);
			assert.equal(parsed.body, text);
		}
	}
}
const blocked = path.join(directory, "blocked"); await mkdir(blocked); await mkdir(path.join(blocked, "fonts"));
await mkdir(path.join(blocked, "bookbinder.md"));
await assert.rejects(saveProjectFile(blocked, "new", undefined));
assert.deepEqual(await readFile(resolveFont(directory, reference, fontDirectory)), Buffer.from(font.data), "Un échec de sauvegarde ne retire pas une police de la bibliothèque");
assert.equal((await readdir(blocked)).some(name => name.startsWith(".bookbinder-project-")), false);
assert.ok(!(await readdir(directory)).some(name => name.startsWith(".bookbinder-project-")));
const project = parseProject({ epub: { fonts: ["fonts/L’étrange font.ttf"], style: { "font-family": fontFamily("L’étrange font.ttf") } } }, "Livre");
const css = projectCss(project);
assert.match(css, /@font-face/);
assert.ok(css.includes(encodeURIComponent("L’étrange font.ttf")));
assert.ok(css.includes(`font-family:${fontFamily("L’étrange font.ttf")}`));
assert.notEqual(fontFamily("a-b.ttf"), fontFamily("ab.ttf"));
assert.equal(fontFamily("a.ttf"), "BookPrint-61-2e-74-74-66");
assert.equal(fontFamily("library:a.ttf"), fontFamily("fonts/a.ttf"));
const paragraphs = projectCss(parseProject({ epub: { style: { "margin-top": "12pt", "text-indent": "10pt" } } }, "Livre"));
assert.doesNotMatch(paragraphs.match(/body\{[^}]*\}/)![0], /margin-top|text-indent/);
assert.match(paragraphs, /p\{margin-top:12pt;text-indent:10pt\}/);
const cloneSource = path.join(directory, "clone-source"); await mkdir(cloneSource);
const cloneTarget = path.join(directory, "clone-target"); await mkdir(cloneTarget);
const cloneData = { title: "L’été 漢字", author: ["Auteur"], filename: "livre-clone", cover: "images/cover.jpg", "cover-background": "../background.jpg",
	epub: { css: ["css/base.css"], fonts: [source, reference], "disabled-rules": ["quote"], style: { color: "#123456" } },
	pdf: { fonts: ["fonts/pdf.ttf"], page: { "margin-top": "20mm", "page-mode": "double", "margin-inner": "24mm", "margin-outer": "14mm", "binding-offset": "7mm" } }, docx: { css: "docx.css" }, custom: { preserved: true } };
const cloneBody = "\n[Modifier le projet](obsidian://bookbinder)\n\n## Notes personnelles\nÉté 漢字\n";
const cloneContent = `---\n${JSON.stringify(cloneData)}\n---\n${cloneBody}`;
const cloneFilename = path.join(cloneSource, "bookbinder.md");
await writeFile(cloneFilename, cloneContent);
await writeFile(path.join(cloneSource, "chapitre.md"), "Ce chapitre reste dans le projet source.");
await cloneProjectFile(cloneFilename, cloneTarget, JSON.parse, JSON.stringify);
const cloned = (await readProjectFile(cloneTarget))!;
const clonedData = JSON.parse(cloned.yaml) as typeof cloneData;
assert.deepEqual(Object.keys(clonedData).slice(-3), ["pdf", "docx", "epub"], "Les sections techniques suivent toutes les propriétés du livre");
assert.equal(cloned.body, cloneBody);
assert.deepEqual(clonedData, { ...cloneData, cover: path.join(cloneSource, "images/cover.jpg"), "cover-background": path.join(directory, "background.jpg"),
	epub: { ...cloneData.epub, css: [path.join(cloneSource, "css/base.css")] },
	pdf: { ...cloneData.pdf, fonts: [path.join(cloneSource, "fonts/pdf.ttf")] }, docx: { css: path.join(cloneSource, "docx.css") } });
assert.deepEqual(await readdir(cloneTarget), ["bookbinder.md"]);
assert.equal(await readFile(cloneFilename, "utf8"), cloneContent);
await assert.rejects(cloneProjectFile(cloneFilename, cloneTarget, JSON.parse, JSON.stringify), /contient déjà/);
await assert.rejects(cloneProjectFile(cloneFilename, cloneSource, JSON.parse, JSON.stringify), /contient déjà/);
assert.deepEqual(await readProjectFile(cloneTarget), cloned);
await assert.rejects(cloneProjectFile(path.join(cloneSource, "chapitre.md"), cloneTarget, JSON.parse, JSON.stringify), /Choisissez un fichier/);
const failedClone = path.join(directory, "failed-clone"); await mkdir(failedClone);
await writeFile(cloneFilename, "---\nnot valid JSON\n---\n");
await assert.rejects(cloneProjectFile(cloneFilename, failedClone, JSON.parse, JSON.stringify));
assert.deepEqual(await readdir(failedClone), []);
console.log("Projets Markdown : propriétés éditables, lien, texte conservé, conflits, format courant et polices : OK.");
