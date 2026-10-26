import catalog from "../fonts/catalog.json" with { type: "json" };
import { getLocale, t } from "./i18n.ts";
import { fontFace, fontFilename, type FontFaceInfo } from "./presentation.ts";

export type FontType = "serif" | "sans-serif" | "symbol";
export interface LibraryFontInfo { reference: string; type?: FontType; face?: FontFaceInfo }
export const fontTypes: FontType[] = ["serif", "sans-serif", "symbol"];

export function fontTypeLabel(type: FontType): string {
	return t(type === "sans-serif" ? "sansSerif" : type === "symbol" ? "fontSymbol" : "serif");
}

export function bundledFontType(reference: string): FontType | undefined {
	return catalog.families.find(family => family.files.includes(fontFilename(reference)))?.category;
}

export function fontLabel(reference: string, type = bundledFontType(reference), face?: FontFaceInfo): string {
	const name = face?.family ?? catalog.families.find(family => family.files.includes(fontFilename(reference)))?.name ?? fontFace(reference).family;
	return name + (type ? " (" + fontTypeLabel(type) + ")" : "");
}

export interface FontCatalog {
	version: number;
	archive: { file: string; url: string; size: number; unpackedSize: number; sha256: string };
	families: {
		id: string; name: string; category: FontType;
		designer: string; source: string; license: string; licenseUrl: string; metadataUrl: string;
		usage: { en: string; fr: string }; files: string[];
	}[];
	files: { path: string; kind: "font" | "note"; size: number; sha256: string }[];
}

export const fontCatalog: FontCatalog = catalog;

export function mountFontCatalog(container: HTMLElement, makeEl: typeof createEl = createEl, library: readonly LibraryFontInfo[] = []): void {
	const details = makeEl("details"); details.className = "bookbinder-font-catalog";
	const summary = makeEl("summary"); summary.textContent = t("fontPackageCatalog"); details.append(summary);
	const personal = library.filter(font => !catalog.families.some(family => family.files.includes(fontFilename(font.reference))))
		.map(font => ({ name: fontFilename(font.reference), category: font.type, designer: "", usage: t("personalFont"), source: "", license: "", licenseUrl: "", files: [fontFilename(font.reference)] }));
	const packaged = catalog.families.map(family => ({ ...family, usage: family.usage[getLocale()] }));
	for (const family of [...packaged, ...personal].sort((left, right) => left.name.localeCompare(right.name, getLocale()))) {
		const item = makeEl("details"); item.className = "bookbinder-font-family";
		const name = makeEl("summary"); name.textContent = family.name + (family.category ? " (" + fontTypeLabel(family.category) + ")" : ""); item.append(name);
		const usage = makeEl("p"); usage.textContent = family.usage; item.append(usage);
		if (family.designer) { const designer = makeEl("p"); designer.textContent = family.designer; item.append(designer); }
		for (const [text, href] of [[t("fontSource"), family.source], [family.license, family.licenseUrl]]) {
			if (!href) continue;
			const link = makeEl("a"); link.textContent = text; link.href = href; link.target = "_blank"; link.rel = "noopener noreferrer"; item.append(link);
		}
		const variants = makeEl("p"); variants.textContent = family.files.join(", "); item.append(variants);
		details.append(item);
	}
	container.append(details);
}
