import { spawn } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import path from "node:path";

export async function evaluateInChrome(expression, directory, screenshot) {
	const chrome = process.env.BOOK_PRINT_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
	await access(chrome);
	const child = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-pipe", `--user-data-dir=${path.join(directory, "chrome")}`], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
	const pending = new Map();
	let sequence = 0;
	let buffer = "";
	const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
		const id = ++sequence;
		pending.set(id, { resolve, reject });
		child.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0");
	});
	child.stdio[4].setEncoding("utf8");
	child.stdio[4].on("data", chunk => {
		buffer += chunk;
		let index;
		while ((index = buffer.indexOf("\0")) >= 0) {
			const message = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1);
			const request = pending.get(message.id);
			if (request) { pending.delete(message.id); message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result); }
		}
	});
	const failed = error => { for (const request of pending.values()) request.reject(error); pending.clear(); };
	child.on("error", failed);
	child.stdio[3].on("error", failed);
	child.on("close", () => failed(new Error("Chrome s’est arrêté avant la fin du contrôle.")));
	const timer = setTimeout(() => { failed(new Error("Le contrôle graphique n’a pas terminé.")); child.kill(); }, 30000);
	try {
		const target = await call("Target.createTarget", { url: "about:blank" });
		const session = await call("Target.attachToTarget", { targetId: target.targetId, flatten: true });
		await call("Emulation.setDeviceMetricsOverride", { width: 1120, height: 1000, deviceScaleFactor: 1, mobile: false }, session.sessionId);
		const evaluation = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, session.sessionId);
		if (evaluation.exceptionDetails) throw new Error(evaluation.exceptionDetails.exception?.description ?? evaluation.exceptionDetails.text);
		if (screenshot) {
			const captured = await call("Page.captureScreenshot", { format: "png" }, session.sessionId);
			await writeFile(screenshot, Buffer.from(captured.data, "base64"));
		}
		return evaluation.result.value;
	} finally {
		clearTimeout(timer);
		const closed = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise(resolve => child.once("close", resolve));
		child.kill();
		await closed;
	}
}
