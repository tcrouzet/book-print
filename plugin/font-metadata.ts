import { brotliDecompressSync, inflateSync } from "node:zlib";
import type { FontType } from "./font-catalog.ts";

const maxDecodedSize = 64 * 1024 * 1024;

function slice(data: Buffer, offset: number, length: number): Buffer {
	if (offset < 0 || length < 0 || offset + length > data.length) throw new RangeError("Font table outside file");
	return data.subarray(offset, offset + length);
}

function woff2Metrics(data: Buffer): Buffer | undefined {
	if (data.length < 48 || data.toString("ascii", 4, 8) === "ttcf" || data.readUInt32BE(8) !== data.length) return;
	let cursor = 48, size = 0, metricsOffset = -1, metricsLength = 0;
	const base128 = () => {
		let value = 0;
		for (let index = 0; index < 5; index++) {
			const byte = data.readUInt8(cursor++);
			if ((index === 0 && byte === 0x80) || value > 0x1ffffff) throw new RangeError("Invalid font table length");
			value = value * 128 + (byte & 0x7f);
			if (!(byte & 0x80)) return value;
		}
		throw new RangeError("Invalid font table length");
	};
	for (let index = 0; index < data.readUInt16BE(12); index++) {
		const flags = data.readUInt8(cursor++), tagIndex = flags & 63, version = flags >> 6;
		let tag = tagIndex === 6 ? "OS/2" : tagIndex === 10 ? "glyf" : tagIndex === 11 ? "loca" : tagIndex === 3 ? "hmtx" : "";
		if (tagIndex === 63) { tag = slice(data, cursor, 4).toString("ascii"); cursor += 4; }
		const originalLength = base128();
		const outlines = tag === "glyf" || tag === "loca";
		if (outlines ? version !== 0 && version !== 3 : version !== 0 && !(tag === "hmtx" && version === 1)) return;
		const transformed = outlines ? version === 0 : version !== 0;
		const length = transformed ? base128() : originalLength;
		if (tag === "OS/2") { metricsOffset = size; metricsLength = length; }
		size += length;
		if (size > maxDecodedSize) return;
	}
	if (metricsOffset < 0 || !size) return;
	// OS/2 is never transformed; other tables only determine its offset in the Brotli stream.
	const decoded = brotliDecompressSync(slice(data, cursor, data.readUInt32BE(20)), { maxOutputLength: size });
	if (decoded.length !== size) return;
	return slice(decoded, metricsOffset, metricsLength);
}

function metricsTable(data: Buffer): Buffer | undefined {
	const signature = data.readUInt32BE(0);
	if (signature === 0x774f4632) return woff2Metrics(data);
	const woff = signature === 0x774f4646;
	if (!woff && ![0x00010000, 0x4f54544f, 0x74727565].includes(signature)) return;
	const count = data.readUInt16BE(woff ? 12 : 4), start = woff ? 44 : 12, stride = woff ? 20 : 16;
	slice(data, start, count * stride);
	for (let index = 0; index < count; index++) {
		const entry = start + index * stride;
		if (data.toString("ascii", entry, entry + 4) !== "OS/2") continue;
		const offset = data.readUInt32BE(entry + (woff ? 4 : 8));
		const length = data.readUInt32BE(entry + (woff ? 8 : 12));
		const bytes = slice(data, offset, length);
		if (!woff) return bytes;
		const originalLength = data.readUInt32BE(entry + 12);
		if (length > originalLength || originalLength > maxDecodedSize) return;
		if (length === originalLength) return bytes;
		const decoded = inflateSync(bytes, { maxOutputLength: originalLength });
		return decoded.length === originalLength ? decoded : undefined;
	}
}

export function detectFontType(data: Uint8Array): FontType | undefined {
	try {
		const metrics = metricsTable(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
		if (!metrics || metrics.length < 42) return;
		const family = metrics[30], panose = metrics[32], serif = metrics[33];
		if (panose === 5 || family === 12 || (metrics.readUInt16BE(0) >= 1 && metrics.length >= 86 && (metrics.readUInt32BE(78) & 0x80000000))) return "symbol";
		const panoseType = panose === 2 && serif >= 2 && serif <= 15 ? (serif <= 10 ? "serif" : "sans-serif") : undefined;
		const familyType = family === 8 ? "sans-serif" : [1, 2, 3, 4, 5, 7].includes(family) ? "serif" : undefined;
		if (panoseType && familyType && panoseType !== familyType) return;
		return panoseType ?? familyType;
	} catch { return undefined; }
}
