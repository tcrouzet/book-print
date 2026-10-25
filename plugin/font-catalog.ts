import catalog from "../fonts/catalog.json" with { type: "json" };
import { getLocale, t } from "./i18n.ts";

export interface FontCatalog {
	version: number;
	archive: { file: string; url: string; size: number; unpackedSize: number; sha256: string };
	families: {
		id: string; name: string; category: "corps" | "titres" | "symboles";
		designer: string; source: string; license: string; licenseUrl: string; metadataUrl: string;
		usage: { en: string; fr: string }; files: string[];
	}[];
	files: { path: string; kind: "font" | "note"; size: number; sha256: string }[];
}

export const fontCatalog: FontCatalog = catalog;

export function mountFontCatalog(container: HTMLElement, makeEl: typeof createEl = createEl): void {
	const details = makeEl("details"); details.className = "bookbinder-font-catalog";
	const summary = makeEl("summary"); summary.textContent = t("fontPackageCatalog"); details.append(summary);
	for (const [category, label] of [["corps", "bodyText"], ["titres", "headings"], ["symboles", "symbols"]] as const) {
		const heading = makeEl("h4"); heading.textContent = t(label); details.append(heading);
		for (const family of catalog.families.filter(item => item.category === category)) {
			const item = makeEl("details"); item.className = "bookbinder-font-family";
			const name = makeEl("summary"); name.textContent = family.name; item.append(name);
			const usage = makeEl("p"); usage.textContent = family.usage[getLocale()]; item.append(usage);
			const designer = makeEl("p"); designer.textContent = family.designer; item.append(designer);
			for (const [text, href] of [[t("fontSource"), family.source], [family.license, family.licenseUrl]]) {
				const link = makeEl("a"); link.textContent = text; link.href = href; link.target = "_blank"; link.rel = "noopener noreferrer"; item.append(link);
			}
			const variants = makeEl("p"); variants.textContent = family.files.join(", "); item.append(variants);
			details.append(item);
		}
	}
	container.append(details);
}
