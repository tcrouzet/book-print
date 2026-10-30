import { t } from "./i18n.ts";
import { footnoteSeparatorStyle } from "./book-styles.ts";
import { bindLengthInput, lengthValue } from "./length-input.ts";
import { pdfPage } from "./page-layout.ts";
import type { Presentation } from "./presentation.ts";

export function footnoteSeparator(project: Presentation): { width: number; textWidth: number; thickness: number; color: string; alignment: string; hidden: boolean } {
	const values = project.styles?.[footnoteSeparatorStyle.selector] ?? {}, page = pdfPage(project.page ?? {});
	const textWidth = (page.width - page.left - page.right - page.binding) * 72 / 25.4;
	const size = lengthValue(project.style["font-size"] ?? "11pt", "pt", 11);
	const rawWidth = values.width ?? "40%", width = lengthValue(rawWidth, "pt", /%\s*$/.test(String(rawWidth)) ? textWidth : size, size);
	const thickness = lengthValue(values["border-top-width"] ?? "0.4pt", "pt", size);
	const colors: Record<string, string> = { black: "000000", white: "FFFFFF", red: "FF0000", green: "008000", blue: "0000FF", gray: "808080", transparent: "000000" };
	const rawColor = String(values.color ?? "#000000"), hex = rawColor.match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i)?.[1];
	const color = hex ? hex.length === 3 ? [...hex].map(character => character.repeat(2)).join("") : hex : colors[rawColor];
	const alignment = String(values["text-align"] ?? "left");
	if (!Number.isFinite(width) || width < 0 || width > textWidth || !Number.isFinite(thickness) || thickness < 0 || thickness > 12 || typeof color !== "string" || !["left", "center", "right"].includes(alignment) || values.display !== undefined && !["block", "none"].includes(String(values.display))) throw new Error(t("invalidFootnoteSeparator"));
	return { width, textWidth, thickness, color: color.toUpperCase(), alignment, hidden: values.display === "none" || rawColor === "transparent" || !width || !thickness };
}

export function mountFootnoteSeparator(container: HTMLElement, project: Presentation, changed: () => void, makeEl: typeof createEl = createEl): void {
	const current = footnoteSeparator(project), values = (project.styles ??= {})[footnoteSeparatorStyle.selector] ??= {};
	const field = (name: string) => {
		const label = makeEl("label"); label.className = "bookbinder-toolbar-field";
		const text = makeEl("span"); text.textContent = name; label.append(text); container.append(label); return label;
	};
	for (const [property, name, value, unit, maximum] of [["width", t("footnoteSeparatorLength"), current.width / current.textWidth * 100, "%", 100], ["border-top-width", t("footnoteSeparatorThickness"), current.thickness, "pt", 12]] as const) {
		const input = makeEl("input"); input.value = String(Number(value.toFixed(4))); input.placeholder = property === "width" ? "40" : "0.4"; input.setAttribute("aria-label", name);
		bindLengthInput(input, unit, 0, maximum, value => { if (value === undefined) delete values[property]; else values[property] = value + unit; changed(); }, () => [property === "width" ? current.textWidth : 11, 11]);
		field(name).append(input);
	}
	const color = makeEl("input"); color.type = "color"; color.value = "#" + current.color; color.className = "bookbinder-color-swatch"; color.setAttribute("aria-label", t("colour"));
	color.addEventListener("input", () => { values.color = color.value; changed(); }); field(t("colour")).append(color);
	for (const [property, label, options, selected] of [["text-align", t("alignment"), { left: t("left"), center: t("centred"), right: t("right") }, current.alignment], ["display", t("display"), { block: t("visible"), none: t("hidden") }, values.display === "none" ? "none" : "block"]] as const) {
		const select = makeEl("select"); select.className = "dropdown"; select.setAttribute("aria-label", label);
		for (const [value, name] of Object.entries(options)) { const option = makeEl("option"); option.value = value; option.textContent = name; select.append(option); }
		select.value = selected; select.addEventListener("change", () => { values[property] = select.value; changed(); }); field(label).append(select);
	}
	const reset = makeEl("button"); reset.textContent = t("resetThisStyle"); reset.addEventListener("click", () => { delete project.styles![footnoteSeparatorStyle.selector]; changed(); container.replaceChildren(); mountFootnoteSeparator(container, project, changed, makeEl); }); container.append(reset);
}
