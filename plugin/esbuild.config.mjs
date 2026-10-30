import { context } from "esbuild";
import { builtinModules } from "node:module";

const production = process.argv[2] === "production";
const build = await context({
	entryPoints: ["main.ts"],
	bundle: true,
	external: ["obsidian", "electron", ...builtinModules, ...builtinModules.map(name => `node:${name}`)],
	format: "cjs",
	target: "es2021",
	outfile: "main.js",
	loader: { ".lua": "text", ".latex": "text", ".css": "text", ".md": "text", ".svg": "text" },
	sourcemap: production ? false : "inline",
	minify: production,
	logLevel: "info",
});

if (production) {
	try { await build.rebuild(); }
	finally { await build.dispose(); }
} else {
	await build.watch();
}
