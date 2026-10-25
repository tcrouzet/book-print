import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import ts from "typescript";
import en from "../locales/en.json" with { type: "json" };
import fr from "../locales/fr.json" with { type: "json" };
import { getLocale, resolveLocale, setLocale, setTranslations, t } from "../plugin/i18n.ts";
import { loadTranslationFiles } from "../plugin/locale-files.ts";
import { bookStyles, contextRules } from "../plugin/book-styles.ts";
import { noteSeparators, parseProject, projectCss } from "../plugin/project.ts";

const placeholders = (value: string) => Array.from(new Set(Array.from(value.matchAll(/\{(\w+)\}/g), match => match[1]))).sort();
assert.equal(getLocale(), "en", "English is the default before Obsidian supplies its language");
assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
assert.ok(Object.keys(en).every(key => /^[a-z][A-Za-z0-9]*$/.test(key)), "Message IDs are named variables");
const declaration = ts.createSourceFile("messages.d.ts", await readFile(new URL("../plugin/messages.d.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const declaredKeys: string[] = [];
function declared(node: ts.Node): void {
	if (ts.isPropertySignature(node)) declaredKeys.push(node.name.getText(declaration));
	ts.forEachChild(node, declared);
}
declared(declaration);
assert.deepEqual(declaredKeys.sort(), Object.keys(en).sort(), "JSON keys and TypeScript message declarations stay aligned");
for (const key of Object.keys(en) as (keyof typeof en)[]) {
	assert.ok(fr[key].trim(), `Empty French translation: ${key}`);
	assert.deepEqual(placeholders(fr[key]), placeholders(en[key]), `Translation parameters: ${key}`);
}
for (const language of ["en", "en-GB", "de-DE", "", "__proto__"]) assert.equal(resolveLocale(language), "en");
for (const language of ["fr", "fr-CA", "FR_fr"]) assert.equal(resolveLocale(language), "fr");
setLocale("en-GB");
assert.equal(getLocale(), "en");
assert.equal(t("createOpenProject"), "Create/open project");
assert.equal(bookStyles[0].label, "Body text");
assert.equal(bookStyles[1].label, "Heading 1");
assert.equal(noteSeparators.get("even")!.label, "Even-page break");
assert.equal(contextRules[1].label, "First character of “Body text” after a heading");
assert.ok(bookStyles.find(style => style.selector === "blockquote p")!.sample!.includes("A voice"));
assert.throws(() => parseProject({ epub: { rules: { unknown: {} } } }, "Book"), /unknown rule/);
assert.throws(() => t("headingLevel"), /Missing translation parameter: level/);
assert.equal(t("epubCreatedFilename", { filename: "Été {livre}.epub" }), "EPUB created: Été {livre}.epub");
const config = { title: "Été 漢字", lang: "fr", epub: { styles: { "p.tab": { "text-align": "right" } } } };
const englishProject = parseProject(config, "Book");
assert.equal(parseProject(undefined, "Book").metadata.lang, "fr");
setLocale("fr-CA");
assert.equal(t("createOpenProject"), "Créer/ouvrir projet");
assert.equal(bookStyles[0].label, "Texte courant");
assert.equal(bookStyles[1].label, "Titre 1");
assert.equal(noteSeparators.get("even")!.label, "Saut de page paire");
assert.equal(contextRules[1].label, "Premier caractère de « Texte courant » après un titre");
assert.ok(bookStyles.find(style => style.selector === "blockquote p")!.sample!.includes("Une voix"));
assert.deepEqual(parseProject(config, "Book"), englishProject);
assert.equal(projectCss(parseProject(config, "Book")), projectCss(englishProject));
assert.throws(() => parseProject({ epub: { rules: { unknown: {} } } }, "Book"), /règle inconnue/);

const directory = new URL("../plugin/", import.meta.url);
for (const filename of (await readdir(directory)).filter(name => name.endsWith(".ts"))) {
	const source = ts.createSourceFile(filename, await readFile(new URL(filename, directory), "utf8"), ts.ScriptTarget.Latest, true);
	const visit = (node: ts.Node) => {
		if (ts.isStringLiteralLike(node) && /[àâçéèêëîïôùûüœ]/i.test(node.text)) {
			assert.fail(`Untranslated French text in ${filename}: ${node.text}`);
		}
		if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t" && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
			assert.ok(Object.prototype.hasOwnProperty.call(en, node.arguments[0].text), `Unknown translation in ${filename}: ${node.arguments[0].text}`);
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
}
const temporary = await mkdtemp(path.join(tmpdir(), "bookbinder-locales-"));
try {
	const folder = path.join(temporary, "locales");
	assert.deepEqual(await loadTranslationFiles(folder), []);
	for (const language of ["en", "fr"]) assert.deepEqual(JSON.parse(await readFile(path.join(folder, language + ".json"), "utf8")), language === "en" ? en : fr);
	const editedFrench = JSON.stringify({ bodyText: "Mon texte courant", bodyFontWarning: "Mon avertissement modifié" }, null, 4);
	const editedEnglish = JSON.stringify({ bodyText: "My body text" });
	await writeFile(path.join(folder, "fr.json"), editedFrench);
	await writeFile(path.join(folder, "en.json"), editedEnglish);
	assert.deepEqual(await loadTranslationFiles(folder), []);
	setLocale("fr");
	assert.equal(t("bodyText"), "Mon texte courant");
	assert.equal(bookStyles[0].label, "Mon texte courant");
	assert.equal(t("bodyFontWarning"), "Mon avertissement modifié");
	assert.ok(t("generatedByBookbinderOn", { date: "DATE_SENTINEL" }).includes("DATE_SENTINEL"), "A partial custom catalogue keeps its edits and uses the bundled credit");
	assert.equal(t("font"), fr.font, "Missing keys keep the bundled translation");
	setLocale("en");
	assert.equal(t("bodyText"), "My body text", "Both language files are read after editing, without rebuilding");
	assert.equal(await readFile(path.join(folder, "fr.json"), "utf8"), editedFrench, "Custom files are not overwritten or reformatted");
	setLocale("fr");
	for (const invalid of ["{", "[]", JSON.stringify({ bodyText: 123 }), JSON.stringify({ bodyText: "" }), JSON.stringify({ bodyText: "Partiel", headingLevel: "Titre sans paramètre" }), JSON.stringify({ bodyText: "{unexpected}" })]) {
		await writeFile(path.join(folder, "fr.json"), invalid);
		const errors = await loadTranslationFiles(folder);
		assert.equal(errors.length, 1);
		assert.ok(errors[0].includes(path.join(folder, "fr.json")));
		assert.equal(t("bodyText"), fr.bodyText, "An invalid file keeps the complete bundled fallback");
		assert.equal(await readFile(path.join(folder, "fr.json"), "utf8"), invalid, "An invalid custom file stays intact for correction");
	}
} finally {
	await rm(temporary, { recursive: true, force: true });
	setTranslations("en", {}); setTranslations("fr", {}); setLocale("fr");
}
console.log("Traductions : catalogues complets, paramètres, repli, styles et projets inchangés : OK.");
