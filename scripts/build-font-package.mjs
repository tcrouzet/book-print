import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

const root = new URL("../fonts/", import.meta.url);
const manifest = new URL("catalog.json", root);
const catalog = JSON.parse(await readFile(manifest, "utf8"));
const hash = data => createHash("sha256").update(data).digest("hex");
const files = [];
for (const entry of catalog.files) {
	if (!/^(?:README\.md|[A-Za-z0-9-]+\.otf|[A-Za-z0-9]+\.(?:md|LICENSE\.txt))$/.test(entry.path)) throw new Error(`Invalid package path: ${entry.path}`);
	const data = await readFile(new URL(entry.path, root));
	entry.size = data.length;
	entry.sha256 = hash(data);
	files.push({ path: entry.path, data: data.toString("base64") });
}
const unpacked = Buffer.from(JSON.stringify({ version: catalog.version, files }));
const archive = gzipSync(unpacked, { level: 9 });
await writeFile(new URL(catalog.archive.file, root), archive);
Object.assign(catalog.archive, { size: archive.length, unpackedSize: unpacked.length, sha256: hash(archive) });
await writeFile(manifest, JSON.stringify(catalog, null, 2) + "\n");
console.log(`${files.length} files, ${archive.length} compressed bytes, SHA-256 ${hash(archive)}`);
