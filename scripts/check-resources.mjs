import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import ts from "typescript";

const bundle = await readFile(new URL("../main.js", import.meta.url), "utf8");
const tree = ts.createSourceFile("main.js", bundle, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const strings = new Set();
function collect(node) {
	if (ts.isStringLiteralLike(node)) strings.add(node.text);
	ts.forEachChild(node, collect);
}
collect(tree);

let count = 0;
for (const directory of ["lua", "latex", "epub"]) {
	const root = new URL(`./${directory}/`, import.meta.url);
	for (const name of await readdir(root)) {
		const content = await readFile(new URL(name, root), "utf8");
		assert.ok(strings.has(`${directory}/${name}`), `${directory}/${name} absent du registre compilé`);
		assert.ok(strings.has(content), `${directory}/${name} absent ou altéré dans main.js`);
		count++;
	}
}
assert.ok(count > 0, "Aucune ressource vérifiée");
console.log(`${count} ressources présentes à l’identique dans main.js.`);
