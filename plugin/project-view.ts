export function isProjectNote(filename: string): boolean {
	return ["bookbinder.md", "book-print.md"].includes(filename.split("/").pop()?.toLowerCase() ?? "");
}

export function linkProjectNote(element: HTMLElement, sourcePath: string, vault: string): void {
	if (!isProjectNote(sourcePath)) return;
	for (const link of element.querySelectorAll<HTMLAnchorElement>("a[href]")) {
		if (/^obsidian:\/\/(bookbinder|book-print)\/?$/i.test(link.getAttribute("href") ?? "")) {
			link.href = `obsidian://bookbinder?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(sourcePath)}`;
		}
	}
}
