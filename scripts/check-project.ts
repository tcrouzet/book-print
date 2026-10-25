import assert from "node:assert/strict";
import { excluded, isProjectNote, localResource, noteSeparators, parseProject, prepareMarkdown, projectCss } from "../plugin/project.ts";
import { setLocale } from "../plugin/i18n.ts";
import "./check-i18n.ts";
import { defaultFilename, slugFilename } from "../plugin/filename.ts";

setLocale("fr");

const bodyRule = ".bookbinder-after-heading-body + p";
const bodyCharacter = bodyRule + "::first-letter";

const defaults = parseProject(undefined, "Manuscrit");
assert.equal(defaults.metadata.title, "Manuscrit");
assert.equal(defaults.metadata.lang, "fr");
assert.equal(parseProject({ title: "L’expérience humaine", author: "Thierry Crouzet" }, "Livre").filename, "crouzet-experience-humaine");
assert.equal(defaultFilename("L'expérience\\nhumaine", ["Thierry Crouzet", "Marie Dupont"]), "crouzet-experience-humaine");
assert.equal(parseProject({ title: "Été à vélo", filename: " Ma nouvelle édition.EPUB " }, "Livre").filename, "ma-nouvelle-edition");
for (const filename of [undefined, null, "", "   ", "✨"]) assert.equal(parseProject({ title: "Été à vélo", filename }, "Livre").filename, "ete-a-velo");
assert.throws(() => parseProject({ filename: 12 }, "Livre"), /filename/);
assert.equal(defaultFilename("漢字", ""), "book");
assert.equal(slugFilename("Œuvres de cœur & æther ß"), "oeuvres-de-coeur-aether-ss");
assert.equal(slugFilename("CON"), "con-book");
assert.ok(slugFilename("a".repeat(300)).length <= 200);
for (const filename of ["../../autre", "C:\\livres\\autre.epub", "/tmp/autre", "a\0b", "..", "א ب"]) {
	const project = parseProject({ title: "Livre", filename }, "Livre");
	assert.match(project.filename, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Le nom reste un slug sans chemin ni extension");
}
const filenameAlphabet = ["a", "É", "œ", "ß", "/", "\\", "\0", "漢字", "😀", "-", " ", ":", ".", "²"];
let filenameSeed = 107;
for (let sample = 0; sample < 128; sample++) {
	let value = "";
	for (let character = 0; character < 32; character++) {
		filenameSeed = (Math.imul(filenameSeed, 1664525) + 1013904223) >>> 0;
		value += filenameAlphabet[filenameSeed % filenameAlphabet.length];
	}
	const slug = slugFilename(value);
	assert.match(slug, /^(?:[a-z0-9]+(?:-[a-z0-9]+)*)?$/);
	assert.equal(slugFilename(slug), slug, "Normaliser un slug est stable");
}
assert.equal(parseProject({ colophon: "Texte *du colophon*." }, "Livre").metadata.colophon, "Texte *du colophon*.");
assert.throws(() => parseProject({ colophon: 12 }, "Livre"));
assert.equal(parseProject({ colophon: null }, "Livre").metadata.colophon, undefined);
assert.equal(defaults.tocDepth, 2);
assert.deepEqual(defaults.styles, {});
assert.deepEqual(defaults.page, {});
assert.deepEqual(defaults.disabledRules, []);
assert.equal(defaults.separator, undefined);
const positionedHeading = parseProject({ epub: { headings: { h2: { "page-position": "one-third", "margin-top": "2em", "page-break-before": "auto" } } } }, "Livre");
const previousPosition = { epub: { headings: { h2: { "page-position": "two-thirds" } } } };
assert.equal(parseProject(previousPosition, "Livre").headings.h2["page-position"], "one-third");
assert.equal(previousPosition.epub.headings.h2["page-position"], "two-thirds", "Reading a previous setting does not rewrite the source object");
assert.equal(positionedHeading.headings.h2["page-position"], "one-third");
for (let level = 1; level <= 6; level++) {
	assert.equal(parseProject({ epub: { headings: { ["h" + level]: { "page-position": "one-third" } } } }, "Livre").headings["h" + level]["page-position"], "one-third");
}
const positionedCss = projectCss(positionedHeading);
assert.match(positionedCss, /h2\{[^}]*padding-top:33\.3333vh/);
assert.match(positionedCss, /page-break-before:always;break-before:page;margin-top:0/);
assert.doesNotMatch(positionedCss, /page-position/);
delete positionedHeading.headings.h2["page-position"];
assert.match(projectCss(positionedHeading), /h2\{margin-top:2em;page-break-before:auto\}/);
assert.doesNotMatch(projectCss(positionedHeading), /33\.3333vh/);
for (const value of ["middle", "red;}body{display:none", 2, ["one-third"]]) assert.throws(() => parseProject({ epub: { headings: { h2: { "page-position": value } } } }, "Livre"));
assert.throws(() => parseProject({ epub: { style: { "page-position": "one-third" } } }, "Livre"));
for (const separator of ["", "⁂ · ⁂", "***", '<img src=x onerror="alert(1)">', "\\\"{};", "א ب"]) {
	assert.equal(parseProject({ epub: { separator } }, "Livre").separator, separator);
}
for (const separator of [null, 1, {}, [], "\0"]) assert.throws(() => parseProject({ epub: { separator } }, "Livre"), /epub.separator/);
assert.match(projectCss(parseProject({ epub: { styles: { hr: { color: "red" } } } }, "Livre")), /body hr,body \.bookbinder-separator\{color:red\}/);
const noBodyRule = parseProject({ epub: { "disabled-rules": ["body"], rules: { [bodyCharacter]: { "font-size": "2em" } } } }, "Livre");
assert.deepEqual(noBodyRule.disabledRules, ["body"]);
assert.equal(noBodyRule.rules[bodyCharacter]["font-size"], "2em");
assert.ok(!projectCss(noBodyRule).includes("font-size:2em"));
assert.ok(projectCss({ ...noBodyRule, disabledRules: [] }).includes("font-size:2em"));
for (const value of ["body", {}, ["unknown"], [null], [1]]) {
	assert.throws(() => parseProject({ epub: { "disabled-rules": value } }, "Livre"), /disabled-rules/);
}
assert.deepEqual(Array.from(noteSeparators.values(), choice => choice.label), ["Vide", "Saut de page", "Saut de page paire", "Saut de page impaire"]);
for (const separator of ["", "page", "even", "odd", "***", "constructor"]) {
	assert.equal(parseProject({ fusion: { noteSeparator: separator } }, "Livre").fusion.noteSeparator, separator);
}
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
assert.ok(projectCss(special).includes(`body ${bodyCharacter}{font-size:2em}`));
assert.match(projectCss(special).match(/body\{[^}]*\}/)![0], /font-size:1.25em/);
assert.match(projectCss(special), /p\{font-size:inherit\}/);
assert.equal(special.styles["div.poem-solo"], undefined);
assert.equal(special.rules[bodyCharacter]["font-size"], "2em");
const explicitRule = parseProject({ epub: { styles: { "h2 + p::first-letter": { "font-size": "2em" } }, rules: { "h2 + p::first-letter": { "font-size": "3em" } } } }, "Livre");
assert.ok(projectCss(explicitRule).includes(`body ${bodyCharacter}{font-size:3em}`));
const combinedRules = parseProject({ epub: { rules: {
	[bodyRule]: { color: "blue" }, "h1 + p": { "text-indent": "0em" }, "h2 + p": { color: "red" },
	"blockquote .bookbinder-after-heading-quote + p": { "font-style": "normal" },
} } }, "Livre");
assert.deepEqual(combinedRules.rules[bodyRule], { "text-indent": "0em", color: "blue" });
assert.equal(combinedRules.rules["h1 + p"], undefined);
assert.deepEqual(parseProject({ epub: { rules: combinedRules.rules } }, "Livre").rules, combinedRules.rules);
assert.throws(() => parseProject({ epub: { rules: { body: { color: "red" } } } }, "Livre"), /règle inconnue/);
const migrated = parseProject({ fusion: { poem: true, right: true }, epub: { styles: { body: { "font-size": "1.1em" }, "h1.title": { color: "red" } } } }, "Livre");
assert.equal(migrated.style["font-size"], "1.1em");
assert.deepEqual(migrated.styles, { "h1.title": { color: "red" } });
const titleStyle = parseProject({ epub: { headings: { h1: { "font-size": "3em" } }, styles: { "h1.title": { "font-size": "2em", "page-position": "one-third" } } } }, "Livre");
assert.match(projectCss(titleStyle), /h1:not\(\.title\)\{font-size:3em\}/);
assert.match(projectCss(titleStyle), /body h1\.title\{font-size:2em;[^}]*padding-top:33\.3333vh/);
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
