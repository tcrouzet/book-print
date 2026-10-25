import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { gzipSync } from "node:zlib";
import { fontCatalog } from "../plugin/font-catalog.ts";
import { decodeFontPackage, installFontPackage, isFontPackageInstalled, readFontPackage } from "../plugin/font-package.ts";
import { listFontLibrary } from "../plugin/font-library.ts";
import { setLocale } from "../plugin/i18n.ts";

setLocale("en");
const fonts = new URL("../fonts/", import.meta.url);
const archive = await readFile(new URL(fontCatalog.archive.file, fonts));
const files = decodeFontPackage(archive);
assert.equal(fontCatalog.families.length, 22);
assert.equal(fontCatalog.files.filter(entry => entry.kind === "font").length, 84);
assert.equal(new Set(fontCatalog.files.map(entry => entry.path)).size, fontCatalog.files.length);
const names = fontCatalog.files.filter(entry => entry.kind === "font").map(entry => path.basename(entry.path));
assert.equal(new Set(names).size, names.length, "Flat library filenames do not collide");
for (const entry of fontCatalog.files) {
	assert.deepEqual(files.get(entry.path), await readFile(new URL(entry.path, fonts)), `Package bytes match source: ${entry.path}`);
	if (entry.kind === "font") assert.equal(files.get(entry.path)!.readUInt32BE(0), 0x00010000, "The supplied .otf files contain TrueType-flavoured OpenType data");
}
for (const family of fontCatalog.families) {
	const prefix = `${family.category}/${family.id}/`;
	assert.deepEqual(family.files.sort(), fontCatalog.files.filter(entry => entry.kind === "font" && entry.path.startsWith(prefix)).map(entry => path.basename(entry.path)).sort());
	assert.match(files.get(prefix + "LICENSE.txt")!.toString(), /SIL OPEN FONT LICENSE Version 1.1/);
	const note = files.get(prefix + "README.md")!.toString();
	assert.ok(note.includes(family.source) && note.includes(family.licenseUrl), "Each family has its source and licence in its note");
	assert.ok(family.usage.fr && family.usage.en);
}
const damaged = Buffer.from(archive); damaged[damaged.length - 1] ^= 1;
const changedHeader = Buffer.from(archive); changedHeader[4] ^= 1;
assert.throws(() => decodeFontPackage(changedHeader), /invalid font package/, "A valid gzip stream with a different hash must be rejected");
for (const invalid of [Buffer.alloc(0), archive.subarray(0, -1), damaged, gzipSync(JSON.stringify({ version: 1, files: [{ path: "../../escape.otf", data: "AA==" }] }))]) {
	assert.throws(() => decodeFontPackage(invalid), /invalid font package/);
}
const root = await mkdtemp(path.join(tmpdir(), "bookbinder-font-package-"));
try {
	const library = path.join(root, "data", "_fonts");
	assert.equal(await isFontPackageInstalled(library), false);
	await assert.rejects(installFontPackage(library, damaged), /invalid font package/);
	await assert.rejects(readdir(library), /ENOENT/, "Invalid downloads create no library files");
	let requested = false;
	assert.deepEqual(await readFontPackage(new URL(fontCatalog.archive.file, fonts).pathname, async () => { requested = true; throw new Error(); }), archive);
	assert.equal(requested, false, "A local source checkout needs no download");
	const remote = await readFontPackage(path.join(root, "not-bundled.gz"), async () => { requested = true; return archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength); });
	assert.equal(requested, true, "A released plugin downloads the separate package");
	assert.deepEqual(Buffer.from(remote), archive);
	await assert.rejects(readFontPackage(path.join(root, "missing.gz"), async () => { throw new Error("HTTP 404"); }), /HTTP 404/);
	await mkdir(library, { recursive: true });
	const conflict = path.join(library, names.at(-1)!);
	await writeFile(conflict, "My existing font");
	await assert.rejects(installFontPackage(library, archive), /already exists/);
	assert.equal(await readFile(conflict, "utf8"), "My existing font");
	assert.deepEqual(await readdir(library), [path.basename(conflict)], "All conflicts are checked before any package files are added");
	await unlink(conflict);
	await installFontPackage(library, archive);
	assert.equal(await isFontPackageInstalled(library), true);
	assert.equal((await listFontLibrary(library)).length, 84);
	await installFontPackage(library, archive);
	assert.equal((await listFontLibrary(library)).length, 84, "Reinstallation reuses identical fonts");
	for (const entry of fontCatalog.files) {
		const filename = entry.kind === "font" ? path.join(library, path.basename(entry.path)) : path.join(library, "_package-notes", entry.path);
		assert.equal(createHash("sha256").update(await readFile(filename)).digest("hex"), entry.sha256);
	}
	const note = path.join(library, "_package-notes", "README.md");
	await writeFile(note, "My edited note");
	assert.equal(await isFontPackageInstalled(library), false);
	await assert.rejects(installFontPackage(library, archive), /already exists/);
	assert.equal(await readFile(note, "utf8"), "My edited note");
	await writeFile(note, files.get("README.md")!);
	await unlink(path.join(library, names[0]));
	assert.equal(await isFontPackageInstalled(library), false);
	await installFontPackage(library, archive);
	assert.equal(await isFontPackageInstalled(library), true, "An interrupted installation can resume");
} finally { await rm(root, { recursive: true, force: true }); }
console.log("Font package: catalogue, licences, hashes, download boundary, shared installation and conflict preservation: OK.");
