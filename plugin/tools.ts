import { execFile } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";

export type Tool = "pandoc" | "xelatex";
export type ToolStatus =
	| { state: "found"; path: string; version: string }
	| { state: "missing" | "error"; message: string; path?: string };

export function compareVersions(installed: string, published: string): number | undefined {
	const parse = (value: string) => value.length <= 64 ? value.match(/^(\d+(?:\.\d+)*)(-[\w.-]+)?(?:\+[\w.-]+)?$/) : null;
	const left = parse(installed);
	const right = parse(published);
	if (!left || !right) return undefined;
	const a = left[1].split(".").map(Number);
	const b = right[1].split(".").map(Number);
	if (![...a, ...b].every(Number.isSafeInteger)) return undefined;
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0) ? 1 : -1;
	}
	if (left[2] === right[2]) return 0;
	if (!left[2]) return 1;
	if (!right[2]) return -1;
	return undefined;
}

export function searchDirectories(env: NodeJS.ProcessEnv, platform = process.platform, home = homedir()): string[] {
	const paths = platform === "win32" ? path.win32 : path.posix;
	const searchPath = Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? "";
	const directories = searchPath.split(platform === "win32" ? ";" : ":").filter(Boolean);
	if (platform === "darwin") directories.push("/opt/homebrew/bin", "/usr/local/bin", "/Library/TeX/texbin");
	if (platform === "win32") {
		if (env.LOCALAPPDATA) directories.push(
			paths.join(env.LOCALAPPDATA, "Pandoc"),
			paths.join(env.LOCALAPPDATA, "Programs", "Pandoc"),
			paths.join(env.LOCALAPPDATA, "Programs", "MiKTeX", "miktex", "bin", "x64"),
		);
		if (env.ProgramFiles) directories.push(
			paths.join(env.ProgramFiles, "Pandoc"),
			paths.join(env.ProgramFiles, "MiKTeX", "miktex", "bin", "x64"),
		);
	} else {
		directories.push("/usr/local/bin", "/usr/bin", paths.join(home, ".local", "bin"), paths.join(home, "bin"));
	}
	return [...new Set(directories.map(directory => directory.replace(/^"(.*)"$/, "$1")))];
}

async function texDirectories(): Promise<string[]> {
	const root = process.platform === "win32" ? `${process.env.SystemDrive ?? "C:"}\\texlive` : "/usr/local/texlive";
	const directories: string[] = [];
	try {
		for (const version of await readdir(root, { withFileTypes: true })) {
			if (!version.isDirectory()) continue;
			const bin = path.join(root, version.name, "bin");
			try {
				for (const architecture of await readdir(bin, { withFileTypes: true })) {
					if (architecture.isDirectory()) directories.push(path.join(bin, architecture.name));
				}
			} catch { /* Une distribution incomplète ne doit pas interrompre la recherche. */ }
		}
	} catch { /* TeX Live peut ne pas être installé. */ }
	return directories.sort().reverse();
}

function versionOf(tool: Tool, stdout: string): string | undefined {
	const match = stdout.match(tool === "pandoc" ? /^pandoc\s+(\d[\w.+-]*)/m : /^(?:MiKTeX-)?XeTeX\s+(\d[\w.+-]*)/mi);
	if (!match) return undefined;
	if (tool === "pandoc") return match[1];
	return stdout.match(/\((TeX Live [^)]+|MiKTeX [^)]+)\)/)?.[1] ?? `XeTeX ${match[1]}`;
}

async function checkExecutable(tool: Tool, executable: string): Promise<ToolStatus> {
	return new Promise(resolve => {
		execFile(executable, ["--version"], { encoding: "utf8", timeout: 5000, maxBuffer: 65536, windowsHide: true }, (error, stdout) => {
			if (error) {
				const code = (error as NodeJS.ErrnoException).code;
				resolve({ state: "error", path: executable, message: error.killed
					? "Le programme ne répond pas. Vérifiez son installation."
					: code === "EACCES" ? "Le programme n’est pas autorisé à s’exécuter."
					: "Le programme ne démarre pas correctement. Vérifiez son installation." });
				return;
			}
			const version = versionOf(tool, stdout);
			resolve(version ? { state: "found", path: executable, version }
				: { state: "error", path: executable, message: tool === "pandoc"
					? "Le fichier sélectionné ne correspond pas à Pandoc."
					: "Le fichier sélectionné ne correspond pas à XeLaTeX." });
		});
	});
}

export async function detectTool(tool: Tool, configuredPath = "", env = process.env): Promise<ToolStatus> {
	let configured = configuredPath.trim().replace(/^(["'])(.*)\1$/, "$2");
	if (configured.includes("\0")) return { state: "error", message: "Le chemin contient un caractère invalide." };
	if (configured === "~" || configured.startsWith("~/")) configured = path.join(homedir(), configured.slice(2));
	const command = configured || tool;
	const name = process.platform === "win32" && !command.toLowerCase().endsWith(".exe") ? `${command}.exe` : command;
	const directories = searchDirectories(env);
	if (!configured && tool === "xelatex") directories.push(...await texDirectories());
	const candidates = configured && (path.isAbsolute(configured) || /[/\\]/.test(configured))
		? [configured]
		: directories.map(directory => path.join(directory, name));
	let failure: ToolStatus | undefined;
	let newest: Extract<ToolStatus, { state: "found" }> | undefined;
	for (const executable of new Set(candidates)) {
		try {
			await access(executable, constants.F_OK);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") failure ??= {
				state: "error", path: executable, message: "Impossible d’accéder au programme. Vérifiez les autorisations.",
			};
			continue;
		}
		const result = await checkExecutable(tool, executable);
		if (result.state === "found") {
			if (configured) return result;
			const number = (version: string) => tool === "pandoc" ? version : version.match(/\d+(?:\.\d+)*/)?.[0] ?? "";
			const sameDistribution = !newest || result.version.replace(/\d.*$/, "") === newest.version.replace(/\d.*$/, "");
			if (!newest || (sameDistribution && compareVersions(number(result.version), number(newest.version)) === 1)) newest = result;
		} else failure ??= result;
	}
	return newest ?? failure ?? { state: "missing", message: configured
		? "Programme introuvable à cet emplacement. Corrigez le chemin ou rétablissez la détection automatique."
		: "Programme non détecté. Installez-le, puis relancez la vérification." };
}
