import { fontFamily, projectCss, type Presentation } from "./presentation";
import { bookStyles, contextRules, type BookStyle } from "./book-styles";
import { mountProjectTabs } from "./project-tabs";

interface StyleEditorOptions {
	format?: "epub" | "pdf" | "docx";
	setIcon?: (element: HTMLElement, name: string) => void;
	rules?: boolean;
}

export class StyleEditor {
	private frame: HTMLIFrameElement;
	private toolbar: HTMLElement;
	private selected = "p";
	private section = 0;
	private previewLabel: HTMLElement;
	private rules?: HTMLStyleElement;
	private base?: HTMLStyleElement;
	private fonts = new Map<string, Uint8Array>();
	private disposed = false;
	private finishReady?: () => void;
	private pageContainer?: HTMLElement;
	readonly ready: Promise<void>;

	constructor(container: HTMLElement, readonly presentation: Presentation, private css: string, private changed: () => void, private requestClose?: () => void, private options: StyleEditorOptions = {}) {
		presentation.page ??= {};
		presentation.styles ??= {};
		presentation.rules ??= {};
		if (options.rules) this.selected = contextRules[0].selector;
		const legacyMargin = presentation.style["page-margin"];
		if (legacyMargin !== undefined) {
			for (const side of ["top", "bottom", "left", "right"]) presentation.page["margin-" + side] ??= legacyMargin;
			delete presentation.style["page-margin"];
		}
		const document = container.ownerDocument;
		this.toolbar = document.createElement("div");
		this.toolbar.className = "bookbinder-toolbar";
		this.toolbar.setAttribute("role", "group");
		this.toolbar.setAttribute("aria-label", "Mise en forme des styles du livre");
		container.append(this.toolbar);
		const description = document.createElement("p");
		description.className = "bookbinder-style-help";
		description.textContent = "Auto reprend le modèle. Effacez une valeur pour revenir en Auto.";
		container.append(description);
		const previewHeading = document.createElement("div"); previewHeading.className = "bookbinder-preview-heading";
		const previewTitle = document.createElement("span"); previewTitle.textContent = "Aperçu"; previewHeading.append(previewTitle);
		this.previewLabel = document.createElement("span"); previewHeading.append(this.previewLabel); container.append(previewHeading);
		this.frame = document.createElement("iframe");
		this.frame.className = "bookbinder-preview";
		this.frame.title = "Aperçu de la présentation du livre";
		this.frame.setAttribute("sandbox", "allow-same-origin");
		this.ready = new Promise(resolve => {
			this.finishReady = resolve;
			this.frame.addEventListener("load", () => {
				if (this.disposed) { resolve(); return; }
				const preview = this.frame.contentDocument!;
				preview.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); this.requestClose?.(); } });
				const base = preview.createElement("style");
				this.base = base;
				this.updateBase();
				preview.head.append(base);
				this.rules = preview.createElement("style");
				preview.head.append(this.rules);
				for (const [tag, text] of [
					["h1", "Une nouvelle histoire"], ["h2", "Au commencement"],
					["p", "Au petit matin, la lumière glissait entre les rideaux. Sur la table, un livre attendait encore son lecteur."],
					["p", "Chaque page possède son rythme. Les titres, les blancs et la typographie accompagnent le texte et donnent envie de poursuivre la lecture."],
					["h3", "Un matin de printemps"], ["p", "Elle ouvrit la fenêtre. La ville s’éveillait lentement, avec ce calme particulier qui précède les grandes journées."],
					["h4", "Exergue"], ["h5", "Une voix lointaine"], ["h6", "Le dernier mot"],
				]) {
					const element = preview.createElement(tag);
					element.textContent = text;
					if (!this.options.rules) {
					element.dataset.bookStyle = tag;
					element.tabIndex = 0;
					element.setAttribute("role", "button");
					element.setAttribute("aria-label", tag === "p" ? "Modifier le style Texte courant" : `Modifier le style Titre ${tag.slice(1)}`);
					const select = () => { this.selected = tag; this.update(); this.renderToolbar(); };
					element.addEventListener("click", select);
					element.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); } });
					}
					preview.body.append(element);
				}
				if (this.relativeUnits) for (const style of this.catalog.filter(style => style.sample)) {
					const wrapper = preview.createElement("div"); wrapper.innerHTML = style.sample!;
					const element = wrapper.querySelector<HTMLElement>(style.target ?? style.selector)!;
					element.dataset.bookStyle = style.selector;
					element.tabIndex = 0; element.setAttribute("role", "button"); element.setAttribute("aria-label", "Modifier le style " + style.label);
					const select = (event: Event) => { event.preventDefault(); this.selected = style.selector; this.update(); this.renderToolbar(); };
					element.addEventListener("click", select);
					element.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") select(event); });
					preview.body.append(...Array.from(wrapper.childNodes));
				}
				this.update();
				this.renderToolbar();
				this.reveal();
				resolve();
			}, { once: true });
		});
		this.frame.srcdoc = '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body></body></html>';
		container.append(this.frame);
	}

	async addFont(filename: string, data: Uint8Array): Promise<void> {
		await this.ready;
		if (this.disposed) return;
		const previous = this.fonts.get(filename);
		if (previous?.length === data.length && previous.every((value, index) => value === data[index])) return;
		const face = new FontFace(fontFamily(filename), new Uint8Array(data).buffer);
		try { await face.load(); }
		catch { throw new Error(`La police ${filename.split(/[/\\]/).pop()} ne peut pas être chargée. Choisissez un fichier de police valide.`); }
		if (this.disposed) return;
		for (const existing of this.frame.contentDocument!.fonts) if (existing.family === fontFamily(filename)) this.frame.contentDocument!.fonts.delete(existing);
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
		for (const [side, titleText] of [["top", "Marge haute de page"], ["bottom", "Marge basse de page"], ["left", "Marge gauche de page"], ["right", "Marge droite de page"]]) {
			const label = titleText + " (" + unit + ")";
			const name = "margin-" + side;
			const wrapper = container.ownerDocument.createElement("label"); wrapper.className = "bookbinder-page-field";
			const title = container.ownerDocument.createElement("span"); title.textContent = label; wrapper.append(title);
			const input = container.ownerDocument.createElement("input"); input.type = "number"; input.step = "any"; input.min = "0"; input.max = "300"; input.placeholder = "Auto";
			input.setAttribute("aria-label", label);
			const raw = this.presentation.page![name];
			input.value = raw === undefined ? "" : this.relativeUnits && /^-?[\d.]+em$/.test(String(raw)) ? String(parseFloat(String(raw))) : String(Number((parseFloat(computed.getPropertyValue("padding-" + side)) / basis).toFixed(4)));
			input.addEventListener("input", () => {
				if (!input.checkValidity()) return;
				if (input.value === "") delete this.presentation.page![name];
				else this.presentation.page![name] = input.valueAsNumber + unit;
				this.changed(); this.update();
			});
			wrapper.append(input); container.append(wrapper);
		}
	}

	removeFont(filename: string): void {
		const family = fontFamily(filename);
		this.fonts.delete(filename);
		this.presentation.fonts = this.presentation.fonts.filter(value => value !== filename);
		for (const style of [this.presentation.style, ...Object.values(this.presentation.headings), ...Object.values(this.presentation.styles ?? {}), ...Object.values(this.presentation.rules ?? {})]) {
			if (style["font-family"] === family) delete style["font-family"];
		}
		for (const face of this.frame.contentDocument?.fonts ?? []) if (face.family === family) this.frame.contentDocument!.fonts.delete(face);
		this.updateBase();
		this.changed(); this.update(); this.renderToolbar();
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
	private get catalog(): BookStyle[] { return this.options.rules ? contextRules : this.relativeUnits ? bookStyles : bookStyles.filter(style => !style.sample); }

	private values(selector = this.selected): Record<string, string | number> {
		if (selector === "p") return this.presentation.style;
		if (/^h[1-6]$/.test(selector)) return this.presentation.headings[selector] ??= {};
		if (this.options.rules) return this.presentation.rules![selector] ??= {};
		return this.presentation.styles![selector] ??= {};
	}

	private sample(selector = this.selected): HTMLElement {
		return this.frame.contentDocument!.querySelector<HTMLElement>('[data-book-style="' + selector + '"]')!;
	}

	private emValue(property: string, selector = this.selected): number {
		const raw = this.values(selector)[property];
		if (typeof raw === "string" && /^-?[\d.]+em$/.test(raw)) return parseFloat(raw);
		const sample = this.sample(selector);
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
			const entry = Array.from(this.fonts).find(([filename]) => filename.split(/[/\\]/).pop() === name);
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
		if (value === undefined) delete this.values()[property];
		else this.values()[property] = value;
		this.changed();
		this.update();
	}

	private update(): void {
		if (!this.rules) return;
		this.previewLabel.textContent = this.catalog.find(style => style.selector === this.selected)?.label ?? this.selected;
		const accent = getComputedStyle(this.toolbar).getPropertyValue("--text-accent") || "Highlight";
		const page = this.presentation.page ?? {};
		// @page inherits its font from the root; preview padding must use the same reference.
		const padding = ["top", "right", "bottom", "left"].map(side => String(page["margin-" + side] ?? "1.2em").replace(/^(-?[\d.]+)em$/, "$1rem")).join(" ");
		this.rules.textContent = `html{color:#222;background:white}body{margin:0;padding:${padding}}
			[data-book-style]{cursor:pointer}[data-book-style]:focus-visible{outline:2px solid ${accent};outline-offset:4px}
			.bookbinder-selected{outline:2px solid ${accent};outline-offset:4px}
			${projectCss(this.presentation).replace(/@font-face\s*\{[^}]*\}/g, "")}`;
		const preview = this.frame.contentDocument!;
		// Hidden export styles stay visible in the editor so they can be selected.
		for (const element of [preview.body, ...preview.querySelectorAll<HTMLElement>("[data-book-style]")]) {
			element.style.removeProperty("display");
			if (this.frame.contentWindow!.getComputedStyle(element).display === "none") element.style.display = "block";
			if (element === preview.body) continue;
			element.classList.toggle("bookbinder-selected", element.dataset.bookStyle === this.selected);
			element.setAttribute("aria-pressed", String(element.dataset.bookStyle === this.selected));
		}
	}

	private renderToolbar(): void {
		const document = this.toolbar.ownerDocument;
		const focused = this.toolbar.contains(document.activeElement) ? document.activeElement?.getAttribute("aria-label") : null;
		this.toolbar.replaceChildren();
		const header = document.createElement("div"); header.className = "bookbinder-style-header"; this.toolbar.append(header);
		const navigation = document.createElement("div"); navigation.className = "bookbinder-inspector-tabs";
		navigation.setAttribute("aria-label", "Catégories du style"); this.toolbar.append(navigation);
		const panels = ["Caractère", "Paragraphe", "Enchaînement"].map(() => {
			const panel = document.createElement("div"); panel.className = "bookbinder-inspector-panel"; this.toolbar.append(panel); return panel;
		});
		const selectSection = mountProjectTabs(navigation, panels, ["Caractère", "Paragraphe", "Enchaînement"], () => { this.section = panels.findIndex(panel => !panel.hidden); });
		selectSection(this.section);
		const row = (parent: HTMLElement, className: string) => {
			const element = document.createElement("div"); element.className = className; parent.append(element); return element;
		};
		const type = row(panels[0], "bookbinder-character-main");
		const character = row(panels[0], "bookbinder-character-options");
		const emphasis = row(character, "bookbinder-style-emphasis"); emphasis.setAttribute("role", "group"); emphasis.setAttribute("aria-label", "Graisse et italique");
		const paragraph = row(panels[1], "bookbinder-paragraph-main");
		const alignField = row(paragraph, "bookbinder-toolbar-field");
		const alignLabel = document.createElement("span"); alignLabel.textContent = "Alignement"; alignField.append(alignLabel);
		const alignment = row(alignField, "bookbinder-style-alignment"); alignment.setAttribute("role", "group"); alignment.setAttribute("aria-label", "Alignement du paragraphe");
		const margins = row(panels[1], "bookbinder-style-margins");
		panels[2].classList.add("bookbinder-style-flow");
		const sample = this.sample();
		const computed = this.frame.contentWindow!.getComputedStyle(sample, this.catalog.find(style => style.selector === this.selected)?.pseudo);
		const field = (parent: HTMLElement, label: string) => {
			const wrapper = document.createElement("label"); wrapper.className = "bookbinder-toolbar-field";
			const unit = label.match(/ \((em|pt)\)$/)?.[1];
			if (unit) wrapper.dataset.unit = unit;
			const names: Record<string, string> = { "Espacement des caractères": "Approche", "Marge haute": "Haut", "Marge basse": "Bas", "Marge gauche": "Gauche", "Marge droite": "Droite" };
			const title = label.replace(/ \((em|pt)\)$/, "");
			const name = document.createElement("span"); name.textContent = names[title] ?? title; wrapper.append(name);
			parent.append(wrapper); return wrapper;
		};
		const select = (parent: HTMLElement, label: string, options: Record<string, string>, current: string, change: (value: string) => void) => {
			const input = document.createElement("select"); input.setAttribute("aria-label", label);
			for (const [value, text] of Object.entries(options)) { const option = document.createElement("option"); option.value = value; option.textContent = text; input.append(option); }
			if (!(current in options)) { const option = document.createElement("option"); option.value = current; option.textContent = current; input.append(option); }
			input.value = current; input.addEventListener("change", () => change(input.value)); field(parent, label).append(input);
		};
		select(header, this.options.rules ? "Règle" : "Style", Object.fromEntries(this.catalog.map(style => [style.selector, style.label])), this.selected, value => {
			this.selected = value; this.update(); this.renderToolbar(); this.reveal();
		});
		const families: Record<string, string> = { "": "Auto", serif: "Serif", "sans-serif": "Sans serif", monospace: "Monospace" };
		for (const filename of new Set([...this.presentation.fonts, ...this.fonts.keys()])) families[fontFamily(filename)] = filename.split(/[/\\]/).pop()!;
		select(type, "Police", families, String(this.values()["font-family"] ?? ""), value => this.set("font-family", value || undefined));
		const number = (parent: HTMLElement, label: string, property: string, effective: number, minimum: number, maximum: number, unit: string) => {
			const input = document.createElement("input"); input.type = "number"; input.min = String(minimum); input.max = String(maximum); input.step = "any";
			input.placeholder = "Auto"; input.setAttribute("aria-label", label);
			input.value = this.values()[property] === undefined ? "" : String(Math.round(effective * 100) / 100);
			input.addEventListener("input", () => {
				if (!input.checkValidity()) return;
				this.set(property, input.value === "" ? undefined : unit ? input.valueAsNumber + unit : input.valueAsNumber);
			});
			field(parent, label).append(input);
		};
		const points = (property: string) => (parseFloat(computed.getPropertyValue(property)) || 0) * 0.75;
		const unit = this.relativeUnits ? "em" : "pt";
		const length = (property: string) => this.relativeUnits ? this.emValue(property) : points(property);
		number(type, "Corps (" + unit + ")", "font-size", length("font-size"), this.relativeUnits ? 0.1 : 1, this.relativeUnits ? 20 : 200, unit);
		const button = (parent: HTMLElement, label: string, icon: string, active: boolean | "mixed" | undefined, action: () => void) => {
			const input = document.createElement("button"); input.type = "button"; input.className = "clickable-icon"; input.title = label + (active === "mixed" ? " : Auto" : "");
			if (this.options.setIcon) this.options.setIcon(input, icon); else input.textContent = label;
			input.setAttribute("aria-label", label); if (active !== undefined) input.setAttribute("aria-pressed", String(active));
			if (active === "mixed") input.dataset.auto = "true";
			input.addEventListener("click", () => { action(); this.renderToolbar(); }); parent.append(input);
		};
		for (const [property, on, label, icon] of [["font-weight", "bold", "Gras", "bold"], ["font-style", "italic", "Italique", "italic"]]) {
			const current = this.values()[property];
			const active = current === on || property === "font-weight" && Number(current) >= 600;
			button(emphasis, label, icon, current === undefined ? "mixed" : active, () => this.set(property, current === undefined ? on : active ? "normal" : undefined));
		}
		button(alignment, "Alignement automatique", "rotate-ccw", this.values()["text-align"] === undefined, () => this.set("text-align", undefined));
		for (const [value, label] of [["left", "Gauche"], ["center", "Centré"], ["right", "Droite"], ["justify", "Justifié"]]) {
			button(alignment, "Aligner : " + label, "align-" + value, this.values()["text-align"] === value, () => this.set("text-align", value));
		}
		const color = document.createElement("input"); color.type = "color"; color.setAttribute("aria-label", "Couleur du texte");
		const rgb = computed.color.match(/\d+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
		color.value = "#" + rgb.map(value => Math.min(255, value).toString(16).padStart(2, "0")).join("");
		const colorValue = this.values().color;
		select(character, "Couleur", { "": "Auto", custom: "Personnalisée", transparent: "Invisible" }, colorValue === undefined ? "" : colorValue === "transparent" ? "transparent" : "custom", value => {
			this.set("color", value === "" ? undefined : value === "transparent" ? "transparent" : color.value); this.renderToolbar();
		});
		if (colorValue !== undefined && colorValue !== "transparent") {
			color.addEventListener("input", () => this.set("color", color.value)); field(character, "Couleur personnalisée").append(color);
		}
		const size = parseFloat(computed.fontSize) || 16;
		number(type, this.relativeUnits ? "Interligne (em)" : "Interligne", "line-height", (parseFloat(computed.lineHeight) || size * 1.2) / size, 0.5, 5, this.relativeUnits ? "em" : "");
		for (const [property, label] of [["margin-top", "Marge haute"], ["margin-bottom", "Marge basse"], ["margin-left", "Marge gauche"], ["margin-right", "Marge droite"], ["text-indent", "Alinéa"]]) {
			number(property === "text-indent" ? paragraph : margins, label + " (" + unit + ")", property, length(property), this.relativeUnits ? -100 : -300, this.relativeUnits ? 100 : 300, unit);
		}
		if (this.relativeUnits) number(character, "Espacement des caractères (em)", "letter-spacing", this.emValue("letter-spacing"), -5, 5, "em");
		select(panels[2], "Affichage", { "": "Auto", block: "Visible", none: "Masqué" }, this.values().display === undefined ? "" : this.values().display === "none" ? "none" : "block", value => this.set("display", value === "block" && ["SPAN", "A"].includes(sample.tagName) ? "inline" : value || undefined));
		select(panels[2], "Saut de page avant", { "": "Auto", always: "Oui", auto: "Non" }, String(this.values()["page-break-before"] ?? ""), value => this.set("page-break-before", value || undefined));
		button(header, "Réinitialiser ce style", "rotate-ccw", undefined, () => {
			if (this.selected === "p") this.presentation.style = {};
			else if (/^h[1-6]$/.test(this.selected)) delete this.presentation.headings[this.selected];
			else if (this.options.rules) delete this.presentation.rules![this.selected];
			else delete this.presentation.styles![this.selected];
			this.changed(); this.update();
		});
		if (focused) Array.from(this.toolbar.querySelectorAll<HTMLElement>("[aria-label]")).find(element => element.getAttribute("aria-label") === focused)?.focus();
	}
}
