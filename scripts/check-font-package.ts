import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { fontCatalog, fontLabel, fontTypeLabel, fontTypes } from "../plugin/font-catalog.ts";
import { decodeFontPackage, installFontPackage, isFontPackageInstalled, readFontPackage } from "../plugin/font-package.ts";
import { listFontLibrary } from "../plugin/font-library.ts";
import { detectFontType } from "../plugin/font-metadata.ts";
import { setLocale } from "../plugin/i18n.ts";

setLocale("en");
const fonts = new URL("../fonts/", import.meta.url);
const archive = await readFile(new URL(fontCatalog.archive.file, fonts));
const files = decodeFontPackage(archive);
assert.equal(detectFontType(files.get("FiraSans-Regular.otf")!), "sans-serif", "Import detects the font type from its contents without a filename");
const serifFont = files.get("NotoSerif-Regular.otf")!;
assert.equal(detectFontType(serifFont), "serif");
assert.equal(detectFontType(files.get("Alegreya-Regular.otf")!), undefined, "An unclassified font must not silently become sans serif");
let metricsEntry = 12;
while (serifFont.toString("ascii", metricsEntry, metricsEntry + 4) !== "OS/2") metricsEntry += 16;
const metricsOffset = serifFont.readUInt32BE(metricsEntry + 8);
const metricsLength = serifFont.readUInt32BE(metricsEntry + 12);
const metrics = serifFont.subarray(metricsOffset, metricsOffset + metricsLength);
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
	for (let length = 0; length < Math.min(font.length, 96); length++) assert.equal(detectFontType(font.subarray(0, length)), undefined, "Truncated metadata cannot be classified");
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
