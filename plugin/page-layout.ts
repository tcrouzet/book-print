import { t } from "./i18n.ts";

type Page = Record<string, string | number>;
export const paperSizes = { a4: [210, 297], a5: [148, 210] } as const;

export function millimetres(value: string | number): number {
	const match = String(value).match(/^(-?\d+(?:\.\d+)?)(mm|cm|in|pt|px)?$/);
	if (!match) return NaN;
	return Number(match[1]) * ({ mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, px: 25.4 / 96 }[match[2] ?? "mm"] ?? NaN);
}

export function pdfMarginField(page: Page, side: string): string {
	if (page["page-mode"] === "double") {
		if (side === "left") return "margin-inner";
		if (side === "right") return "margin-outer";
	}
	return "margin-" + side;
}

export function pdfPage(page: Page): { width: number; height: number; top: number; bottom: number; left: number; right: number; double: boolean; binding: number } {
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
	const select = makeEl("select"); select.setAttribute("aria-label", t("paperFormat"));
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
			input.addEventListener("input", () => { if (input.checkValidity()) { page[field] = input.valueAsNumber + "mm"; changed(); } });
			row.append(input); dimensions.append(row);
		}
	};
	select.addEventListener("change", () => { page["paper-size"] = select.value; render(); changed(); });
	render();
	const modeRow = makeEl("label"); modeRow.className = "bookbinder-page-field";
	const modeTitle = makeEl("span"); modeTitle.textContent = t("pageMode"); modeRow.append(modeTitle);
	const mode = makeEl("select"); mode.setAttribute("aria-label", t("pageMode"));
	for (const [value, text] of [["single", t("singlePage")], ["double", t("doublePage")]]) {
		const option = makeEl("option"); option.value = value; option.textContent = text; mode.append(option);
	}
	page["page-mode"] ??= "single";
	mode.value = String(page["page-mode"]);
	mode.addEventListener("change", () => { page["page-mode"] = mode.value; changed(); });
	modeRow.append(mode); container.append(modeRow);
}
