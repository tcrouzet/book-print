import en from "../locales/en.json" with { type: "json" };
import fr from "../locales/fr.json" with { type: "json" };

export const defaultMessages = { en, fr };
const messages = { en: { ...en }, fr: { ...fr } };
export type Locale = keyof typeof messages;
export type MessageKey = keyof typeof en;
let locale: Locale = "en";

export function resolveLocale(language: string): Locale {
	const requested = language.toLowerCase().replace(/_/g, "-");
	const candidate = Object.prototype.hasOwnProperty.call(messages, requested) ? requested : requested.split("-")[0];
	return Object.prototype.hasOwnProperty.call(messages, candidate) ? candidate as Locale : "en";
}

export function setLocale(language: string): void { locale = resolveLocale(language); }
export function getLocale(): Locale { return locale; }

export function setTranslations(language: Locale, value: unknown): void {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(t("translationCatalogInvalid"));
	const custom = value as Record<string, unknown>;
	const translated = { ...defaultMessages[language] };
	const parameters = (text: string) => Array.from(new Set(Array.from(text.matchAll(/\{(\w+)\}/g), match => match[1]))).sort();
	for (const key of Object.keys(translated) as MessageKey[]) {
		if (!Object.prototype.hasOwnProperty.call(custom, key)) continue;
		const text = custom[key];
		if (typeof text !== "string" || !text.trim()) throw new Error(t("translationTextInvalid", { key }));
		const expected = parameters(translated[key]);
		if (JSON.stringify(parameters(text)) !== JSON.stringify(expected)) {
			throw new Error(t("translationPlaceholdersInvalid", { key, placeholders: expected.map(name => "{" + name + "}").join(", ") }));
		}
		translated[key] = text;
	}
	messages[language] = translated;
}

export function t(key: MessageKey, parameters: Record<string, string | number> = {}, language: Locale = locale): string {
	const message = messages[language][key] ?? en[key];
	return message.replace(/\{(\w+)\}/g, (_match, name: string) => {
		if (!Object.prototype.hasOwnProperty.call(parameters, name)) throw new Error(t("translationParameterMissing", { name }, language));
		const value = parameters[name];
		return typeof value === "number" ? new Intl.NumberFormat(language).format(value) : value;
	});
}
