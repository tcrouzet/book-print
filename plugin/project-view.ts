import { defaultMessages, t } from "./i18n.ts";

export function isProjectNote(filename: string): boolean {
	return filename.split("/").pop()?.toLowerCase() === "bookbinder.md";
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
