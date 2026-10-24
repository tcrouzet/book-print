import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { loadFont, readProjectFile, saveProjectFile } from "../plugin/project-files.ts";
import { fontFamily, projectCss } from "../plugin/presentation.ts";
import { parseProject } from "../plugin/project.ts";

const directory = await mkdtemp(path.join(tmpdir(), "book-print-project-"));
assert.equal(await readProjectFile(directory), undefined);
const source = path.join(directory, "font.otf");
await writeFile(source, "invalid font");
await assert.rejects(loadFont(source), /illisible/);
await assert.rejects(loadFont(path.join(directory, "font.js")), /OTF/);
const font = { name: "test.ttf", data: new Uint8Array([1, 2, 3]) };
const data = { title: "Un projet", epub: { fonts: ["fonts/test.ttf"] }, custom: { preserved: true } };
const initial = JSON.stringify(data);
await saveProjectFile(directory, initial, undefined, [font]);
let saved = (await readProjectFile(directory))!;
assert.equal(saved.name, "book-print.md");
assert.equal(saved.yaml.trimEnd(), initial);
assert.match(saved.content, /^---\n/);
assert.match(saved.body, /\[Modifier le projet\]\(obsidian:\/\/book-print\)/);
assert.deepEqual(await readFile(path.join(directory, "fonts/test.ttf")), Buffer.from(font.data));
await assert.rejects(saveProjectFile(directory, "wrong", undefined, []), /modifié/);
assert.deepEqual(await readProjectFile(directory), saved);
await assert.rejects(saveProjectFile(directory, "wrong", saved, [{ ...font, data: new Uint8Array([4]) }]), /déjà/);
assert.deepEqual(await readFile(path.join(directory, "fonts/test.ttf")), Buffer.from(font.data));
const updated = JSON.stringify({ ...data, title: "Titre modifié" });
await saveProjectFile(directory, updated, saved, [font]);
saved = (await readProjectFile(directory))!;
assert.equal(JSON.parse(saved.yaml).custom.preserved, true);
assert.equal(JSON.parse(saved.yaml).title, "Titre modifié");
const body = saved.body + "\n## Notes personnelles\n\nCe texte reste modifiable.\n---\n";
await writeFile(path.join(directory, "book-print.md"), `\uFEFF---\r\n${updated}\r\n---\r\n${body}`);
const handwritten = (await readProjectFile(directory))!;
assert.equal(handwritten.body, body);
await assert.rejects(saveProjectFile(directory, initial, saved, []), /modifié/);
await saveProjectFile(directory, initial, handwritten, []);
assert.equal((await readProjectFile(directory))!.body, body);
const beforeBodyEdit = (await readProjectFile(directory))!;
await writeFile(path.join(directory, "book-print.md"), beforeBodyEdit.content + "Autre modification\n");
await assert.rejects(saveProjectFile(directory, updated, beforeBodyEdit, []), /modifié/);
const legacy = path.join(directory, "legacy"); await mkdir(legacy);
await writeFile(path.join(legacy, "book-print.yml"), initial);
const legacyFile = (await readProjectFile(legacy))!;
assert.equal(legacyFile.name, "book-print.yml");
await saveProjectFile(legacy, updated, legacyFile, []);
assert.equal(await readFile(path.join(legacy, "book-print.yml"), "utf8"), initial);
assert.equal((await readProjectFile(legacy))!.name, "book-print.md");
assert.equal(JSON.parse((await readProjectFile(legacy))!.yaml).title, "Titre modifié");
assert.match((await readProjectFile(legacy))!.body, /obsidian:\/\/book-print/);
await assert.rejects(saveProjectFile(legacy, initial, legacyFile, []), /modifié/);
const malformed = path.join(directory, "malformed"); await mkdir(malformed);
await writeFile(path.join(malformed, "book-print.yml"), initial);
for (const content of ["# Sans propriétés\n", "---\ntitle: Sans fin\n", "Texte avant\n---\ntitle: Caché\n---\n"]) {
	await writeFile(path.join(malformed, "book-print.md"), content);
	await assert.rejects(readProjectFile(malformed), /doit commencer/);
}
await writeFile(path.join(malformed, "book-print.md"), "---\n---\nTexte seul\n");
assert.equal((await readProjectFile(malformed))!.yaml, "");
assert.equal((await readProjectFile(malformed))!.body, "Texte seul\n");
for (const newline of ["\n", "\r\n"]) {
	for (const prefix of ["", "\uFEFF"]) {
		for (const text of ["", "## Notes\n\n---\nLien [projet](obsidian://book-print)\n", "Été 漢字 \u202eRTL\u202c\n```yaml\ntitle: Faux titre\n```\n"]) {
			const properties = ["title: Un livre", "description: |", "  ---", "  Texte"].join(newline) + newline;
			await writeFile(path.join(malformed, "book-print.md"), prefix + "---" + newline + properties + "---" + newline + text);
			const parsed = (await readProjectFile(malformed))!;
			assert.equal(parsed.yaml, properties);
			assert.equal(parsed.body, text);
		}
	}
}
const blocked = path.join(directory, "blocked"); await mkdir(blocked); await mkdir(path.join(blocked, "fonts"));
await mkdir(path.join(blocked, "book-print.md"));
await assert.rejects(saveProjectFile(blocked, "new", undefined, [font]));
assert.equal((await readdir(blocked)).some(name => name.startsWith(".book-print-project-")), false);
assert.ok(!(await readdir(directory)).some(name => name.startsWith(".book-print-project-")));
const project = parseProject({ epub: { fonts: ["fonts/L’étrange font.ttf"], style: { "font-family": fontFamily("L’étrange font.ttf") } } }, "Livre");
const css = projectCss(project);
assert.match(css, /@font-face/);
assert.ok(css.includes(encodeURIComponent("L’étrange font.ttf")));
assert.ok(css.includes(`font-family:${fontFamily("L’étrange font.ttf")}`));
assert.notEqual(fontFamily("a-b.ttf"), fontFamily("ab.ttf"));
const paragraphs = projectCss(parseProject({ epub: { style: { "margin-top": "12pt", "text-indent": "10pt" } } }, "Livre"));
assert.doesNotMatch(paragraphs.match(/body\{[^}]*\}/)![0], /margin-top|text-indent/);
assert.match(paragraphs, /p\{margin-top:12pt;text-indent:10pt\}/);
console.log("Projets Markdown : propriétés éditables, lien, texte conservé, conflits, migration YAML et polices : OK.");
