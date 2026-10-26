import { t } from "./i18n.ts";
import { bindLengthInput, lengthValue } from "./length-input.ts";
import type { BookProject } from "./project.ts";

type Page = Record<string, string | number>;

export function mountTitlePage(container: HTMLElement, options: BookProject["titlePage"], changed: () => void, makeEl: typeof createEl = createEl): void {
	const heading = makeEl("h3"); heading.textContent = t("titlePage"); container.append(heading);
	const fields = makeEl("div"); fields.className = "bookbinder-page-fields"; container.append(fields);
	for (const [key, name] of [["copyright", t("showCopyright")], ["characterCount", t("showCharacterCount")]] as const) {
		const label = makeEl("label"); label.className = "bookbinder-page-field";
		const text = makeEl("span"); text.textContent = name; label.append(text);
		const input = makeEl("input"); input.type = "checkbox"; input.checked = options[key]; input.setAttribute("aria-label", name);
		input.addEventListener("change", () => { options[key] = input.checked; changed(); });
		label.append(input); fields.append(label);
	}
	const help = makeEl("p"); help.className = "bookbinder-muted"; help.textContent = t("titlePageDetailsDescription"); container.append(help);
}

export function mountTableOfContents(container: HTMLElement, project: Pick<BookProject, "toc" | "tocDepth">, format: "pdf" | "docx" | "epub", changed: () => void, makeEl: typeof createEl = createEl): void {
	const heading = makeEl("h3"); heading.textContent = t("tableOfContents"); container.append(heading);
	const fields = makeEl("div"); fields.className = "bookbinder-page-fields"; container.append(fields);
	const field = (name: string) => {
		const label = makeEl("label"); label.className = "bookbinder-page-field";
		const text = makeEl("span"); text.textContent = name; label.append(text);
		const select = makeEl("select"); select.classList.add("dropdown"); select.setAttribute("aria-label", name); label.append(select); fields.append(label); return select;
	};
	const enabled = field(t("includeTableOfContents"));
	for (const [value, text] of [["true", t("yes")], ["false", t("no")]]) {
		const option = makeEl("option"); option.value = value; option.textContent = text; enabled.append(option);
	}
	enabled.value = String(project.toc);
	const depth = field(t("tocDepth"));
	for (let level = 1; level <= 6; level++) {
		const option = makeEl("option"); option.value = String(level); option.textContent = t("tocLevel", { level }); depth.append(option);
	}
	depth.value = String(project.tocDepth); depth.disabled = !project.toc && format !== "epub";
	enabled.addEventListener("change", () => { project.toc = enabled.value === "true"; depth.disabled = !project.toc && format !== "epub"; changed(); });
	depth.addEventListener("change", () => { project.tocDepth = Number(depth.value); changed(); });
	if (format === "epub") { const help = makeEl("p"); help.className = "bookbinder-muted"; help.textContent = t("epubTocDescription"); container.append(help); }
}

export const folioPositions = ["none", "left", "center", "right", "inner", "outer"] as const;

export function folioPage(page: Page, even = false): { position: string; offset: number; alignment: string } {
	const position = String(page["folio-position"] ?? "center"), offset = millimetres(page["folio-offset"] ?? "10mm");
	if (!folioPositions.some(value => value === position) || !Number.isFinite(offset) || offset < 0 || offset > 300) throw new Error(t("invalidFolio"));
	const mirrored = page["page-mode"] === "double" && even;
	const alignment = position === "inner" ? mirrored ? "right" : "left" : position === "outer" ? mirrored ? "left" : "right" : position;
	return { position, offset, alignment };
}

export function mountFolio(container: HTMLElement, page: Page, changed: () => void, makeEl: typeof createEl = createEl): void {
	const heading = makeEl("h3"); heading.textContent = t("folio"); container.append(heading);
	const fields = makeEl("div"); fields.className = "bookbinder-page-fields"; container.append(fields);
	const label = makeEl("label"); label.className = "bookbinder-page-field";
	const text = makeEl("span"); text.textContent = t("folioPosition"); label.append(text);
	const select = makeEl("select"); select.classList.add("dropdown"); select.setAttribute("aria-label", t("folioPosition"));
	for (const [value, key] of [["none", "noFolio"], ["left", "left"], ["center", "centred"], ["right", "right"], ["inner", "inner"], ["outer", "outer"]] as const) {
		const option = makeEl("option"); option.value = value; option.textContent = t(key); select.append(option);
	}
	select.value = folioPage(page).position; label.append(select); fields.append(label);
	const distance = makeEl("label"); distance.className = "bookbinder-page-field";
	const title = makeEl("span"); title.textContent = t("folioOffset"); distance.append(title);
	const input = makeEl("input"); input.value = String(folioPage(page).offset); input.setAttribute("aria-label", t("folioOffset"));
	bindLengthInput(input, "mm", 0, 300, value => { if (value === undefined) delete page["folio-offset"]; else page["folio-offset"] = value + "mm"; changed(); });
	input.addEventListener("blur", () => { if (!input.value) input.value = String(folioPage(page).offset); });
	input.disabled = select.value === "none"; distance.append(input); fields.append(distance);
	select.addEventListener("change", () => { page["folio-position"] = select.value; input.disabled = select.value === "none"; changed(); });
}
export const paperSizes = { a4: [210, 297], a5: [148, 210] } as const;

