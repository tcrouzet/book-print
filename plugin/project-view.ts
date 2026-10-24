export function isProjectNote(filename: string): boolean {
	return filename.split("/").pop()?.toLowerCase() === "book-print.md";
}

export function linkProjectNote(element: HTMLElement, sourcePath: string, vault: string): void {
	if (!isProjectNote(sourcePath)) return;
	for (const link of element.querySelectorAll<HTMLAnchorElement>("a[href]")) {
		if (/^obsidian:\/\/book-print\/?$/i.test(link.getAttribute("href") ?? "")) {
			link.href = `obsidian://book-print?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(sourcePath)}`;
		}
	}
}
