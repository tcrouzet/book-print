import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
assert.equal(pkg.version, manifest.version);
assert.equal(lock.version, manifest.version);
assert.equal(lock.packages[""].version, manifest.version);

const parsed = spawnSync("ruby", ["-rjson", "-ryaml", "-e", "print JSON.generate(YAML.safe_load(File.read(ARGV.fetch(0))))", path.join(root, ".github/workflows/release.yml")], { encoding: "utf8" });
assert.ifError(parsed.error);
assert.equal(parsed.status, 0, parsed.stderr);
interface Step { uses?: string; run?: string; env?: Record<string, string>; with?: Record<string, string | boolean> }
const workflow = JSON.parse(parsed.stdout) as {
	on?: { push: { tags: string[] } }; true?: { push: { tags: string[] } };
	permissions: Record<string, string>;
	jobs: { build: { permissions: Record<string, string>; steps: Step[] } };
};
assert.deepEqual((workflow.on ?? workflow.true)?.push.tags, ["[0-9]*"]);
assert.deepEqual(workflow.permissions, { contents: "read" });
assert.deepEqual(workflow.jobs.build.permissions, { contents: "write", "id-token": "write", attestations: "write" });
const steps = workflow.jobs.build.steps;
for (const step of steps.filter(step => step.uses)) assert.match(step.uses!, /^[^@]+@[a-f0-9]{40}$/);
assert.equal(steps.find(step => step.uses?.startsWith("actions/setup-node@"))?.with?.["node-version-file"], ".nvmrc");
assert.deepEqual(String(steps.find(step => step.uses?.startsWith("actions/attest@"))?.with?.["subject-path"]).trim().split(/\s+/).sort(), ["main.js", "manifest.json", "styles.css"]);
const validation = steps.find(step => step.run?.includes("npm ci"))?.run;
const publication = steps.find(step => step.run?.includes("gh release create"))?.run;
assert.ok(validation && publication);
assert.equal(steps.find(step => step.run === publication)?.env?.GH_TOKEN, "${{ secrets.GITHUB_TOKEN }}");
assert.equal(steps.find(step => step.run === publication)?.env?.RELEASE_TAG, "${{ github.ref_name }}");
const versionCheck = validation.split("\n").find(line => line.startsWith("node -e "));
assert.ok(versionCheck);
for (const script of [validation, publication]) assert.equal(spawnSync("bash", ["-n", "-c", script]).status, 0);