export function millimetres(value: string | number): number {
	if (/(?:em|rem|%)\s*$/i.test(String(value))) return NaN;
	return lengthValue(value, "mm");
}

export function pdfMarginField(page: Page, side: string): string {
	if (page["page-mode"] === "double") {
		if (side === "left") return "margin-inner";
		if (side === "right") return "margin-outer";
	}
	return "margin-" + side;
}

export function pdfPage(page: Page): { width: number; height: number; top: number; bottom: number; left: number; right: number; double: boolean; binding: number } {
	folioPage(page);
	const size = page["paper-size"] ?? "a5";
	if (size !== "custom" && size !== "a4" && size !== "a5") throw new Error(t("invalidPaperSize"));
	const mode = page["page-mode"] ?? "single";
	if (mode !== "single" && mode !== "double") throw new Error(t("invalidPageMode"));
	const [width, height] = size === "custom" ? ["paper-width", "paper-height"].map(field => {
		const value = millimetres(page[field]);
		if (!Number.isFinite(value) || value < 20 || value > 2000) throw new Error(t("invalidPaperDimension", { field }));
		return value;
	}) : paperSizes[size];
	const margins = Object.fromEntries(["top", "bottom", "left", "right"].map(side => {
		const field = pdfMarginField(page, side), value = millimetres(page[field] ?? page["margin-" + side] ?? "20mm");
		if (!Number.isFinite(value) || value < 0) throw new Error(t("invalidPageMargin", { field }));
		return [side, value];
	})) as Record<"top" | "bottom" | "left" | "right", number>;
	const binding = millimetres(page["binding-offset"] ?? "0mm");
	if (!Number.isFinite(binding) || binding < 0) throw new Error(t("invalidPageMargin", { field: "binding-offset" }));
	if (margins.left + margins.right + binding >= width || margins.top + margins.bottom >= height) throw new Error(t("paperMarginsTooLarge"));
	return { width, height, ...margins, double: mode === "double", binding };
}

export function mountPaperFormat(container: HTMLElement, page: Page, changed: () => void, makeEl: typeof createEl = createEl): void {
	const wrapper = makeEl("label"); wrapper.className = "bookbinder-page-field";
	const label = makeEl("span"); label.textContent = t("paperFormat"); wrapper.append(label);
	const select = makeEl("select"); select.classList.add("dropdown"); select.setAttribute("aria-label", t("paperFormat"));
	for (const [value, text] of [["a4", "A4"], ["a5", "A5"], ["custom", t("customPaperSize")]]) {
		const option = makeEl("option"); option.value = value; option.textContent = text; select.append(option);
	}
	page["paper-size"] ??= "a5";
	select.value = String(page["paper-size"]); wrapper.append(select); container.append(wrapper);
	const dimensions = makeEl("div"); dimensions.className = "bookbinder-page-fields"; container.append(dimensions);
	const render = () => {
		dimensions.hidden = select.value !== "custom";
		dimensions.replaceChildren();
		if (dimensions.hidden) return;
		for (const [field, text, fallback] of [["paper-width", t("paperWidth"), 148], ["paper-height", t("paperHeight"), 210]] as const) {
			page[field] ??= fallback + "mm";
			const row = makeEl("label"); row.className = "bookbinder-page-field";
			const title = makeEl("span"); title.textContent = text; row.append(title);
			const input = makeEl("input"); input.type = "number"; input.min = "20"; input.max = "2000"; input.step = "any";
			input.required = true; input.value = String(millimetres(page[field])); input.setAttribute("aria-label", text);
			bindLengthInput(input, "mm", 20, 2000, value => { page[field] = value + "mm"; changed(); });
			row.append(input); dimensions.append(row);
		}
	};
	select.addEventListener("change", () => { page["paper-size"] = select.value; render(); changed(); });
	render();
	const modeRow = makeEl("label"); modeRow.className = "bookbinder-page-field";
	const modeTitle = makeEl("span"); modeTitle.textContent = t("pageMode"); modeRow.append(modeTitle);
	const mode = makeEl("select"); mode.classList.add("dropdown"); mode.setAttribute("aria-label", t("pageMode"));
	for (const [value, text] of [["single", t("singlePage")], ["double", t("doublePage")]]) {
		const option = makeEl("option"); option.value = value; option.textContent = text; mode.append(option);
	}
	page["page-mode"] ??= "single";
	mode.value = String(page["page-mode"]);
	mode.addEventListener("change", () => { page["page-mode"] = mode.value; changed(); });
	modeRow.append(mode); container.append(modeRow);
}
