import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { mock } from "node:test";
import { build } from "esbuild";
import { evaluateInChrome } from "./browser-check.mjs";

const exec = promisify(execFile);
process.env.TZ = "UTC";
mock.timers.enable({ apis: ["Date"], now: Date.UTC(2025, 0, 2, 12) });
const root = path.resolve(import.meta.dirname, "..");
const directory = await mkdtemp(path.join(tmpdir(), "bookbinder-epub-"));
await build({
	stdin: { contents: 'export * from "./plugin/i18n.ts"; export * from "./plugin/project.ts"; export * from "./plugin/epub.ts"; export * from "./plugin/tools.ts"; export { ruleDefinitions } from "./plugin/book-styles.ts"; export { resources } from "./scripts/resources.ts";', resolveDir: root },
	bundle: true, platform: "node", format: "cjs", outfile: path.join(directory, "core.cjs"),
	loader: { ".lua": "text", ".latex": "text", ".css": "text" },
});
const { setLocale, parseProject, prepareMarkdown, exportEpub, detectTool, resources, ruleDefinitions } = createRequire(import.meta.url)(path.join(directory, "core.cjs"));
setLocale("fr");
const pandoc = await detectTool("pandoc");
assert.equal(pandoc.state, "found", "Pandoc doit être installé pour le contrôle EPUB.");
const generalRulesContent = [
	"*EMPREMIER* *EMSECOND* **GRAS** ~~BARRE~~ [CAPITALES]{.smallcaps} H~DEUX~ m^CARRE^ `CODEINLINE` [LIEN](https://example.org) ![IMAGE](cover.jpg)[^1]",
	"### PREMIERH3", "### SECONDH3", "#### TITREH4", "##### TITREH5", "###### TITREH6", "### ENCOREH3", "## PARENTH2", "### APRESH2", "# PARENTH1", "### APRESH1",
	"> CITATION", "```{.tab}\nTABULATION\n```", "```\nCODEBLOC\n```", "- ELEMENTUN\n- ELEMENTDEUX", "1. NUMERO", "| ENTETE |\n|---|\n| CELLULE |", "---", "[^1]: NOTECONTEXTUELLE",
].join("\n\n");
const generalInput = { sources: [{ directory, content: generalRulesContent }], ruleDefinitions, colophon: "COLOPHON", colophonCredit: "CREDIT" };
const readRules = disabledRules => JSON.parse(execFileSync(pandoc.path, ["--from=" + path.join(root, "scripts/lua/book-reader.lua"), "--to=json"], { input: JSON.stringify({ ...generalInput, disabledRules }), encoding: "utf8" }));
const generalAst = readRules([]), markedKinds = new Set(), markerCounts = new Map();
const collectMarkers = value => {
	if (!Array.isArray(value) && (!value || typeof value !== "object")) return;
	if (Array.isArray(value) && value.length === 3 && typeof value[0] === "string" && Array.isArray(value[1])) {
		for (const name of value[1]) if (typeof name === "string") { markedKinds.add(name); markerCounts.set(name, (markerCounts.get(name) ?? 0) + 1); }
	}
	for (const child of Object.values(value)) collectMarkers(child);
};
collectMarkers(generalAst);
for (const rule of ruleDefinitions.filter(rule => rule.marker && rule.kind !== "title")) assert.ok(markedKinds.has(rule.marker), "Le lecteur marque la première occurrence de " + rule.kind);
for (const rule of ruleDefinitions.filter(rule => rule.scope === "book" && rule.kind !== "title")) assert.equal(markerCounts.get(rule.marker), 1, "One book-wide occurrence across all headings: " + rule.kind);
const h3s = generalAst.blocks.filter(block => block.t === "Header" && block.c[0] === 3);
assert.deepEqual(h3s.map(block => block.c[1][1].includes("bookbinder-rule-h3")), [true, false, false, true, true], "H3 : première occurrence et après H1/H2, sans réinitialisation par H3/H4/H5/H6");
const disabledAst = readRules(["h3", "em", "table"]);
markedKinds.clear(); collectMarkers(disabledAst);
for (const kind of ["h3", "em", "table"]) {
	assert.ok(!markedKinds.has("bookbinder-rule-" + kind), "Pas de règle après titre pour " + kind);
	assert.ok(!markedKinds.has("bookbinder-first-" + kind), "Pas de règle dans le livre pour " + kind);
}
assert.ok(markedKinds.has("bookbinder-rule-strong"), "Les autres styles gardent leurs règles");
const repeatedSources = [
	{ path: path.join(directory, "P1", "chapitre.md"), content: "# Partie\n\n## Août\n\nP1_AOUT\n\n[Retour](#août)\n\n### Août\n\nSuite.\n\n## Été {#fixe}\n\n[Été](#fixe)" },
	{ path: path.join(directory, "P2", "chapitre.md"), content: "# Partie\n\n## Août\n\nP2_AOUT\n\n[Retour](#ao%C3%BBt)\n\n[Ancre réservée]{#août-2}\n\n## Été {#fixe}\n\n[Été](#fixe)" },
];
const repeatedAst = JSON.parse(execFileSync(pandoc.path, ["--from=" + path.join(root, "scripts/lua/book-reader.lua"), "--to=json"], {
	input: JSON.stringify({ sources: repeatedSources.map(source => ({ directory: path.dirname(source.path), content: source.content })) }), encoding: "utf8",
}));
const headingIds = repeatedAst.blocks.filter(block => block.t === "Header").map(block => block.c[1][0]);
assert.equal(new Set(headingIds).size, headingIds.length, "Les titres de parties et de chapitres répétés ont des identifiants uniques après fusion");
const tabExample = "## Un titre\n\n> Une citation.\n\n\t*Un ouvrage*, Auteur\n\n```{.tab}\nUne ligne\t**en gras**\n```\n\n```\n\t*Code littéral*\n```\n";
const tabExampleHtml = execFileSync(pandoc.path, ["--from=" + path.join(root, "scripts/lua/book-reader.lua"), "--lua-filter=" + path.join(root, "scripts/lua/epub-tab.lua"), "--to=html5", "--wrap=none"], {
	input: JSON.stringify({ sources: [{ directory, content: tabExample }] }), encoding: "utf8",
});
assert.match(tabExampleHtml, /<p class="tab"><em>Un ouvrage<\/em>, Auteur<\/p>/, "Une tabulation initiale applique le style Tabulation et conserve les italiques");
assert.match(tabExampleHtml, /<p class="tab">Une ligne\t<strong>en gras<\/strong><\/p>/, "Markdown et tabulations dans un bloc .tab");
assert.match(tabExampleHtml, /<pre><code>[\s\S]*\*Code littéral\*[\s\S]*<\/code><\/pre>/, "Un bloc de code explicite reste littéral");
const tabRuleHtml = execFileSync(pandoc.path, ["--from=" + path.join(root, "scripts/lua/book-reader.lua"), "--lua-filter=" + path.join(root, "scripts/lua/epub-tab.lua"), "--to=html5", "--wrap=none"], {
	input: JSON.stringify({ sources: [{ directory, content: "```{.tab}\n*PREMIEREITALIQUE*\n```\n\n*ITALIQUESUIVANTE*" }], ruleDefinitions }), encoding: "utf8",
});
assert.match(tabRuleHtml, /<p class="tab"><span class="bookbinder-rule-em bookbinder-first-em"><em>PREMIEREITALIQUE<\/em><\/span><\/p>/, "Les styles à l’intérieur de Tabulation participent aux règles communes");
assert.match(tabRuleHtml, /<p><em>ITALIQUESUIVANTE<\/em><\/p>/, "Le style n’est pas consommé une seconde fois hors de Tabulation");
const headingInlineHtml = execFileSync(pandoc.path, ["--from=" + path.join(root, "scripts/lua/book-reader.lua"), "--to=html5", "--wrap=none"], {
	input: JSON.stringify({ sources: [{ directory, content: "*AVANT*\n\n## *DANSTITRE*\n\n*APRES*" }], ruleDefinitions }), encoding: "utf8",
});
assert.equal((headingInlineHtml.match(/class="bookbinder-rule-em(?: bookbinder-first-em)?"/g) ?? []).length, 2, "Les styles de caractères sont réinitialisés après le contenu du titre");
assert.match(headingInlineHtml, /<span class="bookbinder-rule-em"><em>APRES<\/em><\/span>/);
const pageSpacingHtml = execFileSync(pandoc.path, ["--from=" + path.join(root, "scripts/lua/book-reader.lua"), "--to=html5", "--wrap=none"], {
	input: JSON.stringify({ pageBreak: "always", sources: [{ directory, content: "FIRSTNOTE" }, { directory, content: "NEWPAGEONE\n\nNEWPAGETWO\n\nNEWPAGETHREE" }] }), encoding: "utf8",
});
assert.match(pageSpacingHtml, /class="bookbinder-note-start">\s*<p>NEWPAGEONE<\/p>/, "A new page keeps the first paragraph's top margin");
for (const marker of ["NEWPAGETWO", "NEWPAGETHREE"]) assert.match(pageSpacingHtml, new RegExp('class="bookbinder-continued-body">\\s*<p>' + marker + '</p>'), "Following paragraphs on the new page continue the same style");
for (const pageBreak of [undefined, "always"]) {
	const html = execFileSync(pandoc.path, ["--from=" + path.join(root, "scripts/lua/book-reader.lua"), "--to=html5", "--wrap=none"], { input: JSON.stringify({ pageBreak, sources: [
		{ directory, content: "> QUOTENOTEONE" }, { directory, content: "> QUOTENOTETWO\n\n> QUOTENOTETHREE\n\nBODYRESET\n\n> QUOTERESET" },
	] }), encoding: "utf8" });
	assert.equal(/class="bookbinder-continued-quote">\s*<p>QUOTENOTETWO<\/p>/.test(html), !pageBreak, "Adjacent quote paragraphs continue across notes unless a page break intervenes");
	assert.match(html, /class="bookbinder-continued-quote">\s*<p>QUOTENOTETHREE<\/p>/, "Separate quote blocks retain the same paragraph style");
	assert.doesNotMatch(html, /class="bookbinder-continued-quote">\s*<p>QUOTERESET<\/p>/, "Body text interrupts the quote sequence");
}
const browser = await build({ entryPoints: [path.join(root, "plugin/cover.ts")], bundle: true, format: "iife", globalName: "BookCover", write: false });
const options = { title: "L’expérience\\nhumaine", author: "Thierry Crouzet", subtitle: "Un sous-titre", footer: "1k signes - 24/10/2026" };
async function renderInBrowser(options) {
	const expression = `${browser.outputFiles[0].text}
	(async () => {
	    const makeEl = tag => document.createElement(tag);
	    const bytes = await BookCover.renderCover(${JSON.stringify(options)}, makeEl);
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
	    const background = await BookCover.renderCover({...${JSON.stringify(options)}, background:"data:image/png;base64,"+(${JSON.stringify(Boolean(options.background))}?result.redImage:result.blueImage)}, makeEl);
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
sources.push({ path: path.join(directory, "bookbinder.md"), content: "---\ntitle: Projet\n---\nPROJET_A_EXCLURE\n[Modifier le projet](obsidian://bookbinder)\n" });
sources.push({ path: path.join(directory, "partie A/bookbinder.md"), content: "PROJET_IMBRIQUE_A_EXCLURE\n" });
sources.push({ path: path.join(directory, "book-print.md"), content: "DOCUMENT_ORDINAIRE\n" });
sources[0].content += "\n<!-- ![[image absente.png]] -->\n%% ![[autre image absente.png]] %%\n\n![[image avec espaces.png]]\n";
sources[0].content += "\n[Capitales]{.smallcaps} H~2~O m^2^ ~~barré~~.\n\n```{.tab}\n\tLigne tabulée *littérale*\n```\n\n> Une citation Markdown.\n";
const project = parseProject({ title: options.title, author: options.author, identifier: "ISBN-0", date: "1900-01-01", colophon: "COL_PERSONNEL **Édition indépendante**.\n\nFin de fabrication.", epub: { style: { "font-size": "1.1em" },
	styles: { ".bookbinder-colophon p": { "font-size": "0.9em", "font-style": "italic", "text-align": "right", "margin-left": "0.5em", "text-indent": "0.75em" }, "h1.title": { "font-size": "2.25em", "page-position": "one-third" }, "p.tab": { "font-style": "italic", "font-size": "1.25em", "margin-left": "2em", "line-height": "1.5em", "text-align": "right" } },
	rules: { ".bookbinder-after-heading-tab + p.tab": { "text-align": "center" }, ".bookbinder-after-heading-tab + p.tab::first-letter": { "font-size": "2em" } },
} }, "Sans effet");
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
async function lastPage(filename) {
	const opf = (await exec("/usr/bin/unzip", ["-p", filename, "EPUB/content.opf"])).stdout;
	const id = Array.from(opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/g)).at(-1)?.[1];
	assert.ok(id, "Dernière page déclarée dans l’ordre de lecture");
	const item = Array.from(opf.matchAll(/<item\b[^>]*>/g), match => match[0]).find(item => item.includes(`id="${id}"`));
	const href = item?.match(/\bhref="([^"]+)"/)?.[1];
	assert.ok(href, "La dernière page est une ressource de l’ePub");
	return (await exec("/usr/bin/unzip", ["-p", filename, "EPUB/" + href])).stdout;
}
const colophon = await lastPage(output);
assert.match(colophon, /id="bookbinder-colophon"/);
assert.match(colophon, /COL_PERSONNEL <strong>Édition indépendante<\/strong>/);
assert.match(colophon, /Généré par <a href="https:\/\/community\.obsidian\.md\/plugins\/bookbinder">Bookbinder<\/a>/);
assert.match(colophon, /<div class="bookbinder-credit">\s*<p>Généré par[\s\S]*le 02\/01\/2025\.<\/p>\s*<\/div>/);
assert.match(colophon, /<h1\b[^>]*>Colophon<\/h1>/, "Le titre technique fournit le libellé du sommaire ; son masquage est vérifié au rendu");
assert.doesNotMatch(colophon, /1900/, "Le crédit utilise la date de génération, pas celle de publication");
assert.equal((colophon.match(/community\.obsidian\.md\/plugins\/bookbinder/g) ?? []).length, 1);
assert.doesNotMatch(colophon, /Note <em>première|Note <strong>deuxième/);
const navigation = (await exec("/usr/bin/unzip", ["-p", output, "EPUB/nav.xhtml"])).stdout;
assert.match(navigation, /<a\b[^>]*>Colophon<\/a>/, "Le sommaire contient un lien Colophon");
async function colophonNavigation(filename) {
	const nav = (await exec("/usr/bin/unzip", ["-p", filename, "EPUB/nav.xhtml"])).stdout;
	const links = Array.from(nav.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>Colophon<\/a>/g), match => match[1]);
	assert.ok(links.length, "Une entrée Colophon est présente dans le sommaire");
	const target = new URL(links.at(-1), "https://book.test/EPUB/nav.xhtml");
	const page = (await exec("/usr/bin/unzip", ["-p", filename, decodeURIComponent(target.pathname.slice(1))])).stdout;
	assert.equal(page, await lastPage(filename), "Le lien Colophon ouvre la dernière page de l’ordre de lecture");
	if (target.hash) assert.ok(page.includes(`id="${decodeURIComponent(target.hash.slice(1))}"`), "L’ancre du lien Colophon existe sur la page finale");
	const ncx = (await exec("/usr/bin/unzip", ["-p", filename, "EPUB/toc.ncx"])).stdout;
	const ncxLinks = Array.from(ncx.matchAll(/<text>Colophon<\/text>[\s\S]*?<content\b[^>]*src="([^"]+)"/g), match => new URL(match[1], "https://book.test/EPUB/toc.ncx").href);
	assert.equal(ncxLinks.at(-1), target.href, "Le sommaire NCX ouvre le même colophon que la navigation EPUB");
	return links;
}
assert.equal((await colophonNavigation(output)).length, 1);
const repeatedOutput = path.join(directory, "Titres repetes.epub");
await exportEpub({ ...request, sources: [...repeatedSources, { path: path.join(directory, "colophon-existant.md"), content: "# Colophon {#bookbinder-colophon}\n\nUn chapitre du manuscrit." }], project: parseProject({ cover: "cover.jpg", epub: { "split-level": 1 } }, "Titres répétés"), output: repeatedOutput });
const repeatedColophons = await colophonNavigation(repeatedOutput);
assert.equal(repeatedColophons.length, 2, "Un chapitre nommé Colophon et la page finale gardent chacun leur entrée");
assert.equal(new Set(repeatedColophons).size, 2, "Un identifiant déjà employé ne détourne pas le lien du colophon final");
const repeatedNav = (await exec("/usr/bin/unzip", ["-p", repeatedOutput, "EPUB/nav.xhtml"])).stdout;
const navigationLinks = Array.from(repeatedNav.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g), match => ({ href: match[1], label: match[2] }));
for (const label of ["Partie", "Août", "Été"]) {
	const links = navigationLinks.filter(link => link.label === label);
	assert.equal(links.length, 2, "Chaque titre répété reste dans le sommaire : " + label);
	assert.equal(new Set(links.map(link => link.href)).size, 2, "Chaque entrée a sa propre destination : " + label);
	for (const [index, link] of links.entries()) {
		const target = new URL(link.href, "https://book.test/EPUB/nav.xhtml");
		const chapter = (await exec("/usr/bin/unzip", ["-p", repeatedOutput, target.pathname.slice(1)])).stdout;
		const ids = Array.from(chapter.matchAll(/\bid="([^"]+)"/g), match => match[1]);
		assert.equal(new Set(ids).size, ids.length, "Les ancres de la page restent uniques, y compris les spans");
		assert.ok(ids.includes(decodeURIComponent(target.hash.slice(1))), "La destination du sommaire existe");
		assert.ok(chapter.includes(`P${index + 1}_AOUT`), "Le sommaire ouvre la bonne partie");
		if (label === "Août") {
			const back = chapter.match(/<a\b[^>]*href="([^"]+)"[^>]*>Retour<\/a>/)?.[1];
			assert.ok(back, "Le lien interne est conservé");
			assert.equal(new URL(back, target).href, target.href, "Le lien interne vise le titre de sa propre note, même encodé");
		}
	}
}
const repeatedNcx = (await exec("/usr/bin/unzip", ["-p", repeatedOutput, "EPUB/toc.ncx"])).stdout;
const ncxTargets = Array.from(repeatedNcx.matchAll(/<text>Août<\/text>[\s\S]*?<content\b[^>]*src="([^"]+)"/g), match => new URL(match[1], "https://book.test/EPUB/toc.ncx").href);
assert.deepEqual(ncxTargets, navigationLinks.filter(link => link.label === "Août").map(link => new URL(link.href, "https://book.test/EPUB/nav.xhtml").href), "Les deux sommaires EPUB visent les mêmes chapitres");
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
assert.match(content, /Ligne tabulée <em>littérale<\/em>/);
assert.match(content, /<blockquote/);
assert.doesNotMatch(content, /privé|confidentiel|Ne doit pas remplacer/);
assert.doesNotMatch(content, /PROJET_A_EXCLURE|PROJET_IMBRIQUE_A_EXCLURE|obsidian:\/\/bookbinder/);
assert.match(content, /DOCUMENT_ORDINAIRE/, "Only the current project note is excluded automatically");
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
let tabCss = "";
for (const name of entries.filter(name => name.endsWith(".css"))) tabCss += (await exec("/usr/bin/unzip", ["-p", output, name])).stdout;
const colophonRendering = await evaluateInChrome(`(() => {
	const parsed = new DOMParser().parseFromString(${JSON.stringify(colophon)}, "application/xhtml+xml");
	document.body.replaceChildren(...Array.from(parsed.querySelector("body").childNodes, node => document.importNode(node, true)));
	const style = document.createElement("style"); style.textContent = ${JSON.stringify(tabCss)}; document.head.append(style);
	const boundary = document.querySelector("h1"), credit = document.querySelector(".bookbinder-credit"), link = credit.querySelector("a");
	const personal = getComputedStyle(document.querySelector(".bookbinder-colophon > p")), attribution = getComputedStyle(credit.querySelector("p"));
	return { hidden: getComputedStyle(boundary).display, gap: parseFloat(getComputedStyle(credit).marginTop), size: parseFloat(getComputedStyle(credit).fontSize), underline: getComputedStyle(link).textDecorationLine, align: attribution.textAlign, visible: credit.getBoundingClientRect().height > 0,
		personalAlign: personal.textAlign, personalStyle: personal.fontStyle, personalSize: parseFloat(personal.fontSize), bodySize: parseFloat(getComputedStyle(document.body).fontSize), attributionSize: parseFloat(attribution.fontSize), attributionIndent: attribution.textIndent, attributionMargin: attribution.marginLeft };
})()`, directory);
assert.equal(colophonRendering.hidden, "none", "Aucun titre ne s’affiche sur la page finale");
assert.equal(colophonRendering.align, "center", "Le crédit de génération est centré");
assert.equal(colophonRendering.personalAlign, "right");
assert.equal(colophonRendering.personalStyle, "italic");
assert.ok(Math.abs(colophonRendering.personalSize / colophonRendering.bodySize - 0.9) < 0.01, "La taille du style Colophon s’applique au texte de publication");
assert.ok(Math.abs(colophonRendering.attributionSize / colophonRendering.personalSize - 0.8) < 0.01, "Le crédit suit la typographie du colophon en restant plus petit");
assert.equal(colophonRendering.attributionIndent, "0px");
assert.equal(colophonRendering.attributionMargin, "0px");
assert.ok(colophonRendering.visible && colophonRendering.gap >= colophonRendering.size * 2.9, "Le crédit est nettement séparé et reste visible");
assert.ok(colophonRendering.underline.includes("underline"), "Le lien Bookbinder est souligné par défaut");
const tabRendering = await evaluateInChrome(`(() => {
	const parsed = new DOMParser().parseFromString(${JSON.stringify(texts.find(text => text.includes('<p class="tab">')))}, "application/xhtml+xml");
	document.body.replaceChildren(...Array.from(parsed.querySelector("body").childNodes, node => document.importNode(node, true)));
	const style = document.createElement("style"); style.textContent = ${JSON.stringify(tabCss)}; document.head.append(style);
	const tab = document.querySelector("p.tab"), computed = getComputedStyle(tab);
	return { italic: computed.fontStyle, size: parseFloat(computed.fontSize), margin: parseFloat(computed.marginLeft), line: parseFloat(computed.lineHeight), align: computed.textAlign, initial: parseFloat(getComputedStyle(tab, "::first-letter").fontSize) };
})()`, directory);
assert.equal(tabRendering.italic, "italic");
assert.equal(tabRendering.align, "center");
for (const [name, value] of [["size", 22], ["margin", 44], ["line", 33], ["initial", 44]]) assert.ok(Math.abs(tabRendering[name] - value) < 0.1, "Réglage Tabulation dans le XHTML réel : " + name);
const before = await readFile(output);
await assert.rejects(exportEpub({ ...request, sources: [sources[2]] }), /Aucun fichier Markdown/);
assert.deepEqual(await readFile(output), before, "Une note de projet seule conserve le dernier EPUB");
await assert.rejects(exportEpub({ ...request, sources: [{ path: sources[0].path, content: "![Manquante](absente.png)" }] }), /absente|resource|image/i);
assert.deepEqual(await readFile(output), before, "Un échec conserve le dernier EPUB");
assert.ok(!(await readdir(directory)).some(name => name.startsWith(".bookbinder-")), "Ressources temporaires nettoyées");
assert.ok(!(await readdir(directory, { recursive: true })).some(name => name.endsWith(".md")), "Aucun Markdown intermédiaire");
const collisionRequest = { ...request, project: { ...project, cover: "cover.jpg" } };
const versioned = await exportEpub({ ...collisionRequest, confirmOverwrite: async filename => { assert.equal(filename, output); return "version"; } });
assert.equal(versioned, path.join(directory, "Livre avec espaces-2.epub"));
await exec("/usr/bin/unzip", ["-t", versioned]);
assert.deepEqual(await readFile(output), before, "Créer une version conserve l’original");
assert.equal(await exportEpub({ ...collisionRequest, confirmOverwrite: async () => "cancel" }), undefined);
assert.deepEqual(await readFile(output), before, "Annuler conserve l’original");
assert.equal(await exportEpub({ ...collisionRequest, confirmOverwrite: async () => "replace" }), output);
await exec("/usr/bin/unzip", ["-t", output]);
await exportEpub({ ...request, project: parseProject({ cover: "cover.jpg" }, "Fichier seul"), sources: [sources[0]], output: path.join(directory, "Fichier seul.epub"), renderCover: async () => { throw new Error("La couverture fournie doit être utilisée"); } });
const defaultColophon = await lastPage(path.join(directory, "Fichier seul.epub"));
assert.match(defaultColophon, /id="bookbinder-colophon"/);
assert.match(defaultColophon, /Généré par <a href="https:\/\/community\.obsidian\.md\/plugins\/bookbinder">Bookbinder<\/a>/);
assert.doesNotMatch(defaultColophon, /COL_PERSONNEL/);
await colophonNavigation(path.join(directory, "Fichier seul.epub"));
const englishOutput = path.join(directory, "English.epub");
await exportEpub({ ...request, project: parseProject({ cover: "cover.jpg", lang: "en" }, "English book"), sources: [sources[0]], output: englishOutput });
const englishColophon = await lastPage(englishOutput);
assert.match(englishColophon, /Generated by <a href="https:\/\/community\.obsidian\.md\/plugins\/bookbinder">Bookbinder<\/a>/);
assert.match(englishColophon, /on 1\/2\/2025\./);
await colophonNavigation(englishOutput);
setLocale("en");
await exportEpub({ ...request, project: parseProject(undefined, "Sans YAML"), sources: [sources[0]], output: path.join(directory, "Sans YAML.epub") });
setLocale("fr");
await writeFile(path.join(directory, "fond.SVG"), '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="2400"><rect width="1600" height="2400" fill="blue"/></svg>');
await exportEpub({ ...request, project: parseProject({ "cover-background": "fond.SVG" }, "Fond vectoriel"), sources: [sources[0]], output: path.join(directory, "Fond vectoriel.epub"), renderCover: async options => {
	assert.match(options.background, /^data:image\/svg\+xml;base64,/);
	return request.renderCover(options);
} });
const separatorSources = [
	"%% Note vide %%", "PREMIERE_NOTE", "", "## NOTE_TITRE\n\nTexte du chapitre.", "NOTE_PARAGRAPHE", "```{.tab}\nNOTE_TAB\n```", "```\nNOTE_CODE\n```", "<!-- Note vide -->",
].map((content, index) => ({ path: path.join(directory, `note-${index}.md`), content }));
for (const [separator, legacy, modern] of [["", "", ""], ["page", "always", "page"], ["even", "left", "left"], ["odd", "right", "right"]]) {
	const ast = JSON.parse(execFileSync(pandoc.path, ["--from=" + path.join(root, "scripts/lua/book-reader.lua"), "--to=json"], {
		input: JSON.stringify({ pageBreak: legacy || undefined, sources: separatorSources.map(source => ({ directory, content: prepareMarkdown(source.content) })) }), encoding: "utf8",
	}));
	const boundaries = ast.blocks.filter(block => ["Header", "Div", "CodeBlock"].includes(block.t) && (block.t === "Header" ? block.c[1] : block.c[0])[1].includes("bookbinder-note-start"));
	assert.equal(boundaries.length, separator ? 4 : 0, "Une coupure entre les notes non vides, sans coupure avant la première");
	assert.equal(ast.blocks[0].t, "Div", "La première occurrence du texte courant reçoit son marqueur");
	assert.equal(ast.blocks[1].t, "Para");
	assert.equal(ast.blocks.at(-1).t, "CodeBlock", "Aucun séparateur final");
	const filename = path.join(directory, `Separateur-${separator || "vide"}.epub`);
	await exportEpub({ ...request, sources: [...separatorSources, ...sources.slice(2)], project: parseProject({ cover: "cover.jpg", fusion: { noteSeparator: separator } }, "Séparateurs"), output: filename });
	const files = (await exec("/usr/bin/unzip", ["-Z1", filename])).stdout.trim().split("\n");
	let html = "", css = "";
	for (const file of files.filter(file => /\.(xhtml|css)$/.test(file))) {
		const text = (await exec("/usr/bin/unzip", ["-p", filename, file])).stdout;
		if (file.endsWith(".css")) css += text;
		else {
			html += text;
			const xml = path.join(directory, "separator-check.xhtml"); await writeFile(xml, text);
			await exec("/usr/bin/xmllint", ["--noout", "--nonet", xml]);
		}
	}
	assert.doesNotMatch(html, /PROJET_A_EXCLURE|PROJET_IMBRIQUE_A_EXCLURE/);
	if (separator) {
		assert.ok(css.includes(`page-break-before:${legacy};break-before:${modern}`), "Coupure CSS correspondant au choix enregistré");
		assert.match(html, /<h[1-6][^>]*class="[^"]*bookbinder-note-start[^>]*>NOTE_TITRE/);
		assert.match(html, /<div class="bookbinder-note-start">\s*<p>NOTE_PARAGRAPHE/);
		assert.match(html, /<pre class="bookbinder-note-start"><code>NOTE_CODE/);
		assert.match(html, /<div class="bookbinder-note-start">\s*<div class="bookbinder-after-heading-tab">\s*<\/div>\s*<p class="tab">NOTE_TAB/);
	} else {
		assert.doesNotMatch(html + css, /bookbinder-note-start/);
	}
}
const customOutput = path.join(directory, "Separateur-personnalise.epub");
for (const separator of ["⁂ · ⁂", "***", '<img src=x onerror="alert(1)">', "\\\"{};", "", "א ب"]) {
	const ast = JSON.parse(execFileSync(pandoc.path, ["--from=" + path.join(root, "scripts/lua/book-reader.lua"), "--to=json"], {
		input: JSON.stringify({ separator, sources: [{ directory, content: "Avant.\n\n***\n\nAprès.\n\n---\n\nFin." }] }), encoding: "utf8",
	}));
	assert.ok(!ast.blocks.some(block => block.t === "HorizontalRule"));
	const ornaments = ast.blocks.filter(block => block.t === "Div" && block.c[0][1].includes("bookbinder-separator"));
	assert.equal(ornaments.length, 2, "Chaque rupture Markdown utilise le style Séparateur");
	for (const ornament of ornaments) assert.equal(ornament.c[1].flatMap(block => block.c).map(inline => inline.c).join(""), separator, "Les caractères restent du texte littéral, y compris le Markdown et le HTML");
}
await exportEpub({ ...request, sources: [separatorSources[1], separatorSources[4]], project: parseProject({ cover: "cover.jpg", fusion: { noteSeparator: "***" } }, "Séparateur existant"), output: customOutput });
const customEntries = (await exec("/usr/bin/unzip", ["-Z1", customOutput])).stdout.trim().split("\n");
let customHtml = "";
for (const file of customEntries.filter(file => file.endsWith(".xhtml"))) customHtml += (await exec("/usr/bin/unzip", ["-p", customOutput, file])).stdout;
assert.equal((customHtml.match(/<hr\b/g) ?? []).length, 1, "Le séparateur personnalisé reste lisible et n’est inséré qu’entre les notes");
const characterSeparator = "⁂ · ⁂";
const characterOutput = path.join(directory, "Separateur-caracteres.epub");
await exportEpub({ ...request, sources: [separatorSources[1], separatorSources[4]], project: parseProject({ cover: "cover.jpg", fusion: { noteSeparator: characterSeparator } }, "Caractères personnalisés"), output: characterOutput });
const characterEntries = (await exec("/usr/bin/unzip", ["-Z1", characterOutput])).stdout.trim().split("\n");
let characterHtml = "";
for (const file of characterEntries.filter(file => file.endsWith(".xhtml"))) characterHtml += (await exec("/usr/bin/unzip", ["-p", characterOutput, file])).stdout;
assert.equal(characterHtml.split(characterSeparator).length - 1, 1, "Les caractères saisis apparaissent une seule fois entre les notes");
assert.ok(characterHtml.indexOf("PREMIERE_NOTE") < characterHtml.indexOf(characterSeparator) && characterHtml.indexOf(characterSeparator) < characterHtml.indexOf("NOTE_PARAGRAPHE"), "Les caractères séparent les notes dans leur ordre de lecture");
const ruleSources = [{ path: path.join(directory, "avant.md"), content: "AVANTTITRE" }];
for (let level = 1; level <= 6; level++) ruleSources.push({ path: path.join(directory, `titre-${level}.md`), content: [
	"#".repeat(level) + " TITRE" + level,
	`> CITATION${level}PREMIERE\n>\n> CITATION${level}SUIVANTE`,
	"- Un élément de liste avant le texte courant.",
	"| Colonne |\n| --- |\n| Une cellule avant le texte courant. |",
	"![Une illustration](cover.jpg)",
	`CORPS${level}PREMIER[^1]`, `CORPS${level}SUIVANT[^2]`,
	"```{.tab}\nTAB" + level + "PREMIERE\n```", "```{.tab}\nTAB" + level + "SUIVANTE\n```",
	`[^1]: NOTE${level}PREMIERE\n\n[^2]: NOTE${level}SUIVANTE`,
].join("\n\n") });
const ruleOutput = path.join(directory, "Regles-par-style.epub");
await exportEpub({ ...request, sources: ruleSources, project: parseProject({ cover: "cover.jpg", epub: { rules: {
	".bookbinder-after-heading-body + p": { "text-indent": "0.5em" },
	".bookbinder-after-heading-body + p::first-letter": { "font-size": "2em" },
	"blockquote .bookbinder-after-heading-quote + p": { "font-style": "normal" },
	"blockquote .bookbinder-after-heading-quote + p::first-letter": { color: "red" },
} } }, "Règles par style"), output: ruleOutput });
const ruleFiles = (await exec("/usr/bin/unzip", ["-Z1", ruleOutput])).stdout.trim().split("\n");
let ruleHtml = "", ruleCss = "";
for (const file of ruleFiles.filter(file => /\.(xhtml|css)$/.test(file))) {
	const text = (await exec("/usr/bin/unzip", ["-p", ruleOutput, file])).stdout;
	if (file.endsWith(".css")) ruleCss += text;
	else {
		ruleHtml += text;
		const xml = path.join(directory, "rules-check.xhtml"); await writeFile(xml, text);
		await exec("/usr/bin/xmllint", ["--noout", "--nonet", xml]);
	}
}
for (const [kind, prefix] of [["body", "CORPS"], ["quote", "CITATION"], ["footnote", "NOTE"], ["tab", "TAB"]]) {
	assert.equal((ruleHtml.match(new RegExp('class="bookbinder-after-heading-' + kind + '"', "g")) ?? []).length, kind === "body" ? 7 : 6, "Première occurrence comprise, puis un premier paragraphe par titre : " + kind);
	for (let level = 1; level <= 6; level++) {
		assert.match(ruleHtml, new RegExp('class="bookbinder-after-heading-' + kind + '">\\s*</div>\\s*<p[^>]*>' + prefix + level + 'PREMIER'), "Le premier paragraphe du style après le titre " + level);
		assert.match(ruleHtml, new RegExp('<p[^>]*>' + prefix + level + 'SUIVANT'), "Le paragraphe suivant garde son style");
	}
}
assert.match(ruleHtml, /class="bookbinder-after-heading-body">\s*<\/div>\s*<p>AVANTTITRE<\/p>/);
assert.ok(ruleCss.includes("body .bookbinder-after-heading-body + p::first-letter{font-size:2em}"));
assert.ok(ruleCss.includes("body blockquote .bookbinder-after-heading-quote + p::first-letter{color:red}"));
for (const disabled of [["body", "quote"], ["footnote", "tab"]]) {
	const output = path.join(directory, "Sans-regles-" + disabled.join("-") + ".epub");
	const project = parseProject({ cover: "cover.jpg", epub: { "disabled-rules": disabled, rules: {
		".bookbinder-after-heading-body + p::first-letter": { "font-size": "3em" },
	} } }, "Sans règle");
	await exportEpub({ ...request, sources: ruleSources, project, output });
	const files = (await exec("/usr/bin/unzip", ["-Z1", output])).stdout.trim().split("\n");
	let html = "", css = "";
	for (const file of files.filter(file => /\.(xhtml|css)$/.test(file))) {
		const text = (await exec("/usr/bin/unzip", ["-p", output, file])).stdout;
		if (file.endsWith(".css")) css += text; else html += text;
	}
	for (const kind of ["body", "quote", "footnote", "tab"]) {
		assert.equal((html.match(new RegExp('class="bookbinder-after-heading-' + kind + '"', "g")) ?? []).length, disabled.includes(kind) ? 0 : kind === "body" ? 7 : 6, "Pas de règle uniquement pour le style désactivé : " + kind);
	}
	assert.equal(css.includes("body .bookbinder-after-heading-body + p::first-letter{font-size:3em}"), !disabled.includes("body"));
}
const tocMarkers = ["TOCLEVELA", "TOCLEVELB", "TOCLEVELC", "TOCLEVELD", "TOCLEVELE", "TOCLEVELF"];
const tocSources = [{ path: path.join(directory, "contents.md"), content: tocMarkers.map((marker, index) => "#".repeat(index + 1) + " " + marker + "\n\nTexte.").join("\n\n") }];
for (const [toc, depth] of [[false, 1], [true, 1], [true, 3], [true, 6]]) {
	const output = path.join(directory, `toc-${toc}-${depth}.epub`);
	await exportEpub({ ...request, sources: tocSources, project: parseProject({ cover: "cover.jpg", epub: { toc, "toc-depth": depth } }, "Sommaire"), output });
	const opf = (await exec("unzip", ["-p", output, "EPUB/content.opf"])).stdout;
	const spine = opf.match(/<spine\b[^]*?<\/spine>/)[0];
	assert.equal(/<itemref\b[^>]*idref="nav"/.test(spine), toc, "The EPUB reading order includes its contents page only when enabled");
	const nav = (await exec("unzip", ["-p", output, "EPUB/nav.xhtml"])).stdout;
	for (const [index, marker] of tocMarkers.entries()) assert.equal(new RegExp(`>${marker}</a>`).test(nav), index < depth, "EPUB navigation follows the selected depth even with no contents page");
}
const contextualOutput = path.join(directory, "contextual.epub");
await exportEpub({ ...request, sources: [{ path: path.join(directory, "context.md"), content: generalRulesContent }], project: parseProject({ cover: "cover.jpg", epub: { rules: {
	".bookbinder-rule-h3": { "font-size": "2em", color: "red" }, ".bookbinder-rule-em > em": { "font-style": "normal", "font-size": "1.5em" },
	".bookbinder-rule-pre": { "font-size": "1.25em" }, ".bookbinder-rule-ul": { color: "blue" },
} } }, "Context"), output: contextualOutput });
const contextualFiles = (await exec("unzip", ["-Z1", contextualOutput])).stdout.trim().split("\n");
let contextHtml = "", contextCss = "";
for (const file of contextualFiles.filter(file => /\.(xhtml|css)$/.test(file))) {
	const text = (await exec("unzip", ["-p", contextualOutput, file])).stdout;
	if (file.endsWith(".css")) contextCss += text;
	else contextHtml += text.match(/<body\b[^>]*>([^]*?)<\/body>/)?.[1] ?? "";
}
const contextRendering = await evaluateInChrome(`(() => {
	document.body.innerHTML = ${JSON.stringify(contextHtml)};
	const sheet = document.createElement("style"); sheet.textContent = ${JSON.stringify(contextCss)}; document.head.append(sheet);
	const bodySize = parseFloat(getComputedStyle(document.body).fontSize);
	const headings = Array.from(document.querySelectorAll("h3"), heading => ({ text: heading.textContent, size: parseFloat(getComputedStyle(heading).fontSize) / bodySize, color: getComputedStyle(heading).color }));
	const emphasis = Array.from(document.querySelectorAll("em"), element => ({ text: element.textContent, style: getComputedStyle(element).fontStyle }));
	return { headings, emphasis, sectionSize: parseFloat(getComputedStyle(document.querySelector("section.bookbinder-rule-h3")).fontSize) / bodySize, listColor: getComputedStyle(document.querySelector(".bookbinder-rule-ul > ul")).color };
})()`, directory);
for (const heading of contextRendering.headings) {
	const conditional = ["PREMIERH3", "APRESH2", "APRESH1"].includes(heading.text);
	assert.ok(Math.abs(heading.size - (conditional ? 2 : 1.3)) < .01, heading.text + " receives exactly one size override");
	assert.equal(heading.color === "rgb(255, 0, 0)", conditional);
}
assert.equal(contextRendering.sectionSize, 1, "Heading rules never style Pandoc's enclosing sections");
assert.equal(contextRendering.emphasis.find(item => item.text === "EMPREMIER").style, "normal");
assert.equal(contextRendering.emphasis.find(item => item.text === "EMSECOND").style, "italic");
assert.equal(contextRendering.listColor, "rgb(0, 0, 255)");
for (const body of [{}, { "font-family": "sans-serif", "font-size": "1.25em" }]) {
	const output = path.join(directory, Object.keys(body).length ? "follow-body-explicit.epub" : "follow-body-auto.epub");
	await exportEpub({ ...request, sources: [{ path: path.join(directory, "follow.md"), content: "### BODYHEADING\n\nBODYPARAGRAPH\n\n> BIGQUOTE `BODYCODE`" }], project: parseProject({ cover: "cover.jpg", epub: { style: body,
		headings: { h3: { "font-family": "body", "font-size": "body", "page-position": "one-third", "page-offset": "40mm" } }, styles: { "blockquote p": { "font-family": "monospace", "font-size": "2em" }, code: { "font-family": "body", "font-size": "body" } },
	} }, "Follow body"), output });
	const files = (await exec("unzip", ["-Z1", output])).stdout.trim().split("\n");
	let html = "", css = "";
	for (const file of files.filter(file => /\.(xhtml|css)$/.test(file))) {
		const text = (await exec("unzip", ["-p", output, file])).stdout;
		if (file.endsWith(".css")) css += text; else html += text.match(/<body\b[^>]*>([^]*?)<\/body>/)?.[1] ?? "";
	}
	assert.doesNotMatch(css, /font-(?:family|size):body(?:[;}])/);
	const result = await evaluateInChrome(`(() => {
		document.body.innerHTML = ${JSON.stringify(html)};
		const sheet = document.createElement("style"); sheet.textContent = ${JSON.stringify(css)}; document.head.append(sheet);
		const check = () => { const body = getComputedStyle(document.body); return ["h3", "code"].every(selector => { const style = getComputedStyle(document.querySelector(selector)); return style.fontSize === body.fontSize && style.fontFamily === body.fontFamily; }); };
		const gap = () => parseFloat(getComputedStyle(document.querySelector("h3")).paddingTop);
		const initial = check(), offsets = [gap()]; document.documentElement.style.fontSize = "24px";
		const resized = check(); offsets.push(gap()); document.querySelector("h3").style.fontSize = "4em"; offsets.push(gap());
		return { initial, resized, offsets };
	})()`, directory);
	assert.ok(result.initial && result.resized, "Body font/size references survive EPUB conversion, nested formatting and reader font-size changes");
	assert.ok(result.offsets.every(offset => Math.abs(offset - 40 * 96 / 25.4) < .1), "The exported EPUB keeps the same gap when reader and heading sizes change");
}
const zeroTopOutput = path.join(directory, "zero-top-headings.epub");
const bookFirstOutput = path.join(directory, "first-in-book.epub");
await exportEpub({ ...request, sources: [
	{ path: path.join(directory, "book-a.md"), content: await readFile(path.join(root, "scripts/fixtures/first-in-book.md"), "utf8") },
	{ path: path.join(directory, "book-b.md"), content: "# BOOKPARENTH1\n\n### BOOKAFTERH1\n\nBOOKBODYAFTERH1" },
], project: parseProject({ title: "BOOKTITLE", cover: "cover.jpg", epub: { rules: {
	".bookbinder-first-title": { "font-size": "2.5em" }, ".bookbinder-rule-title": { "font-size": "2em" },
	".bookbinder-first-h3": { "font-size": "2em" }, ".bookbinder-rule-h3": { "font-size": "1.5em", color: "red" },
	".bookbinder-first-body + p": { "font-size": "1.5em" }, ".bookbinder-after-heading-body + p::first-letter": { "font-size": "2em" },
	".bookbinder-first-em > em": { "font-size": "1.5em", "font-style": "normal" }, ".bookbinder-rule-em > em": { "font-size": "1.25em" },
} } }, "Book first"), output: bookFirstOutput });
const bookFirstFiles = (await exec("unzip", ["-Z1", bookFirstOutput])).stdout.trim().split("\n");
let bookFirstHtml = "", bookFirstCss = "";
for (const file of bookFirstFiles.filter(file => /\.(xhtml|css)$/.test(file))) {
	const text = (await exec("unzip", ["-p", bookFirstOutput, file])).stdout;
	if (file.endsWith(".css")) bookFirstCss += text; else bookFirstHtml += text.match(/<body\b[^>]*>([^]*?)<\/body>/)?.[1] ?? "";
}
const bookFirstRendering = await evaluateInChrome(`(() => {
	document.body.innerHTML = ${JSON.stringify(bookFirstHtml)};
	const sheet = document.createElement("style"); sheet.textContent = ${JSON.stringify(bookFirstCss)}; document.head.append(sheet);
	const elements = Array.from(document.querySelectorAll("h1,h3,p,em"));
	const find = text => text === "BOOKTITLE" ? document.querySelector("h1.title") : elements.findLast(element => element.textContent === text);
	const sizes = Object.fromEntries(["BOOKTITLE", "BOOKFIRSTH3", "BOOKSECONDH3", "BOOKSTILLNORMAL", "BOOKAFTERH2", "BOOKAFTERH1", "ZBOOKFIRSTBODY", "BOOKFIRSTEM", "BOOKSECONDEM", "BOOKEMAFTERH2"].map(text => [text, parseFloat(getComputedStyle(find(text)).fontSize)]));
	return { sizes, initial: parseFloat(getComputedStyle(find("ZBOOKFIRSTBODY"), "::first-letter").fontSize), bookMarkers: document.querySelectorAll("h3.bookbinder-first-h3").length };
})()`, directory);
for (const [marker, size] of Object.entries({ BOOKTITLE: 40, BOOKFIRSTH3: 32, BOOKSECONDH3: 20.8, BOOKSTILLNORMAL: 20.8, BOOKAFTERH2: 24, BOOKAFTERH1: 24, ZBOOKFIRSTBODY: 24, BOOKFIRSTEM: 24, BOOKSECONDEM: 16, BOOKEMAFTERH2: 20 })) assert.ok(Math.abs(bookFirstRendering.sizes[marker] - size) < .1, marker + " receives the correct first-book/after-heading style: " + bookFirstRendering.sizes[marker]);
assert.equal(bookFirstRendering.initial, 48, "An initial inherits the first-book paragraph size");
assert.equal(bookFirstRendering.bookMarkers, 1, "Only the first H3 across all notes is marked as first in book");
await exportEpub({ ...request, sources: [
	{ path: path.join(directory, "zero-a.md"), content: [1, 2, 3, 4, 5, 6].map(level => "#".repeat(level) + " ZEROTOPH" + level + "\n\nTexte après le titre.").join("\n\n") },
	{ path: path.join(directory, "zero-b.md"), content: "\n\n### ZEROTOPNOTE\n\nTexte de la note suivante." },
], project: parseProject({ cover: "cover.jpg", fusion: { noteSeparator: "page" }, epub: {
	headings: Object.fromEntries([1, 2, 3, 4, 5, 6].map(level => ["h" + level, { "margin-top": "0em" }])),
	rules: { ".bookbinder-rule-h3": { "margin-top": "0em" } },
} }, "Zero top"), output: zeroTopOutput });
const zeroTopFiles = (await exec("unzip", ["-Z1", zeroTopOutput])).stdout.trim().split("\n");
let zeroTopHtml = "", zeroTopCss = "";
for (const file of zeroTopFiles.filter(file => /\.(xhtml|css)$/.test(file))) {
	const text = (await exec("unzip", ["-p", zeroTopOutput, file])).stdout;
	if (file.endsWith(".css")) zeroTopCss += text; else zeroTopHtml += text.match(/<body\b[^>]*>([^]*?)<\/body>/)?.[1] ?? "";
}
const zeroTopHeadings = await evaluateInChrome(`(() => {
	document.body.innerHTML = ${JSON.stringify(zeroTopHtml)};
	const sheet = document.createElement("style"); sheet.textContent = ${JSON.stringify(zeroTopCss)}; document.head.append(sheet);
	return Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).filter(heading => heading.textContent.startsWith("ZEROTOP")).map(heading => ({
		text: heading.textContent, margin: parseFloat(getComputedStyle(heading).marginTop), padding: parseFloat(getComputedStyle(heading).paddingTop),
		firstElement: heading.parentElement.firstElementChild === heading,
	}));
})()`, directory);
assert.equal(zeroTopHeadings.length, 7);
for (const heading of zeroTopHeadings) {
	assert.equal(heading.margin, 0, heading.text + " has zero top margin");
	assert.equal(heading.padding, 0, heading.text + " has no residual padding");
	assert.ok(heading.firstElement, heading.text + " has no inserted paragraph or spacer before it");
}
const spacingOutput = path.join(directory, "paragraph-spacing.epub");
await exportEpub({ ...request, sources: [{ path: path.join(directory, "spacing.md"), content: await readFile(path.join(root, "scripts/fixtures/paragraph-spacing.md"), "utf8") }], project: parseProject({ cover: "cover.jpg", colophon: "COLONE\n\nCOLTWO", epub: { style: { "margin-top": "1em", "margin-bottom": "2em" },
	styles: Object.fromEntries(["blockquote p", "section.footnotes p", "p.tab", ".bookbinder-colophon p"].map(selector => [selector, { "margin-top": "1em", "margin-bottom": "2em" }])),
} }, "Spacing"), output: spacingOutput });
const spacingFiles = (await exec("unzip", ["-Z1", spacingOutput])).stdout.trim().split("\n");
let spacingHtml = "", spacingCss = "";
for (const file of spacingFiles.filter(file => /\.(xhtml|css)$/.test(file))) {
	const text = (await exec("unzip", ["-p", spacingOutput, file])).stdout;
	if (file.endsWith(".css")) spacingCss += text; else spacingHtml += text.match(/<body\b[^>]*>([^]*?)<\/body>/)?.[1] ?? "";
}
const spacingParagraphs = await evaluateInChrome(`(() => {
	document.body.innerHTML = ${JSON.stringify(spacingHtml)};
	const sheet = document.createElement("style"); sheet.textContent = ${JSON.stringify(spacingCss)}; document.head.append(sheet);
	return Array.from(document.querySelectorAll("p")).map(paragraph => { const style = getComputedStyle(paragraph); return { text: paragraph.textContent.trim(), top: parseFloat(style.marginTop) / parseFloat(style.fontSize), bottom: parseFloat(style.marginBottom) / parseFloat(style.fontSize) }; });
})()`, directory);
for (const marker of ["BODYONE", "QUOTEONE", "BODYRESET", "TABONE", "BODYAFTERTAB", "FOOTONE", "COLONE"]) {
	const paragraph = spacingParagraphs.find(paragraph => paragraph.text.startsWith(marker)); assert.ok(paragraph, marker); assert.ok(Math.abs(paragraph.top - 1) < .01, marker + " keeps its leading top margin");
}
for (const marker of ["BODYTWO", "BODYTHREE", "QUOTETWO", "QUOTETHREE", "QUOTEFOUR", "TABTWO", "TABTHREE", "FOOTTWO", "FOOTTHREE", "COLTWO"]) {
	const paragraph = spacingParagraphs.find(paragraph => paragraph.text.startsWith(marker)); assert.ok(paragraph, marker); assert.equal(paragraph.top, 0, marker + " drops the repeated top margin"); assert.ok(Math.abs(paragraph.bottom - 2) < .01, marker + " preserves its bottom margin");
}
console.log("EPUB réel : couverture Canvas 1600×2400, fusion en mémoire, quatre séparateurs, projets exclus, images relatives, notes locales, XHTML valide et conservation du dernier export : OK.");
console.log(`Résultats : ${directory}`);
mock.timers.reset();
