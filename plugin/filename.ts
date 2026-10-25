export function slugFilename(value: string): string {
	let slug = value.trim().replace(/\.(?:epub|pdf|docx)$/i, "").toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "")
		.replace(/œ/g, "oe").replace(/æ/g, "ae").replace(/ß/g, "ss")
		.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
	if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(slug)) slug += "-book";
	// Leave room for export extensions and numbered versions.
	return slug.slice(0, 200).replace(/-+$/, "");
}

export function defaultFilename(title: string, author: unknown): string {
	const first: unknown = Array.isArray(author) ? author[0] : author;
	const surname = typeof first === "string" ? first.trim().split(/\s+/).pop() : "";
	const bookTitle = title.replace(/\\n/g, " ").trim().replace(/^l['’]\s*/i, "");
	return slugFilename([surname, bookTitle].filter(Boolean).join("-")) || "book";
}

export function bindFilenameInput(input: HTMLInputElement, data: Record<string, unknown>, metadata: Record<string, unknown>, changed: () => void): () => void {
	const store = () => {
		const value = slugFilename(input.value);
		if (value) data.filename = value;
		else delete data.filename;
	};
	input.value = typeof data.filename === "string" ? slugFilename(data.filename) : "";
	store();
	input.addEventListener("input", () => { store(); changed(); });
	input.addEventListener("blur", () => { input.value = typeof data.filename === "string" ? data.filename : ""; });
	const refresh = () => {
		const title = data.title ?? metadata.title;
		input.placeholder = defaultFilename(typeof title === "string" ? title : "", data.author ?? metadata.author);
	};
	refresh();
	return refresh;
}
