import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, ".."), directory = await mkdtemp(path.join(tmpdir(), "bookbinder-settings-"));
await build({
	stdin: { contents: 'export { BookbinderSettingTab } from "./plugin/settings-tab.ts"; export * from "./plugin/i18n.ts"; export { DEFAULT_SETTINGS } from "./plugin/types.ts"; export { readModel } from "./plugin/project-models.ts";', resolveDir: root },
	bundle: true, platform: "node", format: "cjs", outfile: path.join(directory, "settings.cjs"),
	loader: { ".lua": "text", ".latex": "text", ".css": "text" },
	plugins: [{ name: "obsidian-platform", setup(build) {
		build.onResolve({ filter: /^(obsidian|electron)$/ }, args => ({ path: args.path, namespace: "platform" }));
		build.onLoad({ filter: /.*/, namespace: "platform" }, args => ({ contents: args.path === "electron" ? "export const remote = {};" : `
			export class PluginSettingTab { constructor(app) { this.app = app; } }
			export class App {} export class Modal {} export class Notice {} export class Setting {}
			export class FileSystemAdapter {} export class ButtonComponent {} export class ExtraButtonComponent {} export class TextComponent {}
			export const parseYaml = JSON.parse, stringifyYaml = JSON.stringify;
			export const requestUrl = async () => ({ status: 503, text: "Unavailable" });
			export const sanitizeHTMLToDom = () => {}, setIcon = () => {};
		` }));
	} }],
});
const { BookbinderSettingTab, DEFAULT_SETTINGS, setLocale, t, readModel } = createRequire(import.meta.url)(path.join(directory, "settings.cjs"));
setLocale("fr");
const modelDirectory = path.join(directory, "models");
const baseModel = '---\n{"title":"","author":"","rights":"","pdf":{},"docx":{},"epub":{}}\n---\n';
const plugin = { settings: { ...DEFAULT_SETTINGS }, modelDirectory, async saveSettings(settings) { this.settings = settings; }, async defaultProjectData(model) { return await readModel(modelDirectory, model, JSON.parse, baseModel); } };
const failures = [];
const onRejection = error => failures.push(error);
process.on("unhandledRejection", onRejection);
const previousWindow = globalThis.window;
globalThis.window = { setTimeout, clearTimeout };
let adopted = 0;
class Component {
	setDisabled(value) { this.disabled = value; if (!value) this.ready?.(); return this; }
	then(resolve) {
		if (++adopted > 3) throw new Error("A promise adopted an Obsidian component and would loop indefinitely");
		resolve(this); return this;
	}
}
class ModelSetting {
	status = { isConnected: true, text: "", setText(text) { this.text = text; }, empty() { this.text = ""; } };
	descEl = { createDiv: () => this.status };
	addDropdown(configure) {
		this.input = Object.assign(new Component(), {
			options: new Map(),
			selectEl: { setAttribute() {}, replaceChildren: () => this.input.options.clear() },
			addOption(value, label) { this.options.set(value, label); return this; },
			setValue(value) { this.value = value; return this; },
			onChange(callback) { this.change = callback; return this; },
		});
		configure(this.input); return this;
	}
	addButton(configure) {
		this.button = Object.assign(new Component(), { setButtonText(text) { this.text = text; return this; }, onClick(callback) { this.click = callback; return this; } });
		configure(this.button); return this;
	}
}
try {
	const tab = new BookbinderSettingTab({}, plugin);
	const definition = tab.getSettingDefinitions().flatMap(group => group.items).find(item => item.name === t("projectModel"));
	assert.ok(definition);
	for (let opening = 0; opening < 3; opening++) {
		const setting = new ModelSetting();
		definition.render(setting);
		let timer;
		try { await Promise.race([new Promise(resolve => { setting.input.ready = resolve; }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Model settings did not finish loading")), 5000); })]); }
		finally { clearTimeout(timer); }
		await new Promise(resolve => setImmediate(resolve));
		assert.equal(adopted, 0, "Opening model settings must complete without resolving a UI component as a promise");
		assert.deepEqual(failures, [], "Opening settings has no unhandled promise rejection");
		assert.deepEqual([...setting.input.options.keys()], ["base.md"]);
		assert.equal(setting.input.value, "base.md");
		assert.equal(setting.input.disabled, false);
		await setting.input.change("base.md");
		assert.equal(plugin.settings.projectModel, "base.md");
		await setting.button.click();
		assert.match(setting.status.text, /503/, "Failed downloads stay visible without blocking the settings");
		assert.equal(setting.button.disabled, false); assert.equal(setting.input.disabled, false);
		tab.hide();
	}
} finally {
	process.off("unhandledRejection", onRejection);
	if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
}
console.log("Settings: model loading, repeated opening, selection and failed downloads settle without adopting Obsidian components: OK.");
