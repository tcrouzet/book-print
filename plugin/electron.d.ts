declare module "electron" {
	export const remote: {
		dialog: {
			showMessageBox(options: {
				type: string;
				title: string;
				message: string;
				detail: string;
				buttons: string[];
				defaultId: number;
				cancelId: number;
			}): Promise<{ response: number }>;
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