const directory = mkdtempSync(path.join(tmpdir(), "book-print-release-test-"));
const scenarios = ["ok", "dirty", "trunk", "without-index", "wrong-branch", "invalid-version", "versions-failure", "test-failure", "build-failure", "resource-failure", "push-failure", "api-failure", "mismatch", "tag-push-failure"];
try {
	for (const scenario of scenarios) {
		const base = path.join(directory, scenario);
		const repository = path.join(base, "plugin test");
		const remote = path.join(base, "remote.git");
		const bin = path.join(base, "bin");
		const log = path.join(base, "calls.log");
		const asset = path.join(base, "published.json");
		const branch = scenario === "trunk" ? "trunk" : "main";
		mkdirSync(repository, { recursive: true }); mkdirSync(bin);
		const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`, TMPDIR: base,
			GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
			RELEASE_TEST_CASE: scenario, RELEASE_TEST_REMOTE: remote, RELEASE_TEST_BRANCH: branch,
			RELEASE_TEST_LOG: log, RELEASE_TEST_ASSET: asset };
		const run = (command: string, args: string[]) => {
			const result = spawnSync(command, args, { cwd: repository, env, encoding: "utf8", timeout: 20000 });
			assert.ifError(result.error);
			assert.equal(result.status, 0, `${scenario}: ${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
			return result.stdout.trim();
		};
		copyFileSync(path.join(root, "release.sh"), path.join(repository, "release.sh"));
		writeFileSync(path.join(repository, "manifest.json"), JSON.stringify({ id: "test", version: scenario === "invalid-version" ? "1.2.3-rc.1" : "1.2.3", minAppVersion: "1.14.0", description: "Test." }));
		writeFileSync(path.join(repository, "package.json"), JSON.stringify({
			name: "release-fixture", version: "1.2.3", scripts: {
				test: scenario === "test-failure" ? "node -e 'process.exit(1)'" : "node -e 'process.exit(0)'",
				build: scenario === "build-failure" ? "node -e 'process.exit(1)'" : "node build.cjs",
			},
		}));
		writeFileSync(path.join(repository, "package-lock.json"), JSON.stringify({ name: "release-fixture", version: "1.2.3", lockfileVersion: 3, packages: { "": { name: "release-fixture", version: "1.2.3" } } }));
		if (scenario !== "without-index") writeFileSync(path.join(repository, "versions.json"), scenario === "versions-failure" ? "invalid" : '{"1.2.3":"1.14.0"}');
		writeFileSync(path.join(repository, ".gitignore"), "main.js\nnode_modules/\n");
		writeFileSync(path.join(repository, "styles.css"), "p { margin: 0; }\n");
		mkdirSync(path.join(repository, "scripts"));
		copyFileSync(path.join(root, "scripts/check-resources.mjs"), path.join(repository, "scripts/check-resources.mjs"));
		symlinkSync(path.join(root, "node_modules"), path.join(repository, "node_modules"), "dir");
		const resources: Record<string, string> = {};
		for (const type of ["lua", "latex", "epub"]) {
			mkdirSync(path.join(repository, "scripts", type));
			resources[`${type}/sample.txt`] = `Resource ${type}`;
			writeFileSync(path.join(repository, "scripts", type, "sample.txt"), resources[`${type}/sample.txt`]);
		}
		const built = scenario === "resource-failure" ? {} : resources;
		writeFileSync(path.join(repository, "build.cjs"), `require("node:fs").writeFileSync("main.js",${JSON.stringify("module.exports = " + JSON.stringify(built) + ";")});`);
		writeFileSync(path.join(bin, "gh"), `#!${process.execPath}
const fs = require("node:fs"), path = require("node:path"), {execFileSync} = require("node:child_process");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.RELEASE_TEST_LOG, args.join(" ")+"\\n");
if (args[0] === "repo" && args[1] === "view") {
  console.log(JSON.stringify({nameWithOwner:"test/plugin",defaultBranchRef:{name:process.env.RELEASE_TEST_BRANCH}}));
} else if (args[0] === "api") {
  if(process.env.RELEASE_TEST_CASE === "api-failure") process.exit(1);
  const content = JSON.parse(execFileSync("git",["--git-dir",process.env.RELEASE_TEST_REMOTE,"show",process.env.RELEASE_TEST_BRANCH+":manifest.json"],{encoding:"utf8"}));
  if(process.env.RELEASE_TEST_CASE === "mismatch") content.description = "Different.";
  console.log(JSON.stringify(content));
} else if (args[0] === "release" && args[1] === "create") {
  const files = args.slice(3).filter(file=>fs.existsSync(file)&&fs.statSync(file).isFile()).map(file=>path.basename(file));
  fs.writeFileSync(process.env.RELEASE_TEST_ASSET,JSON.stringify({tag:args[2],files,args,manifest:JSON.parse(fs.readFileSync("manifest.json","utf8"))}));
} else process.exit(99);
`, { mode: 0o755 });
		run("git", ["init", "--bare", remote]);
		run("git", ["init", "-b", branch]);
		run("git", ["config", "user.name", "Release test"]);
		run("git", ["config", "user.email", "release@example.invalid"]);
		run("git", ["config", "commit.gpgsign", "false"]);
		run("git", ["config", "core.hooksPath", path.join(base, "no-hooks")]);
		run("git", ["add", "."]); run("git", ["commit", "-m", "Initial test"]);
		run("git", ["remote", "add", "origin", remote]); run("git", ["push", "origin", branch]);
		if (scenario === "wrong-branch") run("git", ["checkout", "-b", "feature"]);
		if (scenario === "push-failure") writeFileSync(path.join(remote, "hooks/pre-receive"), "#!/bin/bash\nexit 1\n", { mode: 0o755 });
		if (scenario === "tag-push-failure") writeFileSync(path.join(remote, "hooks/pre-receive"), '#!/bin/bash\nwhile read -r old new ref; do if [[ "$ref" == refs/tags/* ]]; then exit 1; fi; done\n', { mode: 0o755 });
		if (["dirty", "wrong-branch", "push-failure"].includes(scenario)) writeFileSync(path.join(repository, "styles.css"), "p { margin: 1em; }\n");
		if (scenario === "dirty") writeFileSync(path.join(repository, "new.md"), "A new source.\n");
		const result = spawnSync("bash", [path.join(repository, "release.sh")], { cwd: base, env, encoding: "utf8", timeout: 30000 });
		assert.ifError(result.error);
		const succeeds = ["ok", "dirty", "trunk", "without-index"].includes(scenario);
		assert.equal(result.status === 0, succeeds, `${scenario}\n${result.stdout}\n${result.stderr}`);
		assert.ok(!readdirSync(base).some(name => name.startsWith("book-print-release.")), "Temporary release files must be cleaned on success and failure");
		const tag = spawnSync("git", ["--git-dir", remote, "rev-parse", "--verify", "refs/tags/1.2.4"], { env, encoding: "utf8" });
		assert.equal(tag.status === 0, succeeds, `${scenario}: unexpected remote tag`);
		assert.ok(!readFileSync(log, "utf8").includes("release create"), "The local script must leave artifact publication to CI");
		assert.ok(!existsSync(asset));
		if (succeeds) {
			assert.equal(tag.stdout.trim(), run("git", ["rev-parse", "HEAD"]));
			const gate: SpawnSyncReturns<string> = spawnSync("bash", ["-euo", "pipefail", "-c", versionCheck], { cwd: repository, env: { ...env, RELEASE_TAG: "1.2.4" }, encoding: "utf8" });
			assert.equal(gate.status, 0, gate.stderr);
			const wrongTag = spawnSync("bash", ["-euo", "pipefail", "-c", versionCheck], { cwd: repository, env: { ...env, RELEASE_TAG: "9.0.0" }, encoding: "utf8" });
			assert.notEqual(wrongTag.status, 0, "A tag mismatch must block the workflow");
			const published: SpawnSyncReturns<string> = spawnSync("bash", ["-euo", "pipefail", "-c", publication], { cwd: repository, env: { ...env, RELEASE_TAG: "1.2.4", GH_TOKEN: "test" }, encoding: "utf8" });
			assert.equal(published.status, 0, published.stderr);
			const artifact = JSON.parse(readFileSync(asset, "utf8"));
			assert.equal(artifact.tag, "1.2.4");
			assert.deepEqual(artifact.files.sort(), ["main.js", "manifest.json", "styles.css"]);
			assert.ok(artifact.args.includes("--verify-tag"));
			assert.deepEqual(artifact.manifest, JSON.parse(run("git", ["--git-dir", remote, "show", `${branch}:manifest.json`])));
			const updatedLock = JSON.parse(readFileSync(path.join(repository, "package-lock.json"), "utf8"));
			assert.equal(updatedLock.version, "1.2.4"); assert.equal(updatedLock.packages[""].version, "1.2.4");
			if (scenario !== "without-index") assert.equal(JSON.parse(readFileSync(path.join(repository, "versions.json"), "utf8"))["1.2.4"], "1.14.0");
			else assert.ok(!existsSync(path.join(repository, "versions.json")));
			assert.equal(run("git", ["status", "--porcelain"]), "");
			assert.equal(run("git", ["rev-list", "--count", "HEAD"]), scenario === "dirty" ? "3" : "2");
			if (scenario === "dirty") assert.equal(run("git", ["--git-dir", remote, "show", `${branch}:new.md`]), "A new source.");
		}
		if (["wrong-branch", "test-failure", "build-failure", "resource-failure", "push-failure"].includes(scenario)) assert.equal(JSON.parse(readFileSync(path.join(repository, "manifest.json"), "utf8")).version, "1.2.3");
		if (["wrong-branch", "test-failure", "build-failure", "resource-failure"].includes(scenario)) assert.equal(run("git", ["rev-list", "--count", "HEAD"]), "1");
		if (scenario === "invalid-version") {
			assert.match(result.stderr, /Version attendue/);
			assert.equal(run("git", ["rev-list", "--count", "HEAD"]), "1");
			assert.equal(JSON.parse(readFileSync(path.join(repository, "manifest.json"), "utf8")).version, "1.2.3-rc.1");
		}
		if (scenario === "versions-failure") assert.equal(JSON.parse(run("git", ["--git-dir", remote, "show", `${branch}:manifest.json`])).version, "1.2.3");
		if (scenario === "mismatch") assert.match(result.stderr, /le manifest GitHub diffère/);
		if (scenario === "tag-push-failure") assert.equal(run("git", ["rev-parse", "refs/tags/1.2.4"]), run("git", ["--git-dir", remote, "rev-parse", branch]));
	}
	console.log(`Release : ${scenarios.length} scénarios, dépôts Git locaux, workflow analysé et publication simulée : OK.`);
} finally {
	rmSync(directory, { recursive: true, force: true });
}
