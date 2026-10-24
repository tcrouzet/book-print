import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { evaluateInChrome } from "./browser-check.mjs";

const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const directory = await mkdtemp(path.join(tmpdir(), "book-print-epub-"));
await build({
	stdin: { contents: 'export * from "./plugin/project.ts"; export * from "./plugin/epub.ts"; export * from "./plugin/tools.ts"; export { resources } from "./scripts/resources.ts";', resolveDir: root },
	bundle: true, platform: "node", format: "cjs", outfile: path.join(directory, "core.cjs"),
	loader: { ".lua": "text", ".latex": "text", ".css": "text" },
});
const { parseProject, exportEpub, detectTool, resources } = createRequire(import.meta.url)(path.join(directory, "core.cjs"));
const pandoc = await detectTool("pandoc");
assert.equal(pandoc.state, "found", "Pandoc doit être installé pour le contrôle EPUB.");
const browser = await build({ entryPoints: [path.join(root, "plugin/cover.ts")], bundle: true, format: "iife", globalName: "BookCover", write: false });
const options = { title: "L’expérience\\nhumaine", author: "Thierry Crouzet", subtitle: "Un sous-titre", footer: "1k signes - 24/10/2026" };
async function renderInBrowser(options) {
	const expression = `${browser.outputFiles[0].text}
	(async () => {
	    const bytes = await BookCover.renderCover(${JSON.stringify(options)});
	    const image = new Image();
	    image.src = URL.createObjectURL(new Blob([bytes], {type:"image/jpeg"}));
	    await image.decode();
	    const canvas = document.createElement("canvas"); canvas.width=1600; canvas.height=2400;
	    const context = canvas.getContext("2d"); context.drawImage(image,0,0);
	    const pixels = context.getImageData(0,0,1600,2400).data;
	    let red = 0; for(let i=0;i<pixels.length;i+=4) if(pixels[i]>120 && pixels[i+1]<80 && pixels[i+2]<80) red++;
	    const pixel = color => { const c=document.createElement("canvas"); c.width=8;c.height=8;const ctx=c.getContext("2d");ctx.fillStyle=color;ctx.fillRect(0,0,8,8);return c.toDataURL("image/png").split(",")[1]; };
	    let binary=""; for(const byte of bytes) binary+=String.fromCharCode(byte);
	    const result = {width:image.width,height:image.height,red,jpeg:btoa(binary),redImage:pixel("red"),blueImage:pixel("blue")};
	    const background = await BookCover.renderCover({...${JSON.stringify(options)}, background:"data:image/png;base64,"+(${JSON.stringify(Boolean(options.background))}?result.redImage:result.blueImage)});
	    if(background.length===bytes.length && background.every((byte,index)=>byte===bytes[index])) throw new Error("Image de fond ignorée");
	    URL.revokeObjectURL(image.src);
	    return result;
	})();`;
	return evaluateInChrome(expression, directory);
}
const rendered = await renderInBrowser(options);
assert.equal(rendered.width, 1600);
assert.equal(rendered.height, 2400);
assert.ok(rendered.red > 1000, "Le titre rouge doit apparaître sur la couverture.");
const jpeg = Buffer.from(rendered.jpeg, "base64");
await writeFile(path.join(directory, "cover.jpg"), jpeg);
for (const [name, image] of [["partie A", rendered.redImage], ["partie B", rendered.blueImage]]) {
	await mkdir(path.join(directory, name));
	await writeFile(path.join(directory, name, "image avec espaces.png"), Buffer.from(image, "base64"));
}
const sources = [
	{ path: path.join(directory, "partie A/01.md"), content: "---\ntitle: Ne doit pas remplacer le YAML\n---\n## Première\n\nA&B < C. «\u00a0Bonjour\u00a0» Est-ce vrai\u00a0? Fin\u202f!\n\nUne note[^1], rappel[^1].\n\n![Rouge](<image avec espaces.png>)\n\n[^1]: Note *première*.\n\n<!-- privé -->\n%% confidentiel %%\n\n```\nÀ droite *italique*\n```\n" },
	{ path: path.join(directory, "partie B/02.md"), content: "## Deuxième\n\nAutre note[^1].\n\n![Bleu](image%20avec%20espaces.png)\n\n[^1]: Note **deuxième**.\n    Suite de la note.\n\n€€Poème un\n\nPoème deux€€\n" },
];
sources.push({ path: path.join(directory, "book-print.md"), content: "---\ntitle: Projet\n---\nPROJET_A_EXCLURE\n[Modifier le projet](obsidian://book-print)\n" });
sources.push({ path: path.join(directory, "partie A/book-print.md"), content: "PROJET_IMBRIQUE_A_EXCLURE\n" });
sources[0].content += "\n<!-- ![[image absente.png]] -->\n%% ![[autre image absente.png]] %%\n\n![[image avec espaces.png]]\n";
sources[0].content += "\n[Capitales]{.smallcaps} H~2~O m^2^ ~~barré~~.\n\n```{.tab}\n\tLigne tabulée *littérale*\n```\n\n> Une citation Markdown.\n";
const project = parseProject({ title: options.title, author: options.author, identifier: "ISBN-0", epub: { style: { "font-size": "1.1em" } } }, "Sans effet");
const output = path.join(directory, "Livre avec espaces.epub");
let generatedCover;
const request = { project, sources, directory, output, pandoc: pandoc.path, resources, resolveImage: (target, sourcePath) => {
	assert.equal(target, "image avec espaces.png", "Les images des commentaires doivent être ignorées");
	return path.join(path.dirname(sourcePath), target);
}, renderCover: async options => {
	assert.match(options.footer, /^\d+k signes - \d{2}\/\d{2}\/\d{4}$/);
	const result = await renderInBrowser(options);
	generatedCover = Buffer.from(result.jpeg, "base64");
	return generatedCover;
} };
await exportEpub(request);
await exec("/usr/bin/unzip", ["-t", output]);
const entries = (await exec("/usr/bin/unzip", ["-Z1", output])).stdout.trim().split("\n");
const texts = [];
for (const name of entries.filter(name => /\.(xhtml|opf|ncx)$/.test(name))) {
	const text = (await exec("/usr/bin/unzip", ["-p", output, name])).stdout;
	const filename = path.join(directory, path.basename(name));
	await writeFile(filename, text);
	await exec("/usr/bin/xmllint", ["--noout", "--nonet", filename]);
	texts.push(text);
}
const content = texts.join("\n");
assert.match(content, /L’expérience humaine/);
assert.match(content, /ISBN-0/);
assert.match(content, /Note <em>première<\/em>/);
assert.match(content, /Note <strong>deuxième<\/strong>/);
assert.match(content, /Suite de la note/);
assert.match(content, /class="tab"/);
assert.match(content, /class="thin-space-before">\?<\/span>/);
assert.match(content, /Fin<span class="thin-space-before">!<\/span>/);
assert.doesNotMatch(content, /class="poem-top"|class="poem-bottom"/);
assert.match(content, /€€Poème un/);
assert.match(content, /class="smallcaps"/);
assert.match(content, /H<sub>2<\/sub>O/);
assert.match(content, /m<sup>2<\/sup>/);
assert.match(content, /<del>barré<\/del>/);
assert.match(content, /À droite \*italique\*/);
assert.match(content, /Ligne tabulée \*littérale\*/);
assert.match(content, /<blockquote/);
assert.doesNotMatch(content, /privé|confidentiel|Ne doit pas remplacer/);
assert.doesNotMatch(content, /PROJET_A_EXCLURE|PROJET_IMBRIQUE_A_EXCLURE|obsidian:\/\/book-print/);
const coverItem = content.match(/<item\s[^>]*properties="cover-image"[^>]*>/)?.[0];
const coverName = coverItem?.match(/href="([^"]+)"/)?.[1];
assert.ok(coverName, "Couverture déclarée dans le manifeste EPUB");
const embeddedCover = await exec("/usr/bin/unzip", ["-p", output, `EPUB/${coverName}`], { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 });
assert.deepEqual(embeddedCover.stdout, generatedCover, "Le JPEG produit est intégré à l’identique");
const embeddedImages = new Set();
for (const name of entries.filter(name => /media\/.*\.png$/.test(name))) {
	const image = await exec("/usr/bin/unzip", ["-p", output, name], { encoding: "buffer" });
	embeddedImages.add(image.stdout.toString("base64"));
}
assert.deepEqual(embeddedImages, new Set([rendered.redImage, rendered.blueImage]), "Les deux images homonymes restent distinctes, y compris via les liens Obsidian");
const before = await readFile(output);
await assert.rejects(exportEpub({ ...request, sources: [sources[2]] }), /Aucun fichier Markdown/);
assert.deepEqual(await readFile(output), before, "Une note de projet seule conserve le dernier EPUB");
await assert.rejects(exportEpub({ ...request, sources: [{ path: sources[0].path, content: "![Manquante](absente.png)" }] }), /absente|resource|image/i);
assert.deepEqual(await readFile(output), before, "Un échec conserve le dernier EPUB");
assert.ok(!(await readdir(directory)).some(name => name.startsWith(".book-print-")), "Ressources temporaires nettoyées");
assert.ok(!(await readdir(directory, { recursive: true })).some(name => name.endsWith(".md")), "Aucun Markdown intermédiaire");
await exportEpub({ ...request, project: parseProject({ cover: "cover.jpg" }, "Fichier seul"), sources: [sources[0]], output: path.join(directory, "Fichier seul.epub"), renderCover: async () => { throw new Error("La couverture fournie doit être utilisée"); } });
await exportEpub({ ...request, project: parseProject(undefined, "Sans YAML"), sources: [sources[0]], output: path.join(directory, "Sans YAML.epub") });
await writeFile(path.join(directory, "fond.SVG"), '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="2400"><rect width="1600" height="2400" fill="blue"/></svg>');
await exportEpub({ ...request, project: parseProject({ "cover-background": "fond.SVG" }, "Fond vectoriel"), sources: [sources[0]], output: path.join(directory, "Fond vectoriel.epub"), renderCover: async options => {
	assert.match(options.background, /^data:image\/svg\+xml;base64,/);
	return request.renderCover(options);
} });
console.log("EPUB réel : couverture Canvas 1600×2400, fusion en mémoire, projets exclus, images relatives, notes locales, XHTML valide et conservation du dernier export : OK.");
console.log(`Résultats : ${directory}`);
