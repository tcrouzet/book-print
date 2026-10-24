import { constants } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";

export interface ImportedFont { name: string; data: Uint8Array }
export interface ProjectFile {
	name: "bookbinder.md" | "book-print.md" | "book-print.yml";
	content: string;
	yaml: string;
	body: string;
}

export async function readProjectFile(directory: string): Promise<ProjectFile | undefined> {
	for (const name of ["bookbinder.md", "book-print.md", "book-print.yml"] as const) {
		let content: string;
		try { content = await readFile(path.join(directory, name), "utf8"); }
		catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
		if (name === "book-print.yml") return { name, content, yaml: content, body: "" };
		const frontmatter = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m.exec(content);
		if (!frontmatter || frontmatter.index !== 0) throw new Error(`${name} doit commencer par des propriétés YAML entre deux lignes ---.`);
		return { name, content, yaml: frontmatter[1], body: content.slice(frontmatter[0].length) };
	}
	return undefined;
}

export async function loadFont(filename: string): Promise<ImportedFont> {
	const name = path.basename(filename);
	if (!/\.(otf|ttf|woff2?)$/i.test(name)) throw new Error("Choisissez une police OTF, TTF, WOFF ou WOFF2.");
	const data = await readFile(filename);
	const signature = data.subarray(0, 4).toString("hex");
	if (!["4f54544f", "00010000", "74727565", "774f4646", "774f4632"].includes(signature)) throw new Error(`Police illisible : ${name}`);
	return { name, data };
}

export async function saveProjectFile(directory: string, yaml: string, expected: ProjectFile | undefined, fonts: ImportedFont[]): Promise<void> {
	const checkUnchanged = async () => {
		const current = await readProjectFile(directory);
		if (current?.name !== expected?.name || current?.content !== expected?.content) throw new Error("Le projet a été modifié ailleurs. Fermez cette fenêtre et ouvrez-le à nouveau.");
	};
	await checkUnchanged();
	for (const font of fonts) {
		if (path.basename(font.name) !== font.name || /[/\\\0]/.test(font.name)) throw new Error("Nom de police invalide.");
		try {
			const existing = await readFile(path.join(directory, "fonts", font.name));
			if (!existing.equals(Buffer.from(font.data))) throw new Error(`Une autre police porte déjà le nom ${font.name}. Renommez la police à importer.`);
		} catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
	}
	const temporary = await mkdtemp(path.join(directory, ".bookbinder-project-"));
	const createdFonts: ImportedFont[] = [];
	try {
		if (fonts.length) await mkdir(path.join(directory, "fonts"), { recursive: true });
		for (const [index, font] of fonts.entries()) {
			const staged = path.join(temporary, `font-${index}`);
			await writeFile(staged, font.data);
			try {
				await copyFile(staged, path.join(directory, "fonts", font.name), constants.COPYFILE_EXCL);
				createdFonts.push(font);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !(await readFile(path.join(directory, "fonts", font.name))).equals(Buffer.from(font.data))) throw error;
			}
		}
		await checkUnchanged();
		const staged = path.join(temporary, "bookbinder.md");
		const body = expected && expected.name !== "book-print.yml" ? expected.body : "\n[Modifier le projet](obsidian://bookbinder)\n";
		await writeFile(staged, `---\n${yaml.trimEnd()}\n---\n${body}`);
		if (expected?.name !== "bookbinder.md") await copyFile(staged, path.join(directory, "bookbinder.md"), constants.COPYFILE_EXCL);
		else await rename(staged, path.join(directory, "bookbinder.md"));
	} catch (error) {
		for (const font of createdFonts) {
			const destination = path.join(directory, "fonts", font.name);
			if ((await readFile(destination)).equals(Buffer.from(font.data))) await rm(destination);
		}
		throw error;
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}
