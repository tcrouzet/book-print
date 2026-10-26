import { t } from "./i18n.ts";

export function lengthValue(value: string | number, unit: string, em = 12, rem = em): number {
	const match = String(value).trim().match(/^([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+))\s*(mm|cm|in|pt|px|pc|em|rem|%)?$/i);
	if (!match) return NaN;
	const factors: Record<string, number> = { mm: 72 / 25.4, cm: 720 / 25.4, in: 72, pt: 1, px: .75, pc: 12, em, rem, "%": em / 100, "": em };
	const number = Number(match[1].replace(",", ".")), source = match[2]?.toLowerCase() ?? unit;
	return source === unit ? number : number * (factors[source] / factors[unit]);
}

export function bindLengthInput(input: HTMLInputElement, unit: string, minimum: number, maximum: number,
	changed: (value: number | undefined) => void, basis: () => readonly [number, number] = () => [12, 12], scale = 1): void {
	input.type = "text"; input.inputMode = "decimal"; input.maxLength = 64; input.classList.add("bookbinder-length-input");
	const validate = () => {
		let value = input.value.trim() ? lengthValue(input.value, unit, ...basis()) : undefined;
		if (value !== undefined && !/[a-z%]/i.test(input.value)) value /= scale;
		input.setCustomValidity(value !== undefined && (!Number.isFinite(value) || value * scale < minimum || value * scale > maximum)
			? t("invalidMeasurement", { min: minimum, max: maximum, unit: scale === 1 ? unit || "×" : "" }) : "");
		return value;
	};
	input.addEventListener("input", () => {
		const value = validate();
		if (input.checkValidity()) changed(value === undefined ? undefined : Number(value.toFixed(6)));
	});
	input.addEventListener("blur", () => {
		const value = validate();
		if (value !== undefined && input.checkValidity()) input.value = String(Number((value * scale).toFixed(6)));
	});
	validate();
}
