import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { fontCatalog, fontLabel, fontTypeLabel, fontTypes } from "../plugin/font-catalog.ts";
import { decodeFontPackage, installFontPackage, isFontPackageInstalled, needsFontPackage, readFontPackage } from "../plugin/font-package.ts";
import { listFontLibrary } from "../plugin/font-library.ts";
import { fontFamily, fontResources } from "../plugin/presentation.ts";
import { detectFontFace, detectFontType, fontEmbeddingAllowed } from "../plugin/font-metadata.ts";
import { setLocale } from "../plugin/i18n.ts";

setLocale("en");
const fonts = new URL("../fonts/", import.meta.url);
const archive = await readFile(new URL(fontCatalog.archive.file, fonts));
const files = decodeFontPackage(archive);
for (const [suffix, weight, style] of [["Regular", 400, "normal"], ["Bold", 700, "normal"], ["Italic", 400, "italic"], ["BoldItalic", 700, "italic"]] as const) {
	assert.deepEqual(detectFontFace(files.get(`EBGaramond-${suffix}.otf`)!), { family: "EB Garamond", weight, style }, "The face comes from the font header, independently of its filename");
}
assert.equal(detectFontType(files.get("FiraSans-Regular.otf")!), "sans-serif", "Import detects the font type from its contents without a filename");
const serifFont = files.get("NotoSerif-Regular.otf")!;
assert.equal(detectFontType(serifFont), "serif");
assert.equal(detectFontType(files.get("Alegreya-Regular.otf")!), undefined, "An unclassified font must not silently become sans serif");
let metricsEntry = 12;
while (serifFont.toString("ascii", metricsEntry, metricsEntry + 4) !== "OS/2") metricsEntry += 16;
const metricsOffset = serifFont.readUInt32BE(metricsEntry + 8);
const metricsLength = serifFont.readUInt32BE(metricsEntry + 12);
const metrics = serifFont.subarray(metricsOffset, metricsOffset + metricsLength);
for (const [flags, allowed] of [[0, true], [8, true], [0x100, true], [2, false], [4, false], [0x200, false], [0x208, false]] as const) {
	const font = Buffer.from(serifFont); font.writeUInt16BE(flags, metricsOffset + 8);
	assert.equal(fontEmbeddingAllowed(font), allowed, "Word embedding respects the font header permissions");
}
assert.equal(fontEmbeddingAllowed(Buffer.alloc(0)), false);
for (const [family, panose, serif, expected] of [
	[0, 5, 0, "symbol"], [12, 0, 0, "symbol"], [8, 0, 0, "sans-serif"], [7, 0, 0, "serif"],
	[0, 2, 10, "serif"], [0, 2, 11, "sans-serif"], [0, 2, 15, "sans-serif"],
	[0, 2, 0, undefined], [6, 0, 0, undefined], [0, 3, 11, undefined], [8, 2, 2, undefined],
] as const) {
	const font = Buffer.from(serifFont);
	font[metricsOffset + 30] = family; font[metricsOffset + 32] = panose; font[metricsOffset + 33] = serif;
	assert.equal(detectFontType(font), expected, "PANOSE, IBM classes and ambiguous metadata are distinguished");
}
const symbolFont = Buffer.from(serifFont); symbolFont[metricsOffset + 78] |= 0x80;
assert.equal(detectFontType(symbolFont), "symbol", "The symbol code-page flag takes precedence over serif appearance");
for (const compressed of [false, true]) {
	const bytes = compressed ? deflateSync(metrics) : metrics;
	const header = Buffer.alloc(64); header.write("wOFF"); header.writeUInt32BE(0x10000, 4);
	header.writeUInt32BE(header.length + bytes.length, 8); header.writeUInt16BE(1, 12);
	header.write("OS/2", 44); header.writeUInt32BE(64, 48); header.writeUInt32BE(bytes.length, 52); header.writeUInt32BE(metrics.length, 56);
	assert.equal(detectFontType(Buffer.concat([header, bytes])), "serif", "WOFF metadata is read with or without compression");
}
function base128(value: number): number[] {
	const bytes = [value & 127];
	while ((value = Math.floor(value / 128))) bytes.unshift((value & 127) | 128);
	return bytes;
}
const nameEntry = Array.from({ length: serifFont.readUInt16BE(4) }, (_, index) => 12 + index * 16).find(offset => serifFont.toString("ascii", offset, offset + 4) === "name")!;
const nameTable = serifFont.subarray(serifFont.readUInt32BE(nameEntry + 8), serifFont.readUInt32BE(nameEntry + 8) + serifFont.readUInt32BE(nameEntry + 12));
const compressedTables = [nameTable, metrics].map(table => deflateSync(table));
const woffHeader = Buffer.alloc(84); woffHeader.write("wOFF"); woffHeader.writeUInt32BE(0x10000, 4); woffHeader.writeUInt16BE(2, 12);
let tableOffset = woffHeader.length;
for (const [index, table] of compressedTables.entries()) {
	const entry = 44 + index * 20;
	woffHeader.write(index === 0 ? "name" : "OS/2", entry); woffHeader.writeUInt32BE(tableOffset, entry + 4);
	woffHeader.writeUInt32BE(table.length, entry + 8); woffHeader.writeUInt32BE(index === 0 ? nameTable.length : metrics.length, entry + 12);
	tableOffset += table.length;
}
woffHeader.writeUInt32BE(tableOffset, 8);
assert.deepEqual(detectFontFace(Buffer.concat([woffHeader, ...compressedTables])), detectFontFace(serifFont), "Compressed WOFF retains family, weight and italic information");
const nameDirectory = Buffer.from([5, ...base128(nameTable.length), 6, ...base128(metrics.length)]);
const nameStream = brotliCompressSync(Buffer.concat([nameTable, metrics]));
const nameHeader = Buffer.alloc(48); nameHeader.write("wOF2"); nameHeader.writeUInt32BE(0x10000, 4); nameHeader.writeUInt16BE(2, 12);
nameHeader.writeUInt32BE(48 + nameDirectory.length + nameStream.length, 8); nameHeader.writeUInt32BE(nameStream.length, 20);
assert.deepEqual(detectFontFace(Buffer.concat([nameHeader, nameDirectory, nameStream])), detectFontFace(serifFont), "WOFF2 retains family, weight and italic information");
const webFonts: Buffer[] = [];
for (const customTag of [false, true]) {
	// A transformed outline table precedes OS/2, so its stored length determines the offset.
	const directory = Buffer.from([10, ...base128(1000), 3, 11, 4, 0, ...(customTag ? [63, ...Buffer.from("OS/2")] : [6]), ...base128(metrics.length)]);
	const stream = brotliCompressSync(Buffer.concat([Buffer.from([1, 2, 3]), metrics]));
	const header = Buffer.alloc(48); header.write("wOF2"); header.writeUInt32BE(0x10000, 4);
	header.writeUInt32BE(48 + directory.length + stream.length, 8); header.writeUInt16BE(3, 12); header.writeUInt32BE(stream.length, 20);
	const font = Buffer.concat([header, directory, stream]); webFonts.push(font);
	assert.equal(detectFontType(font), "serif", "WOFF2 metadata survives transformed tables and explicit tags");
}
for (const font of [serifFont, ...webFonts]) {
	for (let length = 0; length < Math.min(font.length, 96); length++) {
		assert.equal(detectFontType(font.subarray(0, length)), undefined, "Truncated metadata cannot be classified");
		assert.equal(detectFontFace(font.subarray(0, length)), undefined, "Truncated face metadata cannot be classified");
	}
}
const outside = Buffer.from(serifFont); outside.writeUInt32BE(0xffffffff, metricsEntry + 8);
assert.equal(detectFontType(outside), undefined, "Out-of-bounds table offsets are rejected");
let seed = 42;
for (let index = 0; index < 500; index++) {
	const font = Buffer.from(webFonts[index % webFonts.length]);
	for (let edit = 0; edit < 4; edit++) {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		font[seed % font.length] ^= seed >>> 24;
	}
	assert.ok([undefined, "serif", "sans-serif", "symbol"].includes(detectFontType(font)), "Malformed compressed metadata never escapes the detector");
	assert.equal(detectFontFace(font), undefined, "Malformed containers without a name table cannot create a family");
}
assert.equal(fontCatalog.families.length, 22);
assert.equal(fontCatalog.files.filter(entry => entry.kind === "font").length, 84);
assert.equal(new Set(fontCatalog.files.map(entry => entry.path)).size, fontCatalog.files.length);
assert.ok((await readdir(fonts, { withFileTypes: true })).every(entry => entry.isFile()), "The source fonts folder has no subdirectories");
assert.ok(fontCatalog.files.every(entry => !entry.path.includes("/") && !entry.path.includes("\\")), "Every package entry is a flat filename");
assert.equal(fontCatalog.version, 2);
const names = fontCatalog.files.filter(entry => entry.kind === "font").map(entry => path.basename(entry.path));
assert.equal(new Set(names).size, names.length, "Flat library filenames do not collide");
for (const entry of fontCatalog.files) {
	assert.deepEqual(files.get(entry.path), await readFile(new URL(entry.path, fonts)), `Package bytes match source: ${entry.path}`);
	if (entry.kind === "font") assert.equal(files.get(entry.path)!.readUInt32BE(0), 0x00010000, "The supplied .otf files contain TrueType-flavoured OpenType data");
}
for (const family of fontCatalog.families) {
	assert.ok(fontTypes.includes(family.category));
	assert.deepEqual(family.files.slice().sort(), fontCatalog.files.filter(entry => entry.kind === "font" && family.files.includes(entry.path)).map(entry => entry.path).sort());
	assert.match(files.get(family.id + ".LICENSE.txt")!.toString(), /SIL OPEN FONT LICENSE Version 1.1/);
	const note = files.get(family.id + ".md")!.toString();
	assert.ok(note.includes(family.source) && note.includes(family.licenseUrl), "Each family has its source and licence in its note");
	assert.ok(note.includes(family.id + ".LICENSE.txt"), "The flat note links to its adjacent licence");
	assert.ok(family.files.every(file => fontLabel(file).endsWith("(" + fontTypeLabel(family.category) + ")")), "Every packaged face has its type in its label");
	assert.ok(family.usage.fr && family.usage.en);
}
const damaged = Buffer.from(archive); damaged[damaged.length - 1] ^= 1;
const changedHeader = Buffer.from(archive); changedHeader[4] ^= 1;
assert.throws(() => decodeFontPackage(changedHeader), /invalid font package/, "A valid gzip stream with a different hash must be rejected");
for (const invalid of [Buffer.alloc(0), archive.subarray(0, -1), damaged, gzipSync(JSON.stringify({ version: fontCatalog.version, files: [{ path: "../../escape.otf", data: "AA==" }] }))]) {
	assert.throws(() => decodeFontPackage(invalid), /invalid font package/);
}
const root = await mkdtemp(path.join(tmpdir(), "bookbinder-font-package-"));
try {
	const library = path.join(root, "data", "_fonts");
	const regular = "library:EBGaramond-Regular.otf";
	const project = { style: { "font-family": fontFamily(regular) }, headings: {}, fonts: [] };
	const snapshot = structuredClone(project);
	assert.equal(await needsFontPackage(project, library), true, "A style can require a package font before the library exists");
	assert.deepEqual(project, snapshot, "Checking fonts does not change project styles");
	assert.equal(await needsFontPackage({ style: {}, headings: {}, fonts: [regular] }, library), false, "Unused package fonts do not trigger a download");
	assert.equal(await needsFontPackage({ style: { "font-family": "serif" }, headings: {}, fonts: [] }, library), false, "Reader and system fonts do not require the package");
	assert.equal(await needsFontPackage({ style: { "font-family": fontFamily("Personal.ttf") }, headings: {}, fonts: ["library:Personal.ttf"] }, library), false, "A personal font is not supplied by the package");
	for (const section of ["headings", "styles", "rules"]) assert.equal(await needsFontPackage({ style: {}, headings: {}, fonts: [], [section]: { selected: { "font-family": fontFamily(regular) } } }, library), true, "Package fonts in " + section + " are detected");
	const partial = path.join(root, "partial"); await mkdir(partial);
	await writeFile(path.join(partial, "EBGaramond-Regular.otf"), files.get("EBGaramond-Regular.otf")!);
	assert.equal(await needsFontPackage(project, partial), true, "Missing bold and italic faces trigger installation too");
	for (const reference of fontResources(regular, names.map(name => "library:" + name))) await writeFile(path.join(partial, path.basename(reference.slice("library:".length))), files.get(reference.slice("library:".length))!);
	assert.equal(await needsFontPackage(project, partial), false, "No download when all required faces exist, even if the rest of the package is absent");
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
	assert.equal(await needsFontPackage(project, library), false);
	assert.equal((await listFontLibrary(library)).length, 84);
	await installFontPackage(library, archive);
	assert.equal((await listFontLibrary(library)).length, 84, "Reinstallation reuses identical fonts");
	for (const entry of fontCatalog.files) {
		const filename = path.join(library, entry.kind === "font" ? entry.path : "_package-" + entry.path);
		assert.equal(createHash("sha256").update(await readFile(filename)).digest("hex"), entry.sha256);
	}
	assert.ok((await readdir(library, { withFileTypes: true })).every(entry => entry.isFile()), "A fresh installed library is flat too");
	const note = path.join(library, "_package-README.md");
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
