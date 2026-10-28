import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { downloadModels, isModelName, listModels, modelCatalogUrl, parseModel, readModel } from "../plugin/project-models.ts";
import { parseProject } from "../plugin/project.ts";
import { projectFrontmatter, projectYaml, readProjectFile, saveProjectFile } from "../plugin/project-files.ts";
import { parseSettings } from "../plugin/types.ts";
import { setLocale } from "../plugin/i18n.ts";

setLocale("fr");
const directory = await mkdtemp(path.join(tmpdir(), "bookbinder-models-")), models = path.join(directory, "models");
const data = { title: "Ancien titre", author: "Ancien auteur", rights: "Anciens droits", filename: "ancien-export", lang: "fr", colophon: "Conservé", fusion: { noteSeparator: "---" },
	pdf: { page: { "paper-size": "a5" }, headings: { h3: { "font-size": "body" } } }, docx: { style: { "line-height": "13.3pt" } }, epub: { styles: { "p.tab": { "text-align": "right" } } } };
const content = "---\n" + JSON.stringify(data) + "\n---\nTexte du modèle.\n";
const snapshot = structuredClone(data), model = parseModel(content, "base.md", JSON.parse);
assert.deepEqual(data, snapshot);
assert.equal(model.title, ""); assert.equal(model.author, ""); assert.equal(model.rights, ""); assert.equal(model.filename, undefined);
for (const field of ["lang", "colophon", "fusion", "pdf", "docx", "epub"]) assert.deepEqual(model[field], data[field as keyof typeof data], "Models preserve project formatting: " + field);
for (const format of ["epub", "pdf", "docx"] as const) assert.equal(parseProject(model, "Nouveau livre", format).metadata.title, "Nouveau livre", "Implicit exports derive their title from the current source");
assert.deepEqual(await listModels(models), []);
assert.deepEqual(await readModel(models, "base.md", JSON.parse, content), model, "The included base works offline without a models directory");
await assert.rejects(readModel(models, "missing.md", JSON.parse, content), /missing\.md/, "Missing additional models must not silently use the base");
assert.equal(parseSettings({ projectModel: "" }).projectModel, "base.md", "Existing settings without a model adopt the included base");
for (const name of ["../base.md", "/base.md", "base.js", "README.md", "a/b.md", "a\\b.md"]) {
	assert.equal(isModelName(name), false); assert.equal(parseSettings({ projectModel: name }).projectModel, "base.md");
	await assert.rejects(readModel(models, name, JSON.parse));
}
assert.equal(parseSettings({ projectModel: "base.md" }).projectModel, "base.md");
assert.throws(() => parseModel("Texte sans propriétés", "base.md", JSON.parse), /base\.md/);
assert.throws(() => parseModel("---\n[]\n---\n", "base.md", JSON.parse));
assert.throws(() => parseModel("---\n" + JSON.stringify({ docx: { style: { forbidden: "bad" } } }) + "\n---\n", "base.md", JSON.parse), /docx/);
const catalog = [{ type: "file", name: "base.md", path: "models/base.md", download_url: "https://example.org/ignored" }];
const requested: string[] = [];
const request = async (url: string) => { requested.push(url); return { status: 200, text: url === modelCatalogUrl ? JSON.stringify(catalog) : content }; };
await downloadModels(models, request, JSON.parse);
assert.deepEqual(await listModels(models), ["base.md"]);
assert.equal(requested[1], "https://raw.githubusercontent.com/tcrouzet/bookbinder/main/models/base.md", "Only the official repository supplies model files");
assert.deepEqual(await readModel(models, "base.md", JSON.parse), model);
await downloadModels(models, request, JSON.parse);
await writeFile(path.join(models, "notes.txt"), "Other data"); await mkdir(path.join(models, "directory.md"));
assert.deepEqual(await listModels(models), ["base.md"]);
const modified = content.replace("Ancien titre", "Modifié localement"); await writeFile(path.join(models, "base.md"), modified);
await assert.rejects(downloadModels(models, request, JSON.parse), /conservé/);
assert.equal(await readFile(path.join(models, "base.md"), "utf8"), modified);
assert.deepEqual(await readModel(models, "base.md", JSON.parse, content), model, "The base follows the current build even when an older download exists");
await assert.rejects(downloadModels(models, async () => ({ status: 503, text: "" }), JSON.parse), /503/);
assert.equal(await readFile(path.join(models, "base.md"), "utf8"), modified, "Network failures preserve local models");
const untouched = path.join(directory, "untouched");
for (const listing of [[{ type: "file", name: "../escape.md", path: "models/../escape.md" }], [catalog[0], catalog[0]], [], { message: "bad" }]) {
	await assert.rejects(downloadModels(untouched, async () => ({ status: 200, text: JSON.stringify(listing) }), JSON.parse));
}
await assert.rejects(downloadModels(untouched, async url => ({ status: 200, text: url === modelCatalogUrl ? JSON.stringify([catalog[0], { type: "file", name: "broken.md", path: "models/broken.md" }]) : url.endsWith("broken.md") ? "broken" : content }), JSON.parse));
assert.deepEqual(await listModels(untouched), [], "Validate the complete download before adding models");
const project = path.join(directory, "new-project"); await mkdir(project);
await saveProjectFile(project, projectYaml({ ...model, title: "Nouveau titre", author: "Auteur" }, JSON.stringify), undefined);
const original = (await readProjectFile(project))!;
const restored = JSON.parse(original.yaml) as Record<string, unknown>;
for (const format of ["pdf", "docx", "epub"]) assert.deepEqual(restored[format], model[format]);
await assert.rejects(saveProjectFile(project, "wrong", undefined), /modifié/);
assert.deepEqual(await readProjectFile(project), original, "Existing projects cannot be replaced by a model");
const base = await readFile(new URL("../models/base.md", import.meta.url), "utf8");
const properties = projectFrontmatter(base, "base.md").yaml;
for (const field of ["title", "author", "rights"]) assert.match(properties, new RegExp('^' + field + ': ""$', "m"));
for (const format of ["pdf", "docx", "epub"]) assert.match(properties, new RegExp("^" + format + ":$", "m"));
console.log("Modèles : identités vides, réglages conservés, téléchargement GitHub, conflits et projets existants préservés : OK.");
