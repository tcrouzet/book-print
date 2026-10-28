import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { gunzipSync } from "node:zlib";
import { fontCatalog as catalog, type FontCatalog } from "./font-catalog.ts";
import { listFontLibrary, saveLibraryFont } from "./font-library.ts";
import { fontsInStyles, libraryFontPrefix, type Presentation } from "./presentation.ts";
import { t } from "./i18n.ts";

const hash = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");

function destination(directory: string, entry: FontCatalog["files"][number]): string {
	if (!/^(?:README\.md|[A-Za-z0-9-]+\.otf|[A-Za-z0-9]+\.(?:md|LICENSE\.txt))$/.test(entry.path)) throw new Error(t("fontPackageInvalid"));
	return path.join(directory, entry.kind === "font" ? entry.path : "_package-" + entry.path);
}

export function decodeFontPackage(data: Uint8Array): Map<string, Buffer> {
	try {
		if (data.length !== catalog.archive.size || hash(data) !== catalog.archive.sha256) throw new Error();
		const unpacked = gunzipSync(data, { maxOutputLength: catalog.archive.unpackedSize });
		if (unpacked.length !== catalog.archive.unpackedSize) throw new Error();
		const value: unknown = JSON.parse(unpacked.toString("utf8"));
		if (!value || typeof value !== "object" || !("version" in value) || value.version !== catalog.version || !("files" in value) || !Array.isArray(value.files) || value.files.length !== catalog.files.length) throw new Error();
		const files = new Map<string, Buffer>();
		for (const file of value.files as unknown[]) {
			if (!file || typeof file !== "object" || !("path" in file) || typeof file.path !== "string" || !("data" in file) || typeof file.data !== "string" || files.has(file.path)) throw new Error();
			const expected = catalog.files.find(entry => entry.path === file.path);
			if (!expected) throw new Error();
			const bytes = Buffer.from(file.data, "base64");
			if (bytes.toString("base64") !== file.data || bytes.length !== expected.size || hash(bytes) !== expected.sha256) throw new Error();
			files.set(file.path, bytes);
		}
		return files;
	} catch { throw new Error(t("fontPackageInvalid")); }
}

async function existing(filename: string): Promise<Buffer | undefined> {
	try { return await readFile(filename); }
	catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

export async function isFontPackageInstalled(directory: string): Promise<boolean> {
	for (const entry of catalog.files) {
		const bytes = await existing(destination(directory, entry));
		if (!bytes || bytes.length !== entry.size || hash(bytes) !== entry.sha256) return false;
	}
	return true;
}

export async function readFontPackage(localFile: string, download: () => Promise<ArrayBuffer>): Promise<Uint8Array> {
	return await existing(localFile) ?? new Uint8Array(await download());
}

export async function needsFontPackage(project: Presentation, directory: string): Promise<boolean> {
	const packaged = catalog.files.filter(entry => entry.kind === "font").map(entry => libraryFontPrefix + entry.path);
	const required = fontsInStyles(project, packaged).filter(reference => packaged.includes(reference));
	if (!required.length) return false;
	const installed = new Set(await listFontLibrary(directory));
	return required.some(reference => !installed.has(reference));
}

export async function installFontPackage(directory: string, data: Uint8Array): Promise<void> {
	const files = decodeFontPackage(data);
	// Check every conflict before adding any files to the shared library.
	for (const entry of catalog.files) {
		const bytes = await existing(destination(directory, entry));
		if (bytes && !bytes.equals(files.get(entry.path)!)) throw new Error(t("fontPackageConflict", { file: path.basename(entry.path) }));
	}
	for (const entry of catalog.files) {
		const bytes = files.get(entry.path)!;
		if (entry.kind === "font") await saveLibraryFont(directory, { name: path.basename(entry.path), data: bytes });
		else {
			const filename = destination(directory, entry);
			await mkdir(path.dirname(filename), { recursive: true });
			try { await writeFile(filename, bytes, { flag: "wx" }); }
			catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
				if (!(await readFile(filename)).equals(bytes)) throw new Error(t("fontPackageConflict", { file: path.basename(filename) }));
			}
		}
	}
}
