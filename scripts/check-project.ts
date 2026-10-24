import assert from "node:assert/strict";
import { excluded, isProjectNote, localResource, parseProject, prepareMarkdown, projectCss } from "../plugin/project.ts";

const defaults = parseProject(undefined, "Manuscrit");
assert.equal(defaults.metadata.title, "Manuscrit");
assert.equal(defaults.metadata.lang, "fr");
assert.equal(defaults.tocDepth, 2);
assert.deepEqual(defaults.styles, {});
assert.deepEqual(defaults.page, {});
assert.equal(parseProject({ title: null, author: null, subtitle: null }, "Titre").metadata.title, "Titre");
const configured = parseProject({
	title: "L’expérience\\nhumaine", author: ["Auteur", "Autrice"], identifier: "ISBN-0", toc_level: 3,
	epub: { "toc-depth": 2, "split-level": 3, fonts: ["fonts/Adamant.otf"], style: { "font-size": "1.1em", "page-margin": "1.2em" }, headings: { h2: { color: "#888" } } },
	fusion: { excludeNames: "sortspec, Brouillons", poem: false },
}, "Ignored");
assert.equal(configured.metadata.identifier, "ISBN-0");
assert.equal(configured.splitLevel, 3);
assert.deepEqual(configured.fonts, ["fonts/Adamant.otf"]);
assert.match(projectCss(configured), /h2\{color:#888\}/);
assert.match(projectCss(configured), /@page\{margin:1.2em\}/);
const margins = parseProject({ epub: { page: { "margin-top": "10mm", "margin-bottom": "12mm", "margin-left": "14mm", "margin-right": "16mm" }, style: { "margin-left": "5pt", "margin-right": "6pt", "text-indent": "7pt" } } }, "Livre");
assert.match(projectCss(margins), /@page\{margin-top:10mm;margin-bottom:12mm;margin-left:14mm;margin-right:16mm\}/);
assert.match(projectCss(margins), /p\{margin-left:5pt;margin-right:6pt;text-indent:7pt\}/);
assert.throws(() => parseProject({ epub: { page: { "font-family": "serif" } } }, "Livre"), /quatre marges/);
const special = parseProject({ epub: { style: { "font-size": "1.25em" }, styles: { "blockquote p": { "font-size": "1.1em" }, "h2 + p::first-letter": { "font-size": "2em" }, "div.poem-solo": { "margin-left": "1.5em" } } } }, "Livre");
assert.match(projectCss(special), /body blockquote p\{font-size:1.1em\}/);
assert.match(projectCss(special), /body h2 \+ p::first-letter\{font-size:2em\}/);
assert.match(projectCss(special).match(/body\{[^}]*\}/)![0], /font-size:1.25em/);
assert.match(projectCss(special), /p\{font-size:inherit\}/);
assert.equal(special.styles["div.poem-solo"], undefined);
assert.equal(special.rules["h2 + p::first-letter"]["font-size"], "2em");
const explicitRule = parseProject({ epub: { styles: { "h2 + p::first-letter": { "font-size": "2em" } }, rules: { "h2 + p::first-letter": { "font-size": "3em" } } } }, "Livre");
assert.match(projectCss(explicitRule), /body h2 \+ p::first-letter\{font-size:3em\}/);
assert.throws(() => parseProject({ epub: { rules: { body: { color: "red" } } } }, "Livre"), /règle inconnue/);
const migrated = parseProject({ fusion: { poem: true, right: true }, epub: { styles: { body: { "font-size": "1.1em" }, "h1.title": { color: "red" } } } }, "Livre");
assert.equal(migrated.style["font-size"], "1.1em");
assert.deepEqual(migrated.styles, {});
assert.deepEqual(Object.keys(migrated.fusion).sort(), ["excludeCharacters", "excludeNames", "noteSeparator"]);
assert.throws(() => parseProject({ epub: { styles: { "p}body{": { color: "red" } } } }, "Livre"), /style inconnu/);
assert.equal(excluded("partie/_notes/01.md", defaults.fusion), true);
assert.equal(excluded("partie/sortspec.md", defaults.fusion), true);
assert.equal(excluded("fusion-Manuscrit-20261024-1200.md", defaults.fusion), true);
assert.equal(excluded("partie/01.md", defaults.fusion), false);
assert.equal(isProjectNote("bookbinder.md"), true);
assert.equal(isProjectNote("Un livre/BOOKBINDER.MD"), true);
assert.equal(isProjectNote("Un livre/bookbinder.md.bak"), false);
assert.equal(excluded("partie/bookbinder.md", { ...defaults.fusion, excludeCharacters: "", excludeNames: "" }), true);
assert.equal(isProjectNote("Un livre/BOOK-PRINT.MD"), true);
assert.equal(isProjectNote("book-print.md.bak"), false);
assert.equal(excluded("partie/book-print.md", { ...defaults.fusion, excludeCharacters: "", excludeNames: "" }), true);
assert.equal(excluded("Brouillons/01.md", configured.fusion), true);
const prepared = prepareMarkdown("---\ntitle: Secret\n---\n## Chapitre\n<!-- privé -->\n%% privé %%\n~~barré~~\n[Capitales]{.smallcaps}\n--Capitales--\n@@Droite\n££Exergue\n€€Vers 1\n\nVers 2€€\n\\newpage\n");
assert.doesNotMatch(prepared, /Secret|privé|<div|<span/);
for (const literal of ["~~barré~~", "[Capitales]{.smallcaps}", "--Capitales--", "@@Droite", "££Exergue", "€€Vers 1", "\\newpage"]) assert.ok(prepared.includes(literal));
assert.equal(localResource("/projet", "images/cover.jpg"), "/projet/images/cover.jpg");
for (const data of [[], { title: 2 }, { author: {} }, { cover: ["a.jpg", "b.jpg"] }, { epub: { "toc-depth": 0 } }, { fusion: { excludeNames: true } }, { epub: { style: { color: "red;}body{display:none" } } }, { epub: { headings: { body: {} } } }]) {
	assert.throws(() => parseProject(data, "Titre"));
}
assert.throws(() => localResource("/projet", "https://example.org/cover.jpg"));
console.log("Configuration EPUB : Markdown conservé, styles Markdown, migration et règles séparées : OK.");
