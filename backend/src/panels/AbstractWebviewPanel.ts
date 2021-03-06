import * as vscode from 'vscode';
import * as path from 'path';
import * as _ from 'lodash';
import * as fsextra from 'fs-extra';
import { IChildLogger } from '@vscode-logging/logger';
import { getLogger } from '../logger/logger-wrapper';


export abstract class AbstractWebviewPanel {
	public viewType: string;
	protected extensionPath: string;
	protected mediaPath: string;
	protected viewTitle: string;
	protected webViewPanel: vscode.WebviewPanel;
	protected viewColumn: vscode.ViewColumn;
	protected focusedKey: string;
	protected htmlFileName: string;
	protected uiOptions: any;

	protected logger: IChildLogger;
	protected disposables: vscode.Disposable[];

	protected constructor(context: vscode.ExtensionContext) {
		this.extensionPath = context.extensionPath;
		this.mediaPath = path.join(context.extensionPath, "dist", "media");
		this.htmlFileName = "index.html";
		this.logger = getLogger();
		this.disposables = [];
	}

	public setWebviewPanel(webviewPanel: vscode.WebviewPanel, uiOptions?: any) {
		this.webViewPanel = webviewPanel;
		this.uiOptions = uiOptions;
		this.viewColumn = this.uiOptions?.viewColumn || vscode.ViewColumn.One;
	}

	public loadWebviewPanel(uiOptions?: any) {
		if (this.webViewPanel && _.isEmpty(uiOptions)) {
			this.webViewPanel.reveal();
		} else {
			this.disposeWebviewPanel();
			this.viewColumn = uiOptions?.viewColumn || vscode.ViewColumn.One;
			const webViewPanel = this.createWebviewPanel();
			this.setWebviewPanel(webViewPanel, uiOptions);
		}
	}

	protected createWebviewPanel(): vscode.WebviewPanel {
		return vscode.window.createWebviewPanel(
			this.viewType,
			this.viewTitle,
			this.viewColumn,
			{
				// Enable javascript in the webview
				enableScripts: true,
				retainContextWhenHidden: true,
				// And restrict the webview to only loading content from our extension's `media` directory.
				localResourceRoots: [vscode.Uri.file(this.mediaPath)]
			}
		);
	}

	protected disposeWebviewPanel() {
		const displayedPanel = this.webViewPanel;
		if (displayedPanel) {
			this.dispose();
		}
	}

	protected initWebviewPanel() {
		// Set the webview's initial html content
		this.initHtmlContent();

		// Set the context (current panel is focused)
		this.setFocused(this.webViewPanel.active);

		this.webViewPanel.onDidDispose(() => this.dispose(), null, this.disposables);

		// Update the content based on view changes
		this.webViewPanel.onDidChangeViewState(
			e => {
				this.setFocused(this.webViewPanel.active);
			},
			null,
			this.disposables
		);
	}

	protected setFocused(focusedValue: boolean) {
		vscode.commands.executeCommand('setContext', this.focusedKey, focusedValue);
	}

	private dispose() {
		this.setFocused(false);

		// Clean up our resources
		this.webViewPanel.dispose();
		this.webViewPanel = null;

		while (this.disposables.length) {
			const x = this.disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}

	protected async initHtmlContent() {
		let indexHtml = await fsextra.readFile(path.join(this.mediaPath, this.htmlFileName), "utf8");
		if (indexHtml) {
			// Local path to main script run in the webview
			const scriptPathOnDisk = vscode.Uri.file(path.join(this.mediaPath, path.sep));
			const scriptUri = this.webViewPanel.webview.asWebviewUri(scriptPathOnDisk);

			// TODO: very fragile: assuming double quotes and src is first attribute
			// specifically, doesn't work when building vue for development (vue-cli-service build --mode development)
			indexHtml = indexHtml.replace(/<link href=/g, `<link href=${scriptUri.toString()}`);
			indexHtml = indexHtml.replace(/<script src=/g, `<script src=${scriptUri.toString()}`);
			indexHtml = indexHtml.replace(/<img src=/g, `<img src=${scriptUri.toString()}`);
		}
		this.webViewPanel.webview.html = indexHtml;
	}
}
