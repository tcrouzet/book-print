import { getLocale, t } from "./i18n.ts";
import { applyDefaultFont, defaultPdfFont, fontBase, fontChoices, fontFace, fontFamiliesInStyles, fontFamily, fontFilename, projectCss, resolveFontFamilies, type FontFaceInfo, type Presentation } from "./presentation";
import { contextRules, folioStyle, sortedBookStyles, type BookStyle } from "./book-styles";
import { mountProjectTabs } from "./project-tabs";
import { folioPage, millimetres, mountFolio, pdfMarginField } from "./page-layout.ts";
import { fontLabel, type FontType } from "./font-catalog.ts";
import { pdfStyleValues } from "./pdf-presentation.ts";
import { bindLengthInput } from "./length-input.ts";

interface StyleEditorOptions {
	sanitizeHTMLToDom: (html: string) => DocumentFragment;
	createEl?: typeof createEl;
	format?: "epub" | "pdf" | "docx";
	setIcon?: (element: HTMLElement, name: string) => void;
	rules?: boolean;
	fontLibrary?: () => readonly string[];
	fontType?: (reference: string) => FontType | undefined;
	fontFace?: (reference: string) => FontFaceInfo | undefined;
	selectFont?: (reference: string, apply: () => void) => Promise<void>;
}

export class StyleEditor {
	private frame: HTMLIFrameElement;
	private makeEl: typeof createEl;
	private toolbar: HTMLElement;
	private selected = "p";
	private section = 0;
	private separatorCharacters: string;
	private previewLabel: HTMLElement;
	private rules?: HTMLStyleElement;
	private base?: HTMLStyleElement;
	private fonts = new Map<string, Uint8Array>();
	private faces = new Map<string, FontFaceInfo>();
	private fontInfo = (reference: string) => this.options.fontFace?.(reference) ?? this.faces.get(reference);
	private loadingFont = false;
	private disposed = false;
	private finishReady?: () => void;
	private pageContainer?: HTMLElement;
	readonly ready: Promise<void>;

