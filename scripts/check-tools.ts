import * as assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { compareVersions, detectTool, searchDirectories } from "../plugin/tools.ts";
import { parseSettings } from "../plugin/types.ts";
import { checkUpdate, pandocInstaller, updatePage } from "../plugin/updates.ts";
import { resolveOutputDirectory, saveGeneratedFile } from "../plugin/output.ts";
import { setLocale, t } from "../plugin/i18n.ts";
import ts from "typescript";

setLocale("fr");

const dialogs = ts.createSourceFile("dialogs.ts", await readFile(new URL("../plugin/dialogs.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const declaration = dialogs.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "confirmOverwrite");
assert.ok(declaration);
const confirmSource = ts.transpileModule(declaration.getText(dialogs).replace(/^export\s+/, ""), { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
for (const [response, expected] of [[0, "replace"], [1, "version"], [2, "cancel"], [-1, "cancel"]] as const) {
	const confirm = new Function("t", "remote", "path", confirmSource + "\nreturn confirmOverwrite;")(t, {
		dialog: { showMessageBox: async (options: { buttons: string[]; defaultId: number; cancelId: number }) => {
			assert.deepEqual(options.buttons, [t("replace"), t("createAVersion"), t("cancel")], "Remplacer est proposé en premier");
			assert.equal(options.defaultId, 0, "Remplacer est sélectionné par défaut");
			assert.equal(options.cancelId, 2);
			return { response };
		} },
	}, path) as (filename: string) => Promise<string>;
	assert.equal(await confirm("Livre.epub"), expected, "Chaque bouton conserve son action");
}

const directory = await mkdtemp(path.join(tmpdir(), "bookbinder-tools-"));
const bin = path.join(directory, "dossier avec espaces");
await mkdir(bin);
const executable = path.join(bin, "pandoc");
await writeFile(executable, `#!${process.execPath}
if (process.argv[2] !== "--version") process.exit(2);
console.log("pandoc 3.8.2");
`, { mode: 0o755 });

const found = await detectTool("pandoc", executable);
assert.equal(found.state, "found");
if (found.state === "found") {
	assert.equal(found.version, "3.8.2");
	assert.equal(found.path, executable);
}
assert.equal((await detectTool("pandoc", `"${executable}"`)).state, "found");
assert.equal((await detectTool("pandoc", "pandoc", { PATH: bin })).state, "found");
const newerBin = path.join(directory, "newer");
await mkdir(newerBin);
await writeFile(path.join(bin, "pandoc"), `#!${process.execPath}\nconsole.log("pandoc 9000.0");\n`, { mode: 0o755 });
await writeFile(path.join(newerBin, "pandoc"), `#!${process.execPath}\nconsole.log("pandoc 9001.0");\n`, { mode: 0o755 });
assert.equal((await detectTool("pandoc", "", { PATH: [bin, newerBin].join(path.delimiter) })).path, path.join(newerBin, "pandoc"));
assert.equal((await detectTool("pandoc", executable)).path, executable);
assert.equal((await detectTool("pandoc", path.join(directory, "absent"))).state, "missing");
assert.equal((await detectTool("pandoc", path.join(directory, "pandoc; touch sentinel"))).state, "missing");
assert.equal((await detectTool("pandoc", "invalid\0path")).state, "error");
assert.equal((await detectTool("xelatex", executable)).state, "error");

const broken = path.join(bin, "broken");
await writeFile(broken, `#!${process.execPath}\nprocess.exit(1);\n`, { mode: 0o755 });
assert.equal((await detectTool("pandoc", broken)).state, "error");
const denied = path.join(bin, "denied");
await writeFile(denied, "not executable", { mode: 0o644 });
assert.equal((await detectTool("pandoc", denied)).state, "error");
const stuck = path.join(bin, "stuck");
await writeFile(stuck, `#!${process.execPath}\nsetInterval(() => {}, 1000);\n`, { mode: 0o755 });
const timeout = await detectTool("pandoc", stuck);
assert.equal(timeout.state, "error");
if (timeout.state === "error") assert.match(timeout.message, /ne répond pas/);

const tex = path.join(bin, "xelatex");
await writeFile(tex, `#!${process.execPath}\nconsole.log("XeTeX 3.141592653-2.6-0.999997 (TeX Live 2025)");\n`, { mode: 0o755 });
const latex = await detectTool("xelatex", tex);
assert.equal(latex.state, "found");
if (latex.state === "found") assert.equal(latex.version, "TeX Live 2025");
await writeFile(tex, `#!${process.execPath}\nconsole.log("MiKTeX-XeTeX 4.10 (MiKTeX 24.1 Portable)");\n`, { mode: 0o755 });
const miktex = await detectTool("xelatex", tex);
assert.equal(miktex.state, "found");
if (miktex.state === "found") assert.equal(miktex.version, "MiKTeX 24.1 Portable");

assert.ok(searchDirectories({}, "darwin", "/user").includes("/Library/TeX/texbin"));
assert.ok(searchDirectories({ Path: "C:\\Tools", LOCALAPPDATA: "C:\\Users\\Test\\AppData\\Local" }, "win32", "C:\\Users\\Test")
	.includes("C:\\Users\\Test\\AppData\\Local\\Programs\\MiKTeX\\miktex\\bin\\x64"));
assert.ok(searchDirectories({}, "linux", "/user").includes("/user/.local/bin"));
assert.deepEqual(parseSettings(null), { projectModel: "base.md", pandocPath: "", latexPath: "", outputDirectory: "" });
assert.deepEqual(parseSettings({ pandocPath: 5, latexPath: " /custom/xelatex " }), { projectModel: "base.md", pandocPath: "", latexPath: "/custom/xelatex", outputDirectory: "" });
const source = path.join(directory, "Manuscrit", "livre.md");
assert.equal(resolveOutputDirectory(source, ""), path.dirname(source));
assert.equal(resolveOutputDirectory(path.join(directory, "autre", "livre.md"), ""), path.join(directory, "autre"));
assert.equal(resolveOutputDirectory(source, bin), bin);
assert.equal(parseSettings({ outputDirectory: bin }).outputDirectory, bin);
assert.equal(parseSettings({ outputDirectory: false }).outputDirectory, "");
assert.throws(() => resolveOutputDirectory("livre.md", ""), /chemin absolu/);
assert.throws(() => resolveOutputDirectory(source, "relative"), /chemin absolu/);
const staged = path.join(directory, "new.epub"), existing = path.join(directory, "Livre.epub");
await writeFile(staged, "Nouveau");
assert.equal(await saveGeneratedFile(staged, existing, async () => { throw new Error("Aucune confirmation pour un nouveau fichier"); }), existing);
await writeFile(existing, "Ancien"); await writeFile(path.join(directory, "Livre-2.epub"), "Version 2");
assert.equal(await saveGeneratedFile(staged, existing, async filename => { assert.equal(filename, existing); return "version"; }), path.join(directory, "Livre-3.epub"));
assert.equal(await readFile(existing, "utf8"), "Ancien");
assert.equal(await readFile(path.join(directory, "Livre-2.epub"), "utf8"), "Version 2");
assert.equal(await readFile(path.join(directory, "Livre-3.epub"), "utf8"), "Nouveau");
assert.equal(await saveGeneratedFile(staged, existing, async () => "cancel"), undefined);
assert.equal(await readFile(existing, "utf8"), "Ancien");
assert.equal(await saveGeneratedFile(staged, existing, async () => "replace"), existing);
assert.equal(await readFile(existing, "utf8"), "Nouveau");
await assert.rejects(saveGeneratedFile(staged, existing, async () => "replace"), /ENOENT/);
assert.equal(await readFile(existing, "utf8"), "Nouveau");
await writeFile(staged, "Nouvelle version");
assert.equal(await saveGeneratedFile(staged, existing), path.join(directory, "Livre-4.epub"));
const concurrent = path.join(directory, "Simultané.epub");
const published = await Promise.all([saveGeneratedFile(staged, concurrent), saveGeneratedFile(staged, concurrent)]);
assert.deepEqual(new Set(published), new Set([concurrent, path.join(directory, "Simultané-2.epub")]));
assert.equal(compareVersions("3.9", "3.10"), -1);
assert.equal(compareVersions("3.8.2", "3.8.2.0"), 0);
assert.equal(compareVersions("3.10", "3.9.9"), 1);
assert.equal(compareVersions("3.10-rc1", "3.10"), -1);
assert.equal(compareVersions("3.10+local", "3.10"), 0);
assert.equal(compareVersions("unknown", "3.10"), undefined);
assert.equal(compareVersions("9".repeat(65), "3.10"), undefined);
assert.equal(updatePage("pandoc", { state: "missing", message: "" }, "win32"), "https://github.com/jgm/pandoc/releases/latest");
assert.equal(updatePage("pandoc", { state: "found", path: "/opt/homebrew/bin/pandoc", version: "3.8.2" }, "darwin"), "https://github.com/jgm/pandoc/releases/latest");
assert.equal(updatePage("xelatex", { state: "missing", message: "" }, "darwin"), "https://www.tug.org/mactex/mactex-download.html");
assert.equal(updatePage("xelatex", { state: "found", path: "/usr/local/texlive/2026basic/bin/xelatex", version: "TeX Live 2026" }, "darwin"), "https://www.tug.org/mactex/morepackages.html");
assert.equal(updatePage("xelatex", { state: "missing", message: "" }, "win32"), "https://miktex.org/download");
assert.equal(updatePage("xelatex", { state: "found", path: "C:/MiKTeX/xelatex.exe", version: "MiKTeX 24.1" }, "win32"), "https://miktex.org/howto/update-miktex");
assert.equal(updatePage("xelatex", { state: "found", path: "/texlive/bin/xelatex", version: "TeX Live 2025" }, "win32"), "https://www.tug.org/texlive/windows.html");
const installerLinks = [
	"https://github.com/jgm/pandoc/releases/download/3.12.1/pandoc-3.12.1-arm64-macOS.pkg",
	"https://github.com/jgm/pandoc/releases/download/3.12.1/pandoc-3.12.1-x86_64-macOS.pkg",
	"https://github.com/jgm/pandoc/releases/download/3.12.1/pandoc-3.12.1-windows-x86_64.msi",
];
assert.equal(pandocInstaller(installerLinks, "darwin", "arm64"), installerLinks[0]);
assert.equal(pandocInstaller(installerLinks, "darwin", "x64"), installerLinks[1]);
assert.equal(pandocInstaller(installerLinks, "win32", "x64"), installerLinks[2]);
assert.equal(pandocInstaller(installerLinks, "win32", "arm64"), undefined);
assert.equal(pandocInstaller([installerLinks[0].replace("github.com", "example.com")], "darwin", "arm64"), undefined);
const offline = await checkUpdate("pandoc", found, async () => { throw new Error("Offline"); });
assert.equal(offline.state, "unavailable");
const malformed = await checkUpdate("pandoc", found, async () => "invalid data");
assert.equal(malformed.state, "unavailable");
const oversized = await checkUpdate("pandoc", found, async () => "x".repeat(1_000_001));
assert.equal(oversized.state, "unavailable");
console.log("Détection vérifiée : chemins avec espaces, PATH, absence, erreurs, identité des moteurs et réglages.");
console.log("Mises à jour vérifiées : comparaison numérique, liens par système et fonctionnement hors ligne.");
console.log("Dossier de génération vérifié : source par défaut, dossier personnalisé et conservation des anciens réglages.");
console.log(`Fichiers de contrôle : ${directory}`);
