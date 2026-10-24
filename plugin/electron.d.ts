declare module "electron" {
	export const remote: {
		dialog: {
			showOpenDialog(options: {
				title: string;
				defaultPath?: string;
				properties: string[];
				filters?: { name: string; extensions: string[] }[];
			}): Promise<{ canceled: boolean; filePaths: string[] }>;
		};
	};
	export const shell: { openPath(filename: string): Promise<string> };
}
