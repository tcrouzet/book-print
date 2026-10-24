import * as timers from "node:timers";
import { realpath } from "node:fs/promises";
import { compareVersions, type Tool, type ToolStatus } from "./tools.ts";

export interface UpdateInfo {
	state: "update" | "current" | "newer" | "install" | "unavailable";
	message: string;
	url?: string;
	action?: string;
}

function distribution(tool: Tool, status: ToolStatus, platform: NodeJS.Platform): "pandoc" | "miktex" | "texlive" {
	if (tool === "pandoc") return "pandoc";
	if (status.state === "found") return status.version.startsWith("MiKTeX ") ? "miktex" : "texlive";
	return platform === "win32" ? "miktex" : "texlive";
}

export function updatePage(tool: Tool, status: ToolStatus, platform = process.platform): string {
	if (tool === "pandoc") {
		return "https://github.com/jgm/pandoc/releases/latest";
	}
	if (distribution(tool, status, platform) === "miktex") return status.state === "found"
		? "https://miktex.org/howto/update-miktex" : "https://miktex.org/download";
	if (platform === "darwin") {
		if (status.state === "found" && /\d{4}basic(?:[/\\]|$)/i.test(status.path)) return "https://www.tug.org/mactex/morepackages.html";
		return "https://www.tug.org/mactex/mactex-download.html";
	}
	return platform === "win32" ? "https://www.tug.org/texlive/windows.html" : "https://www.tug.org/texlive/quickinstall.html";
}
export function pandocInstaller(links: readonly string[], platform: NodeJS.Platform, architecture: string): string | undefined {
	const suffix = platform === "darwin" ? architecture === "arm64" ? "arm64-macOS.pkg" : architecture === "x64" ? "x86_64-macOS.pkg" : undefined
		: platform === "win32" && architecture === "x64" ? "windows-x86_64.msi" : undefined;
	if (!suffix) return undefined;
	for (const link of links) {
		try {
			const url = new URL(link);
			if (url.origin === "https://github.com" && !url.username && !url.password
				&& url.pathname.startsWith("/jgm/pandoc/releases/download/") && url.pathname.endsWith(`-${suffix}`)) return url.href;
		} catch { /* Un lien invalide ne doit pas masquer les autres installateurs. */ }
	}
	return undefined;
}

export async function checkUpdate(tool: Tool, status: ToolStatus, read: (url: string) => Promise<string>, platform = process.platform, architecture = process.arch): Promise<UpdateInfo> {
	const resolved = status.state === "found" ? { ...status, path: await realpath(status.path).catch(() => status.path) } : status;
	let url = updatePage(tool, resolved, platform);
	const source = distribution(tool, status, platform);
	let timer: ReturnType<typeof timers.setTimeout> | undefined;
	try {
		const endpoint = source === "texlive" ? "https://www.tug.org/texlive/"
			: `https://api.github.com/repos/${source === "pandoc" ? "jgm/pandoc" : "MiKTeX/miktex"}/releases/latest`;
		const text = await Promise.race([
			read(endpoint),
			new Promise<string>((_, reject) => { timer = timers.setTimeout(() => reject(new Error("Timeout")), 8000); }),
		]);
		if (text.length > 1_000_000) throw new Error("Réponse trop volumineuse");
		let published: string | undefined;
		if (source === "texlive") {
			const plain = text.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ");
			published = plain.match(/Current\s+release:\s*TeX\s+Live\s+(\d{4})\b/i)?.[1];
		} else {
			const release: unknown = JSON.parse(text);
			if (release && typeof release === "object" && "tag_name" in release && typeof release.tag_name === "string"
				&& "draft" in release && release.draft === false && "prerelease" in release && release.prerelease === false) {
				published = release.tag_name.replace(/^v/, "");
				if (source === "pandoc" && "assets" in release && Array.isArray(release.assets)) {
					const links = release.assets.flatMap((asset: unknown) => asset && typeof asset === "object"
						&& "browser_download_url" in asset && typeof asset.browser_download_url === "string" ? [asset.browser_download_url] : []);
					url = pandocInstaller(links, platform, architecture) ?? url;
				}
			}
		}
		if (!published || compareVersions(published, published) !== 0) throw new Error("Version inconnue");
		const download = tool === "xelatex" ? "Page officielle de téléchargement"
			: /\.(?:pkg|msi|exe)$/.test(url) ? "Télécharger l’installateur" : "Voir les installateurs";
		if (status.state !== "found") return { state: "install", message: `Version disponible : ${published}.`, url, action: download };
		const installed = tool === "pandoc" ? status.version : status.version.match(/^(?:TeX Live|MiKTeX)\s+(\d+(?:\.\d+)*)\b/)?.[1];
		const comparison = installed ? compareVersions(installed, published) : undefined;
		if (comparison === undefined) throw new Error("Version installée inconnue");
		if (comparison < 0) return { state: "update", message: `${source === "texlive" ? "Version annuelle" : "Version"} ${published} disponible.${source === "miktex" ? " Ouvrez MiKTeX Console puis Updates." : ""}`,
			url, action: source === "miktex" ? "Guide de MiKTeX Console" : download };
		return { state: comparison === 0 ? "current" : "newer", message: comparison === 0
			? `À jour (${source === "texlive" ? "version annuelle " : ""}${published}).`
			: `Version installée plus récente que la version publiée (${published}).` };
	} catch {
		return { state: "unavailable", message: "Comparaison en ligne indisponible. Le site officiel reste accessible.", url, action: "Ouvrir le site officiel" };
	} finally {
		timers.clearTimeout(timer);
	}
}