	constructor(container: HTMLElement, readonly presentation: Presentation, private css: string, private onChange: () => void, private requestClose: (() => void) | undefined, private options: StyleEditorOptions) {
		this.makeEl = options.createEl ?? createEl;
		this.separatorCharacters = presentation.separator ?? "⁂";
		presentation.page ??= {};
		presentation.styles ??= {};
		presentation.rules ??= {};
		presentation.disabledRules ??= [];
		if (!this.relativeUnits) applyDefaultFont(presentation, defaultPdfFont);
		resolveFontFamilies(presentation, this.availableFonts(), this.fontInfo);
		if (options.rules) this.selected = contextRules[0].selector;
		this.toolbar = this.makeEl("div");
		this.toolbar.className = "bookbinder-toolbar";
		this.toolbar.setAttribute("role", "group");
		this.toolbar.setAttribute("aria-label", t("bookStyleFormatting"));
		container.append(this.toolbar);
		const description = this.makeEl("p");
		description.className = "bookbinder-style-help";
		description.textContent = t(!this.relativeUnits ? "pdfTemplateValues" : "autoUsesTheTemplateClearAValueToRestoreItsSettings");
		container.append(description);
		const previewHeading = this.makeEl("div"); previewHeading.className = "bookbinder-preview-heading";
		const previewTitle = this.makeEl("span"); previewTitle.textContent = t("preview"); previewHeading.append(previewTitle);
		this.previewLabel = this.makeEl("span"); previewHeading.append(this.previewLabel); container.append(previewHeading);
		this.frame = this.makeEl("iframe");
		this.frame.className = "bookbinder-preview";
		this.frame.title = t("bookPresentationPreview");
		this.frame.setAttribute("sandbox", "allow-same-origin");
		this.ready = new Promise(resolve => {
			this.finishReady = resolve;
			this.frame.addEventListener("load", () => {
				if (this.disposed) { resolve(); return; }
				const preview = this.frame.contentDocument!;
				preview.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); this.requestClose?.(); } });
				const base = this.makeEl("style");
				this.base = base;
				this.updateBase();
				preview.head.append(base);
				this.rules = this.makeEl("style");
				preview.head.append(this.rules);
				for (const [tag, text] of [
					["h1", t("aNewStory")], ["h2", t("atTheBeginning")],
					["p", t("previewOpeningParagraph")],
					["p", t("previewSecondParagraph")],
					["h3", t("aSpringMorning")], ["p", t("previewThirdParagraph")],
					["h4", t("epigraph")], ["h5", t("aDistantVoice")], ["h6", t("theLastWord")],
				] as const) {
					const element = this.makeEl(tag);
					element.textContent = text;
					if (!this.options.rules) {
					element.dataset.bookStyle = tag;
					element.tabIndex = 0;
					element.setAttribute("role", "button");
					element.setAttribute("aria-label", tag === "p" ? t("editBodyTextStyle") : t("editHeadingLevelStyle", { level: tag.slice(1) }));
					const select = () => { this.selected = tag; this.update(); this.renderToolbar(); };
					element.addEventListener("click", select);
					element.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); } });
					}
					if (tag === "p" && /^H[1-6]$/.test(preview.body.lastElementChild?.tagName ?? "")) {
						const paragraph = this.makeEl("div"); paragraph.className = "bookbinder-after-heading-body";
						preview.body.append(paragraph, element);
					} else preview.body.append(element);
				}
				for (const style of this.catalog.filter(style => style.sample)) {
					const wrapper = this.options.sanitizeHTMLToDom(style.sample!);
					let element = wrapper.querySelector<HTMLElement>(style.target ?? style.selector)!;
					if (style.marker) {
						const parent = style.scope === "book" ? contextRules.find(rule => rule.paragraph === style.paragraph && !rule.pseudo && !rule.scope) : undefined;
						if (style.wrapper === "before") {
							let holder = element.previousElementSibling;
							if (!holder?.classList.contains("bookbinder-after-heading-" + style.kind)) { holder = this.makeEl("div"); element.before(holder); }
							holder.classList.add(style.marker);
						} else if (style.wrapper) {
							const holder = this.makeEl(style.wrapper === "span" ? "span" : "div"); holder.className = style.marker;
							if (parent?.marker) holder.classList.add(parent.marker);
							if (style.wrapper === "contents") { holder.append(...Array.from(element.childNodes)); element.append(holder); element = holder; }
							else { element.before(holder); holder.append(element); }
						} else { element.classList.add(style.marker); if (parent?.marker) element.classList.add(parent.marker); }
					}
					element.dataset.bookStyle = style.selector;
					element.tabIndex = 0; element.setAttribute("role", "button"); element.setAttribute("aria-label", t("editStyleStyle", { style: style.label }));
					const select = (event: Event) => { event.preventDefault(); this.selected = style.selector; this.update(); this.renderToolbar(); };
					element.addEventListener("click", select);
					element.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") select(event); });
					preview.body.append(...Array.from(wrapper.childNodes));
				}
				for (const element of preview.querySelectorAll("p,h1,h2,h3,h4,h5,h6,li,th,td")) {
					if (element.querySelector("p,ul,ol,table")) continue;
					const span = this.makeEl("span"); span.className = "bookbinder-character";
					span.append(...Array.from(element.childNodes)); element.append(span);
				}
				this.update();
				this.renderToolbar();
				this.reveal();
				resolve();
			}, { once: true });
		});
		this.frame.srcdoc = `<!doctype html><html lang="${getLocale()}"><head><meta charset="utf-8"></head><body></body></html>`;
		container.append(this.frame);
	}

	async addFont(filename: string, data: Uint8Array, info?: FontFaceInfo): Promise<void> {
		await this.ready;
		if (this.disposed) return;
		if (info) this.faces.set(filename, info);
		const previous = this.fonts.get(filename);
		if (previous?.length === data.length && previous.every((value, index) => value === data[index])) return;
		const descriptor = fontFace(filename, this.fontInfo);
		const family = fontFamily(fontBase(filename, this.availableFonts(), this.fontInfo));
		const face = new FontFace(family, new Uint8Array(data).buffer, { weight: String(descriptor.weight), style: descriptor.style });
		try { await face.load(); }
		catch { throw new Error(t("theFontFontCouldNotBeLoadedChooseAValidFontFile", { font: fontFilename(filename) })); }
		if (this.disposed) return;
		for (const existing of this.frame.contentDocument!.fonts) if (existing.family === family && existing.weight === face.weight && existing.style === face.style) this.frame.contentDocument!.fonts.delete(existing);
		this.frame.contentDocument!.fonts.add(face);
		this.fonts.set(filename, data);
		this.updateBase();
		this.renderToolbar();
	}

	setBaseCss(css: string): void {
		this.css = css;
		if (!this.base) return;
		this.updateBase();
		this.update(); this.renderToolbar();
	}

	refreshFonts(): void { resolveFontFamilies(this.presentation, this.availableFonts(), this.fontInfo); this.updateBase(); this.refresh(); }

	private availableFonts(): string[] {
		return [...new Set([...(this.options.fontLibrary?.() ?? []), ...this.presentation.fonts, ...this.fonts.keys()])]
			.filter(filename => this.relativeUnits || /\.(otf|ttf)$/i.test(filename));
	}

	private changed(): void {
		if (!this.relativeUnits) applyDefaultFont(this.presentation, defaultPdfFont);
		resolveFontFamilies(this.presentation, this.availableFonts(), this.fontInfo);
		const input = this.toolbar.querySelector<HTMLSelectElement>(".bookbinder-character-main select");
		if (input) this.sortFontChoices(input);
		this.onChange();
	}

	private sortFontChoices(input: HTMLSelectElement): void {
		const used = new Set([...fontFamiliesInStyles(this.presentation), ...this.presentation.fonts.map(fontFamily)]);
		const automatic = Array.from(input.options).filter(option => ["", "body"].includes(option.value));
		const options = Array.from(input.options).filter(option => !["", "body"].includes(option.value));
		const compare = (left: HTMLOptionElement, right: HTMLOptionElement) => left.text.localeCompare(right.text, getLocale());
		const active = options.filter(option => used.has(option.value)).sort(compare);
		const inactive = options.filter(option => !used.has(option.value)).sort(compare);
		input.replaceChildren(...automatic, ...active, ...(active.length && inactive.length ? [this.makeEl("hr")] : []), ...inactive);
		input.value = String(this.values()["font-family"] ?? (!this.relativeUnits ? pdfStyleValues(this.presentation, this.selected, this.options.rules)["font-family"] : ""));
	}

	async mountPage(container: HTMLElement): Promise<void> {
		await this.ready;
		if (this.disposed) return;
		this.pageContainer = container;
		this.renderPage();
	}

	refresh(): void {
		if (!this.rules || this.disposed) return;
		this.update(); this.renderToolbar(); this.renderPage(); this.reveal();
	}

	revealField(element: HTMLElement): void {
		if (!this.toolbar.contains(element)) return;
		const panel = element.closest<HTMLElement>(".bookbinder-inspector-panel");
		if (panel?.hidden) this.toolbar.querySelector<HTMLButtonElement>('[aria-controls="' + panel.id + '"]')?.click();
	}

	private renderPage(): void {
		if (!this.pageContainer) return;
		const container = this.pageContainer;
		container.replaceChildren();
		const computed = this.frame.contentWindow!.getComputedStyle(this.frame.contentDocument!.body);
		const unit = this.relativeUnits ? "em" : "mm";
		const basis = this.relativeUnits ? parseFloat(this.frame.contentWindow!.getComputedStyle(this.frame.contentDocument!.documentElement).fontSize) : 96 / 25.4;
		const pdf = !this.relativeUnits, double = pdf && this.presentation.page!["page-mode"] === "double";
		const fields = [["top", t("topPageMargin")], ["bottom", t("bottomPageMargin")],
			...(double ? [["left", t("innerPageMargin")], ["right", t("outerPageMargin")]] : [["right", t("rightPageMargin")], ["left", t("leftPageMargin")]]),
			...(pdf ? [["binding", t("bindingMargin")]] : [])];
		for (const [side, titleText] of fields) {
			const label = t("labelUnit", { label: titleText, unit });
			const name = side === "binding" ? "binding-offset" : pdf ? pdfMarginField(this.presentation.page!, side) : "margin-" + side;
			const wrapper = this.makeEl("label"); wrapper.className = "bookbinder-page-field";
			const title = this.makeEl("span"); title.textContent = label; wrapper.append(title);
			const input = this.makeEl("input"); input.type = "number"; input.step = "any"; input.min = "0"; input.max = "300";
			input.setAttribute("aria-label", label);
			const raw = this.presentation.page![name] ?? (double && side !== "binding" ? this.presentation.page!["margin-" + side] : undefined);
			const defaultValue = side === "binding" ? "0mm" : "20mm";
			input.placeholder = pdf ? String(millimetres(raw ?? defaultValue)) : t("auto");
			input.value = pdf ? String(millimetres(raw ?? defaultValue)) : raw === undefined ? "" : !this.relativeUnits ? String(millimetres(raw)) : this.relativeUnits && /^-?[\d.]+em$/.test(String(raw)) ? String(parseFloat(String(raw))) : String(Number((parseFloat(computed.getPropertyValue("padding-" + side)) / basis).toFixed(4)));
			bindLengthInput(input, unit, 0, 300, value => {
				if (value === undefined) delete this.presentation.page![name];
				else this.presentation.page![name] = value + unit;
				this.changed(); this.update();
			}, () => {
				if (pdf) return [parseFloat(String(pdfStyleValues(this.presentation, "p")["font-size"])), 11];
				const root = parseFloat(this.frame.contentWindow!.getComputedStyle(this.frame.contentDocument!.documentElement).fontSize) * .75;
				return [this.relativeUnits ? root : parseFloat(computed.fontSize) * .75, root];
			});
			if (pdf) input.addEventListener("blur", () => {
				if (!input.value) input.value = String(millimetres(this.presentation.page![name] ?? (double && side !== "binding" ? this.presentation.page!["margin-" + side] : undefined) ?? defaultValue));
			});
			wrapper.append(input); container.append(wrapper);
		}
		if (pdf) {
			const folio = this.makeEl("div"); folio.className = "bookbinder-folio-settings"; container.append(folio);
			mountFolio(folio, this.presentation.page!, () => { this.changed(); this.update(); this.renderToolbar(); }, this.makeEl);
		}
	}

	dispose(): void {
		this.disposed = true;
		this.finishReady?.();
		this.finishReady = undefined;
		this.fonts.clear();
		this.frame.remove();
		this.toolbar.remove();
	}

	private get relativeUnits(): boolean { return !this.options.format || this.options.format === "epub"; }
	private get catalog(): BookStyle[] {
		if (this.options.rules) return contextRules;
		return sortedBookStyles(this.options.format);
	}

	private values(selector = this.selected): Record<string, string | number> {
		if (selector === "p") return this.presentation.style;
		if (/^h[1-6]$/.test(selector)) return this.presentation.headings[selector] ??= {};
		if (this.options.rules) return this.presentation.rules![selector] ??= {};
		return this.presentation.styles![selector] ??= {};
	}

	private sample(selector = this.selected): HTMLElement {
		return this.frame.contentDocument!.querySelector<HTMLElement>('[data-book-style="' + selector + '"]')!;
	}

	private emValue(property: string, selector = this.selected, sample = this.sample(selector)): number {
		const raw = this.values(selector)[property];
		if (typeof raw === "string" && /^-?[\d.]+em$/.test(raw)) return parseFloat(raw);
		const window = this.frame.contentWindow!;
		const pseudo = this.catalog.find(style => style.selector === selector)?.pseudo;
		const computed = window.getComputedStyle(sample, pseudo);
		const reference = property === "font-size" ? window.getComputedStyle(selector === "p" ? this.frame.contentDocument!.documentElement : pseudo ? sample : sample.parentElement!) : computed;
		return (parseFloat(computed.getPropertyValue(property)) || 0) / (parseFloat(reference.fontSize) || 16);
	}

	normalizeUnits(): void {
		if (!this.relativeUnits || !this.rules) return;
		for (const style of this.catalog) {
			const values = this.values(style.selector);
			for (const [name, value] of Object.entries(values)) {
				if (name === "margin-top" && values["page-position"] === "one-third") continue;
				if (["font-size", "line-height", "text-indent", "margin-top", "margin-bottom", "margin-left", "margin-right", "letter-spacing"].includes(name)
					&& /^-?[\d.]+(?:pt|px|mm|cm|in|pc|rem)$/.test(String(value))) values[name] = Number(this.emValue(name, style.selector).toFixed(6)) + "em";
				if (name === "line-height" && /^\d+(?:\.\d+)?$/.test(String(value))) values[name] = value + "em";
			}
		}
		const body = this.frame.contentWindow!.getComputedStyle(this.frame.contentDocument!.body);
		const rootSize = parseFloat(this.frame.contentWindow!.getComputedStyle(this.frame.contentDocument!.documentElement).fontSize);
		for (const [name, value] of Object.entries(this.presentation.page!)) {
			if (/^-?[\d.]+(?:pt|px|mm|cm|in|pc|rem)$/.test(String(value))) this.presentation.page![name] = Number((parseFloat(body.getPropertyValue(name.replace("margin-", "padding-"))) / rootSize).toFixed(6)) + "em";
		}
		this.update();
	}

	private updateBase(): void {
		if (!this.base) return;
		// shortcut: preview uses the first font URL per face; extend for CSS with multiple fallback sources.
		this.base.textContent = this.css.replace(/@font-face\s*\{[^}]*\}/gi, face => {
			const url = face.match(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/i);
			const source = url?.[1] ?? url?.[2] ?? url?.[3]?.trim();
			if (!source) return "";
			if (source.startsWith("data:")) return face;
			let name: string;
			try { name = decodeURIComponent(source.split(/[/\\]/).pop()!); } catch { return ""; }
			const entry = Array.from(this.fonts).find(([filename]) => fontFilename(filename) === name);
			if (!entry) return "";
			let binary = ""; for (const byte of entry[1]) binary += String.fromCharCode(byte);
			const format = name.split(".").pop()!.toLowerCase();
			return face.replace(url![0], `url("data:font/${format};base64,${btoa(binary)}")`);
		});
	}

	private reveal(): void {
		const sample = this.frame.contentDocument?.querySelector<HTMLElement>(`[data-book-style="${this.selected}"]`);
		if (sample) this.frame.contentWindow?.scrollTo({ top: Math.max(0, sample.offsetTop - this.frame.clientHeight / 3) });
	}

	private set(property: string, value: string | number | undefined): void {
		if (this.selected === folioStyle.selector && property === "text-align") {
			this.presentation.page!["folio-position"] = value ?? "center";
			this.renderPage();
		}
		if (value === undefined) delete this.values()[property];
		else this.values()[property] = value;
		this.changed();
		this.update();
	}

	private update(): void {
		if (!this.rules) return;
		const selected = this.catalog.find(style => style.selector === this.selected);
		this.previewLabel.textContent = this.options.rules && this.presentation.disabledRules!.includes(selected!.kind!) ? t("noRule") : selected?.label ?? this.selected;
		const accent = this.toolbar.ownerDocument.defaultView!.getComputedStyle(this.toolbar).getPropertyValue("--text-accent") || "Highlight";
		const page = this.presentation.page ?? {};
		// @page inherits its font from the root; preview padding must use the same reference.
		const padding = ["top", "right", "bottom", "left"].map(side => {
			if (!this.relativeUnits) {
				const margin = millimetres(page[pdfMarginField(page, side)] ?? page["margin-" + side] ?? "20mm");
				return margin + (side === "left" ? millimetres(page["binding-offset"] ?? "0mm") : 0) + "mm";
			}
			return String(page["margin-" + side] ?? "1.2em").replace(/^(-?[\d.]+)em$/, "$1rem");
		}).join(" ");
		this.rules.textContent = `html{color:black;background:white}body{margin:0;padding:${padding}}
			.bookbinder-separator-line{border-top:1px solid}
			[data-book-style]{cursor:pointer}[data-book-style]:focus-visible{outline:2px solid ${accent};outline-offset:4px}
			.bookbinder-selected{outline:2px solid ${accent};outline-offset:4px}
			.bookbinder-preview-visible{display:block!important}
			${projectCss(this.presentation, this.fontInfo, this.options.format).replace(/@font-face\s*\{[^}]*\}/g, "")}
			p:not(.tab)+p:not(.tab),p.tab+p.tab{margin-top:0!important}
			${!this.relativeUnits ? `body .bookbinder-folio{text-align:${folioPage(page).alignment === "none" ? "center" : folioPage(page).alignment}}` : ""}`;
		const preview = this.frame.contentDocument!;
		const separator = preview.querySelector<HTMLElement>('[data-book-style="hr"]');
		if (separator) {
			separator.textContent = this.presentation.separator ?? "";
			separator.classList.toggle("bookbinder-separator-line", this.presentation.separator === undefined);
		}
		for (const rule of contextRules.filter(rule => !rule.pseudo)) {
			const active = rule.marker ?? "bookbinder-after-heading-" + rule.kind;
			const inactive = (rule.scope === "book" ? "bookbinder-disabled-book-" : "bookbinder-disabled-heading-") + rule.kind;
			const disabled = this.presentation.disabledRules!.includes(rule.kind!);
			for (const marker of preview.querySelectorAll("." + active + ",." + inactive)) {
				marker.classList.toggle(active, !disabled); marker.classList.toggle(inactive, disabled);
			}
		}
		// Hidden export styles stay visible in the editor so they can be selected.
		for (const element of [preview.body, ...preview.querySelectorAll<HTMLElement>("[data-book-style]")]) {
			element.classList.remove("bookbinder-preview-visible");
			if (this.frame.contentWindow!.getComputedStyle(element).display === "none") element.classList.add("bookbinder-preview-visible");
			if (element === preview.body) continue;
			element.classList.toggle("bookbinder-selected", element.dataset.bookStyle === this.selected);
			element.setAttribute("aria-pressed", String(element.dataset.bookStyle === this.selected));
		}
	}

	private renderToolbar(): void {
		const pdf = !this.relativeUnits;
		const effective = pdf ? pdfStyleValues(this.presentation, this.selected, this.options.rules) : undefined;
		const document = this.toolbar.ownerDocument;
		const focused = this.toolbar.contains(document.activeElement) ? document.activeElement?.getAttribute("aria-label") : null;
		this.toolbar.replaceChildren();
		const header = this.makeEl("div"); header.className = "bookbinder-style-header"; this.toolbar.append(header);
		if (this.options.rules) header.classList.add("bookbinder-rule-header");
		const navigation = this.makeEl("div"); navigation.className = "bookbinder-inspector-tabs";
		navigation.setAttribute("aria-label", t("styleCategories")); this.toolbar.append(navigation);
		const panels = [t("character"), t("paragraph"), t("flow")].map(() => {
			const panel = this.makeEl("div"); panel.className = "bookbinder-inspector-panel"; this.toolbar.append(panel); return panel;
		});
		const selectSection = mountProjectTabs(navigation, panels, [t("character"), t("paragraph"), t("flow")], () => { this.section = panels.findIndex(panel => !panel.hidden); }, this.makeEl);
		selectSection(this.section);
		const row = (parent: HTMLElement, className: string) => {
			const element = this.makeEl("div"); element.className = className; parent.append(element); return element;
		};
		const type = row(panels[0], "bookbinder-character-main");
		const character = row(panels[0], "bookbinder-character-options");
		const emphasis = row(character, "bookbinder-style-emphasis"); emphasis.setAttribute("role", "group"); emphasis.setAttribute("aria-label", t("weightAndItalic"));
		const paragraph = row(panels[1], "bookbinder-paragraph-main");
		const alignField = row(paragraph, "bookbinder-toolbar-field");
		const alignLabel = this.makeEl("span"); alignLabel.textContent = t("alignment"); alignField.append(alignLabel);
		const alignment = row(alignField, "bookbinder-style-alignment"); alignment.setAttribute("role", "group"); alignment.setAttribute("aria-label", t("paragraphAlignment"));
		const margins = row(panels[1], "bookbinder-style-margins");
		panels[2].classList.add("bookbinder-style-flow");
		const sample = this.sample();
		const selectedRule = this.options.rules ? this.catalog.find(rule => rule.selector === this.selected)! : undefined;
		const parentStyle = selectedRule?.paragraph ?? this.selected;
		const canUseBodyText = this.selected !== "p";
		const blockStyle = !selectedRule?.pseudo && !["em", "strong", "del", ".smallcaps", "sub", "sup", "code", "a", "img"].includes(parentStyle);
		const heading = blockStyle && (/^h[1-6]$/.test(parentStyle) || parentStyle === "h1.title");
		const colophon = this.options.format === "pdf" && !this.options.rules && parentStyle === ".bookbinder-colophon p";
		const positionable = heading || colophon;
		const position = pdf ? effective?.["page-position"] : this.values()["page-position"];
		const positionedHeading = positionable && position === "one-third";
		const computed = this.frame.contentWindow!.getComputedStyle(sample, this.catalog.find(style => style.selector === this.selected)?.pseudo);
		const field = (parent: HTMLElement, label: string) => {
			const wrapper = this.makeEl("label"); wrapper.className = "bookbinder-toolbar-field";
			const unit = label.match(/ \((em|pt|mm)\)$/)?.[1];
			if (unit) wrapper.dataset.unit = unit;
			const names: Record<string, string> = { [t("topMargin")]: t("top"), [t("bottomMargin")]: t("bottom"), [t("leftMargin")]: t("left"), [t("rightMargin")]: t("right") };
			const title = label.replace(/ \((em|pt|mm)\)$/, "");
			const name = this.makeEl("span"); name.textContent = names[title] ?? title; wrapper.append(name);
			parent.append(wrapper); return wrapper;
		};
		const select = (parent: HTMLElement, label: string, options: Record<string, string>, current: string, change: (value: string) => void) => {
			const input = this.makeEl("select"); input.classList.add("dropdown"); input.setAttribute("aria-label", label);
			for (const [value, text] of Object.entries(options)) { const option = this.makeEl("option"); option.value = value; option.textContent = text; input.append(option); }
			if (!(current in options)) { const option = this.makeEl("option"); option.value = current; option.textContent = current; input.append(option); }
			input.value = current; input.addEventListener("change", () => change(input.value)); field(parent, label).append(input);
			return input;
		};
		const currentRule = this.catalog.find(style => style.selector === this.selected)!;
		if (this.options.rules) select(header, t("style"), Object.fromEntries(sortedBookStyles(this.options.format).filter(style => contextRules.some(rule => rule.paragraph === style.selector)).map(style => [style.selector, style.label])), currentRule.paragraph!, value => {
			this.selected = (contextRules.find(rule => rule.paragraph === value && rule.pseudo === currentRule.pseudo && rule.scope === currentRule.scope) ?? contextRules.find(rule => rule.paragraph === value))!.selector;
			this.update(); this.renderToolbar(); this.reveal();
		});
		const choices = this.options.rules ? this.catalog.filter(rule => rule.paragraph === currentRule.paragraph) : this.catalog;
		const disabled = this.options.rules && this.presentation.disabledRules!.includes(currentRule.kind!);
		select(header, this.options.rules ? t("rule") : t("style"), { ...(this.options.rules ? { "": t("noRule") } : {}), ...Object.fromEntries(choices.map(style => [style.selector, style.label])) }, disabled ? "" : this.selected, value => {
			if (this.options.rules) {
				this.presentation.disabledRules = this.presentation.disabledRules!.filter(kind => kind !== currentRule.kind);
				if (!value) this.presentation.disabledRules.push(currentRule.kind!);
				this.changed();
			}
			if (value) this.selected = value;
			this.update(); this.renderToolbar(); this.reveal();
		});
		if (disabled) {
			navigation.remove(); panels.forEach(panel => panel.remove());
			if (focused) Array.from(header.querySelectorAll<HTMLElement>("[aria-label]")).find(element => element.getAttribute("aria-label") === focused)?.focus();
			return;
		}
		if (this.selected === "hr") {
			select(header, t("separatorAppearance"), { line: t("line"), characters: t("characters") }, this.presentation.separator === undefined ? "line" : "characters", value => {
				if (value === "line") delete this.presentation.separator;
				else this.presentation.separator = this.separatorCharacters;
				this.changed(); this.update(); this.renderToolbar();
			});
			if (this.presentation.separator !== undefined) {
				const input = this.makeEl("input"); input.type = "text"; input.value = this.presentation.separator;
				input.setAttribute("aria-label", t("separatorCharacters"));
				input.addEventListener("input", () => {
					this.separatorCharacters = input.value; this.presentation.separator = input.value;
					this.changed(); this.update();
				});
				field(header, t("separatorCharacters")).append(input);
			}
		}
		const families: Record<string, string> = { ...(!pdf || canUseBodyText ? { "": t("auto") } : {}), ...(canUseBodyText ? { body: t("bodyText") } : {}), serif: t("serif"), "sans-serif": t("sansSerif"), monospace: t("monospace") };
		const available = fontChoices(this.availableFonts(), this.fontInfo)
			.sort((left, right) => fontFilename(left).localeCompare(fontFilename(right), getLocale()));
		for (const filename of available) families[fontFamily(filename)] = fontLabel(filename, this.options.fontType?.(filename), this.fontInfo(filename));
		const fontInput = select(type, t("font"), families, String(this.values()["font-family"] ?? effective?.["font-family"] ?? ""), value => {
			const values = this.values();
			const apply = () => {
				if (this.disposed) return;
				if (value) values["font-family"] = value;
				else delete values["font-family"];
				this.changed(); this.update();
			};
			const reference = available.find(filename => fontFamily(filename) === value);
			if (!reference || this.fonts.has(reference) || !this.options.selectFont) { apply(); return; }
			this.loadingFont = true; fontInput.disabled = true;
			void this.options.selectFont(reference, apply).finally(() => {
				this.loadingFont = false;
				if (!this.disposed) this.renderToolbar();
			});
		});
		fontInput.disabled = this.loadingFont;
		this.sortFontChoices(fontInput);
		if (this.relativeUnits && this.selected === "p" && !this.options.rules) {
			const warning = this.makeEl("p"); warning.className = "bookbinder-font-warning";
			warning.textContent = t("bodyFontWarning"); panels[0].append(warning);
		}
		const printValue = (values: Record<string, string | number>, property: string) => {
			const size = parseFloat(String(values["font-size"]));
			return property === "line-height" ? Number(values[property]) * size : parseFloat(String(values[property])) * (property === "letter-spacing" ? 1000 / size : 1);
		};
		const number = (parent: HTMLElement, label: string, property: string, numericValue: number, minimum: number, maximum: number, unit: string, scale = 1) => {
			const input = this.makeEl("input"); input.type = "number"; input.min = String(minimum); input.max = String(maximum); input.step = "any";
			let sizeSource: HTMLSelectElement | undefined;
			const headingOffset = !pdf && positionedHeading && property === "page-offset";
			const automatic = !headingOffset && (!pdf || property === "line-height");
			input.placeholder = automatic ? t("auto") : String(Math.round(numericValue * scale * 100) / 100); input.setAttribute("aria-label", label);
			input.dataset.property = property;
			input.disabled = property === "font-size" && this.values()[property] === "body";
			input.value = automatic && this.values()[property] === undefined ? "" : String(Math.round(numericValue * scale * 100) / 100);
			bindLengthInput(input, unit, minimum, maximum, value => {
				const normalPosition = pdf && positionable && property === "margin-top" && pdfStyleValues(this.presentation, this.selected, this.options.rules)["page-position"] === "one-third";
				if (normalPosition) {
					if (this.options.rules) this.values()["page-position"] = "normal";
					else delete this.values()["page-position"];
				}
				this.set(property, value === undefined ? undefined : unit ? value + unit : value);
				if (sizeSource) sizeSource.value = value === undefined ? "auto" : "custom";
				if (pdf) {
					const values = pdfStyleValues(this.presentation, this.selected, this.options.rules);
					if (normalPosition) {
						const position = this.toolbar.querySelector<HTMLSelectElement>('select[data-property="page-position"]');
						if (position) position.value = "";
						const pageBreak = this.toolbar.querySelector<HTMLSelectElement>('select[data-property="page-break-before"]');
						if (pageBreak) {
							pageBreak.disabled = false; pageBreak.value = String(values["page-break-before"]);
							const noBreak = pageBreak.querySelector<HTMLOptionElement>('[value="auto"]'); if (noBreak) noBreak.disabled = false;
						}
					}
					for (const other of this.toolbar.querySelectorAll<HTMLInputElement>("input[data-property]")) {
						if (other !== input) other.value = other.dataset.property === "line-height" && this.values()["line-height"] === undefined ? "" : String(Math.round(printValue(values, other.dataset.property!) * 100) / 100);
					}
				}
			}, () => {
				if (headingOffset) return [12, 12];
				if (pdf) {
					const rule = this.options.rules ? this.catalog.find(style => style.selector === this.selected) : undefined;
					const size = property !== "font-size" ? pdfStyleValues(this.presentation, this.selected, this.options.rules)["font-size"]
						: rule ? pdfStyleValues(this.presentation, rule.pseudo ? this.selected.replace("::first-letter", "") : rule.paragraph!, !!rule.pseudo)["font-size"]
						: this.selected === "p" ? 11 : pdfStyleValues(this.presentation, "p")["font-size"];
					return [parseFloat(String(size)), 11];
				}
				const window = this.frame.contentWindow!;
				const selected = this.sample();
				const pseudo = this.catalog.find(style => style.selector === this.selected)?.pseudo;
				const reference = property === "font-size" ? this.selected === "p" ? this.frame.contentDocument!.documentElement : pseudo ? selected : selected.parentElement! : selected;
				return [(parseFloat(window.getComputedStyle(reference).fontSize) || 16) * .75,
					(parseFloat(window.getComputedStyle(this.frame.contentDocument!.documentElement).fontSize) || 16) * .75];
			}, scale);
			if (pdf && !automatic) input.addEventListener("blur", () => {
				if (!input.value) {
					const values = pdfStyleValues(this.presentation, this.selected, this.options.rules);
					input.value = String(Math.round(printValue(values, property) * 100) / 100);
				}
			});
			if (headingOffset) input.addEventListener("blur", () => { if (!input.value) input.value = "50"; });
			const wrapper = field(parent, label);
			if (property === "font-size" && canUseBodyText) {
				const controls = row(wrapper, "bookbinder-size-control");
				sizeSource = this.makeEl("select"); sizeSource.classList.add("dropdown"); sizeSource.setAttribute("aria-label", t("fontSizeSource"));
				for (const [value, text] of [["auto", t("auto")], ["body", t("bodyText")], ["custom", t("custom")]]) {
					const option = this.makeEl("option"); option.value = value; option.textContent = text; sizeSource.append(option);
				}
				sizeSource.value = this.values()[property] === "body" ? "body" : this.values()[property] === undefined ? "auto" : "custom";
				sizeSource.addEventListener("change", () => {
					this.set(property, sizeSource!.value === "auto" ? undefined : sizeSource!.value === "body" ? "body" : numericValue + unit); this.renderToolbar();
				});
				controls.append(sizeSource, input);
			} else wrapper.append(input);
		};
		const points = (property: string) => (parseFloat(computed.getPropertyValue(property)) || 0) * 0.75;
		const unit = this.relativeUnits ? "em" : "pt";
		const length = (property: string) => effective ? parseFloat(String(effective[property])) : this.relativeUnits ? this.emValue(property) : points(property);
		number(type, t("fontSizeUnit", { unit }), "font-size", length("font-size"), this.relativeUnits ? 0.1 : 1, this.relativeUnits ? 20 : 200, unit);
		const button = (parent: HTMLElement, label: string, icon: string, active: boolean | "mixed" | undefined, action: () => void) => {
			const input = this.makeEl("button"); input.type = "button"; input.className = "clickable-icon";
			input.title = active === undefined ? label : t("formattingState", { label, state: t(active === "mixed" ? "inheritedFormatting" : active ? "enabledFormatting" : "disabledFormatting") });
			if (this.options.setIcon) this.options.setIcon(input, icon); else input.textContent = label;
			input.setAttribute("aria-label", label); if (active !== undefined) input.setAttribute("aria-pressed", String(active));
			if (active === "mixed") input.dataset.auto = "true";
			input.addEventListener("click", () => { action(); this.renderToolbar(); }); parent.append(input);
		};
		for (const [property, on, label, icon] of [["font-weight", "bold", t("bold"), "bold"], ["font-style", "italic", t("italic"), "italic"]]) {
			const current = effective?.[property] ?? this.values()[property];
			const active = current === on || property === "font-weight" && Number(current) >= 600;
			button(emphasis, label, icon, current === undefined ? "mixed" : active, () => this.set(property, pdf ? active ? "normal" : on : current === undefined ? on : active ? "normal" : undefined));
		}
		for (const [property, on, off, label, icon] of [
			["vertical-align", "super", "baseline", t("superscript"), "superscript"],
			["vertical-align", "sub", "baseline", t("subscript"), "subscript"],
			["text-transform", "uppercase", "none", t("capitals"), "case-upper"],
			["font-variant", "small-caps", "normal", t("smallCaps"), "case-sensitive"],
		]) {
			const active = (this.values()[property] ?? effective?.[property] ?? computed.getPropertyValue(property)) === on;
			button(emphasis, label, icon, active, () => {
				const value = active ? off : on;
				this.set(property, value);
				if (value === on && property === "text-transform") this.set("font-variant", "normal");
				if (value === on && property === "font-variant") this.set("text-transform", "none");
			});
		}
		if (!pdf) button(alignment, t("automaticAlignment"), "rotate-ccw", this.values()["text-align"] === undefined, () => this.set("text-align", undefined));
		for (const [value, label] of [["left", t("left")], ["center", t("centred")], ["right", t("right")], ["justify", t("justified")]]) {
			if (this.selected === folioStyle.selector && value === "justify") continue;
			button(alignment, t("alignAlignment", { alignment: label }), "align-" + value, (effective?.["text-align"] ?? this.values()["text-align"]) === value, () => this.set("text-align", value));
		}
		const color = this.makeEl("input"); color.type = "color"; color.setAttribute("aria-label", t("textColour"));
		color.classList.add("bookbinder-color-swatch"); color.title = t("chooseAColour");
		const rgb = computed.color.match(/\d+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
		color.value = "#" + rgb.map(value => Math.min(255, value).toString(16).padStart(2, "0")).join("");
		const colorValue = effective?.color ?? this.values().color;
		if (pdf && /^#[0-9a-f]{6}$/i.test(String(colorValue))) color.value = String(colorValue);
		const colorModes: Record<string, string> = { ...(!pdf ? { "": t("auto") } : {}), custom: t("custom"), transparent: t("invisible") };
		const colorMode = select(character, t("colour"), colorModes, colorValue === undefined ? "" : colorValue === "transparent" ? "transparent" : "custom", value => {
			this.set("color", value === "" ? undefined : value === "transparent" ? "transparent" : color.value); this.renderToolbar();
		});
		color.addEventListener("input", () => { this.set("color", color.value); colorMode.value = "custom"; });
		const palette = field(character, t("palette")); palette.classList.add("bookbinder-color-palette"); palette.append(color);
		const size = parseFloat(computed.fontSize) || 16;
		number(paragraph, this.relativeUnits ? t("lineHeightEm") : t("lineHeightPt"), "line-height", effective ? Number(effective["line-height"]) * parseFloat(String(effective["font-size"])) : (parseFloat(computed.lineHeight) || size * 1.2) / size, this.relativeUnits ? .5 : 1, this.relativeUnits ? 5 : 1000, this.relativeUnits ? "em" : "pt");
		if (pdf && blockStyle && !["hr", folioStyle.selector].includes(this.selected)) {
			const label = t("automaticHyphenation"), input = this.makeEl("input");
			input.type = "checkbox"; input.checked = effective?.hyphens !== "none";
			input.setAttribute("aria-label", label);
			input.addEventListener("change", () => this.set("hyphens", input.checked ? "auto" : "none"));
			const toggle = field(paragraph, label); toggle.classList.add("bookbinder-toolbar-toggle"); toggle.append(input);
		}
		for (const [property, label] of [["margin-top", t("topMargin")], ["margin-bottom", t("bottomMargin")], ["margin-left", t("leftMargin")], ["margin-right", t("rightMargin")], ["text-indent", t("firstLineIndent")]]) {
			if (!pdf && positionedHeading && property === "margin-top") continue;
			number(property === "text-indent" ? paragraph : margins, t("labelUnit", { label, unit }), property, length(property), this.relativeUnits ? -100 : -300, this.relativeUnits ? 100 : 300, unit);
		}
		number(character, t("tracking"), "letter-spacing", effective ? length("letter-spacing") / parseFloat(String(effective["font-size"])) : this.emValue("letter-spacing"), -1000, 10000, "em", 1000);
		select(panels[2], t("display"), { ...(!pdf ? { "": t("auto") } : {}), block: t("visible"), none: t("hidden") }, (effective?.display ?? this.values().display) === undefined ? "" : (effective?.display ?? this.values().display) === "none" ? "none" : "block", value => this.set("display", value === "block" && ["SPAN", "A"].includes(sample.tagName) ? "inline" : value || undefined));
		if (positionable) {
			const input = select(panels[2], t(colophon ? "colophonPosition" : "headingPosition"), { "": t(pdf ? "normalPosition" : "auto"), "one-third": t(pdf ? "oneThirdPage" : "pageStartSpacing") }, position === "normal" ? "" : String(position ?? ""), value => {
				this.set("page-position", value || (pdf && this.options.rules ? "normal" : undefined)); this.renderToolbar();
			});
			input.dataset.property = "page-position";
		}
		if (!pdf && positionedHeading) number(panels[2], t("headingSpaceAboveMm"), "page-offset", millimetres(this.values()["page-offset"] ?? "50mm"), 0, 300, "mm");
		if (blockStyle && this.selected !== folioStyle.selector) {
			const printHeading = pdf && (/^h[1-6]$/.test(parentStyle) || !!this.options.rules);
			const current = String(effective?.["page-break-before"] ?? this.values()["page-break-before"] ?? "");
			const options: Record<string, string> = printHeading ? { auto: t("noPageBreak"), always: t("nextPage"), left: t("evenPage"), right: t("oddPage") }
				: { ...(!pdf ? { "": t("auto") } : {}), always: t("yes"), auto: t("no") };
			const input = select(panels[2], t("pageBreakBefore"), options, positionedHeading && (!printHeading || !["always", "left", "right"].includes(current)) ? "always" : current, value => this.set("page-break-before", value || undefined));
			input.dataset.property = "page-break-before";
			input.disabled = positionedHeading && !printHeading;
			if (positionedHeading && printHeading) input.querySelector<HTMLOptionElement>('[value="auto"]')!.disabled = true;
		}
		if (this.options.format === "pdf" && (heading && /^h[1-6]$/.test(parentStyle) || colophon)) {
			const label = t(colophon ? "showFolioOnColophonPages" : "showFolioOnHeadingPage");
			const input = this.makeEl("input"); input.type = "checkbox"; input.checked = effective?.folio !== "hide";
			input.setAttribute("aria-label", label);
			input.addEventListener("change", () => this.set("folio", input.checked ? this.options.rules ? "show" : undefined : "hide"));
			const toggle = field(panels[2], label); toggle.classList.add("bookbinder-toolbar-toggle"); toggle.append(input);
		}
		button(header, t("resetThisStyle"), "rotate-ccw", undefined, () => {
			if (this.selected === "hr") delete this.presentation.separator;
			if (this.selected === "p") this.presentation.style = {};
			else if (/^h[1-6]$/.test(this.selected)) delete this.presentation.headings[this.selected];
			else if (this.options.rules) delete this.presentation.rules![this.selected];
			else delete this.presentation.styles![this.selected];
			this.changed(); this.update();
		});
		if (focused) Array.from(this.toolbar.querySelectorAll<HTMLElement>("[aria-label]")).find(element => element.getAttribute("aria-label") === focused)?.focus();
	}
}
