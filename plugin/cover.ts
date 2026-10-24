export interface CoverOptions {
	title: string;
	author: string;
	subtitle: string;
	footer: string;
	background?: string;
}

export async function renderCover(options: CoverOptions): Promise<Uint8Array> {
	const canvas = document.createElement("canvas");
	canvas.width = 1600;
	canvas.height = 2400;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Impossible de créer la couverture.");
	context.fillStyle = "rgb(250,250,250)";
	context.fillRect(0, 0, canvas.width, canvas.height);
	if (options.background) {
		const image = new Image();
		image.src = options.background;
		await image.decode();
		context.drawImage(image, 0, 0, canvas.width, canvas.height);
		context.fillStyle = "rgba(250,250,250,0.55)";
		context.fillRect(0, 0, canvas.width, canvas.height);
	}
	context.fillStyle = "rgb(225,225,225)";
	for (let x = 0; x < canvas.width; x += 18) context.fillRect(x, 0, 4, canvas.height);
	context.textAlign = "center";
	context.textBaseline = "top";
	const family = 'Helvetica, Arial, sans-serif';
	function text(value: string, y: number, size: number, color: string, spacing = 0): void {
		const characters = Array.from(value);
		context!.font = `${size}px ${family}`;
		const width = () => context!.measureText(value).width + Math.max(0, characters.length - 1) * spacing;
		if (width() > 1360) {
			size *= 1360 / width();
			spacing = 0;
			context!.font = `${size}px ${family}`;
		}
		context!.fillStyle = color;
		if (!spacing) { context!.fillText(value, 800, y); return; }
		let x = (1600 - width()) / 2;
		context!.textAlign = "left";
		for (const character of characters) {
			context!.fillText(character, x, y);
			x += context!.measureText(character).width + spacing;
		}
		context!.textAlign = "center";
	}

	text(options.author.toUpperCase(), 240, 58, "rgb(60,60,60)", 8);
	const lines = options.title.replace(/\\n/g, "\n").split("\n");
	const longest = Math.max(...lines.map(line => Array.from(line).length));
	const titleSize = longest <= 6 ? 160 : Math.max(80, 160 - longest * 8);
	const lineHeight = Math.min(titleSize * 1.4, 1100 / Math.max(1, lines.length));
	lines.forEach((line, index) => text(line.toUpperCase(), 720 + index * lineHeight, Math.min(titleSize, lineHeight / 1.4), "rgb(180,20,20)", Math.max(4, Math.floor(titleSize / 13))));
	text(options.subtitle, 720 + lines.length * lineHeight, 52, "rgb(120,120,120)");
	text(options.footer, 2160, 48, "rgb(60,60,60)", 8);
	const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("La couverture JPEG n’a pas pu être générée.")), "image/jpeg", 0.92));
	return new Uint8Array(await blob.arrayBuffer());
}
