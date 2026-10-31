import { defaultMessages, t } from "./i18n.ts";

export function isProjectNote(filename: string): boolean {
	return /^bookbinder(?:-.+)?\.md$/i.test(filename.replace(/\\/g, "/").split("/").pop() ?? "");
}

export function projectNoteName(sourceName: string): string { return `bookbinder-${sourceName}.md`; }

export function highlightProjectNotes(container: HTMLElement): () => void {
	const update = (root: Element) => {
		const files = Array.from(root.querySelectorAll<HTMLElement>(".nav-file-title[data-path]"));
		if (root.matches(".nav-file-title[data-path]")) files.push(root as HTMLElement);
		for (const file of files) file.classList.toggle("bookbinder-project-file", isProjectNote(file.dataset.path ?? ""));
	};
	const observer = new MutationObserver(records => {
		for (const record of records) {
			if (record.type === "attributes") update(record.target as Element);
			else for (const node of record.addedNodes) if (node.nodeType === 1) update(node as Element);
		}
	});
	update(container);
	observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-path"] });
	return () => {
		observer.disconnect();
		for (const file of container.querySelectorAll(".bookbinder-project-file")) file.classList.remove("bookbinder-project-file");
	};
}

export function linkProjectNote(element: HTMLElement, sourcePath: string, vault: string): void {
	if (!isProjectNote(sourcePath)) return;
	for (const link of element.querySelectorAll<HTMLAnchorElement>("a[href]")) {
		if (/^obsidian:\/\/bookbinder\/?$/i.test(link.getAttribute("href") ?? "")) {
			link.href = `obsidian://bookbinder?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(sourcePath)}`;
			if (!link.childElementCount && [defaultMessages.fr.editProject, defaultMessages.en.editProject, t("editProject", {}, "fr"), t("editProject", {}, "en")].includes(link.textContent ?? "")) link.textContent = t("editProject");
		}
	}
}
