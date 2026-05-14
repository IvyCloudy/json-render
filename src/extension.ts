import * as vscode from 'vscode';
import { PreviewPanel } from './previewPanel';
import { startMockServer, MockServerInfo } from './testing/mockServer';

const SUPPORTED = new Set(['json', 'jsonc', 'jsonl', 'ndjson', 'yaml']);

let mock: MockServerInfo | null = null;
let mockOutput: vscode.OutputChannel | null = null;

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('jsonRender.preview', async (uri?: vscode.Uri) => {
    let targetUri = uri;
    if (!targetUri) {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('Data Render: no active file.');
        return;
      }
      targetUri = editor.document.uri;
    }

    try {
      const doc = await vscode.workspace.openTextDocument(targetUri);
      const isJsonlExt = /\.(jsonl|ndjson)$/i.test(doc.fileName);
      const isYamlExt = /\.(yaml|yml)$/i.test(doc.fileName);
      if (!SUPPORTED.has(doc.languageId) && !isJsonlExt && !isYamlExt) {
        vscode.window.showWarningMessage('Data Render: only JSON / JSONC / JSONL / NDJSON / YAML files are supported.');
        return;
      }
      PreviewPanel.createOrShow(context, doc);
    } catch (e: any) {
      vscode.window.showErrorMessage(`Data Render: failed to open file - ${e?.message ?? e}`);
    }
  });

  context.subscriptions.push(disposable);

  // 按配置启动/停止 mock server
  void maybeToggleMockServer();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('jsonRender.enableMockServer')) {
        void maybeToggleMockServer();
      }
    }),
    // 显式命令：方便在非调试模式下临时启动
    vscode.commands.registerCommand('jsonRender.startMockServer', async () => {
      if (mock) {
        vscode.window.showInformationMessage(`Mock server already running at ${mock.baseUrl}`);
        return;
      }
      mockOutput = mockOutput ?? vscode.window.createOutputChannel('Data Render · Mock Server');
      mock = await startMockServer(mockOutput);
      if (mock) {
        mockOutput.show(true);
        vscode.window.showInformationMessage(`Mock server started at ${mock.baseUrl}`);
      } else {
        vscode.window.showErrorMessage('Failed to start mock server');
      }
    }),
    vscode.commands.registerCommand('jsonRender.stopMockServer', () => {
      if (!mock) {
        vscode.window.showInformationMessage('Mock server is not running');
        return;
      }
      mock.dispose();
      mock = null;
      vscode.window.showInformationMessage('Mock server stopped');
    }),
  );
}

async function maybeToggleMockServer() {
  const enabled = vscode.workspace.getConfiguration('jsonRender').get<boolean>('enableMockServer', false);
  if (enabled && !mock) {
    mockOutput = mockOutput ?? vscode.window.createOutputChannel('Data Render · Mock Server');
    mock = await startMockServer(mockOutput);
  } else if (!enabled && mock) {
    mock.dispose();
    mock = null;
  }
}

export function deactivate() {
  PreviewPanel.disposeAll();
  if (mock) { mock.dispose(); mock = null; }
}