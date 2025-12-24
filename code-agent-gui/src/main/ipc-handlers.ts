import { ipcMain, BrowserWindow, dialog } from 'electron';
import { AgentRunner } from './AgentRunner';

export function setupIpcHandlers(mainWindow: BrowserWindow, agentRunner: AgentRunner) {
    // Get pipeline structure for dynamic graph rendering
    ipcMain.handle('get-pipeline-structure', () => {
        return agentRunner.getPipelineStructure();
    });

    // Get current plan
    ipcMain.handle('get-current-plan', () => {
        return agentRunner.getCurrentPlan();
    });

    // List available models from LM Studio
    ipcMain.handle('list-models', async (_: Electron.IpcMainInvokeEvent, baseUrl?: string) => {
        return await agentRunner.listModels(baseUrl);
    });

    // Get model info (including context length)
    ipcMain.handle('get-model-info', async (_: Electron.IpcMainInvokeEvent, baseUrl?: string, modelId?: string) => {
        return await agentRunner.getModelInfo(baseUrl, modelId);
    });

    // Get currently loaded model
    ipcMain.handle('get-loaded-model', async (_: Electron.IpcMainInvokeEvent, baseUrl?: string) => {
        return await agentRunner.getLoadedModel(baseUrl);
    });

    // Start agent run
    ipcMain.handle('start-agent', async (_: Electron.IpcMainInvokeEvent, config: any) => {
        try {
            await agentRunner.run(config);
        } catch (error: any) {
            mainWindow.webContents.send('agent-event', {
                type: 'error',
                data: { message: error.message }
            });
        }
    });

    // Provide user input (for approvals, feedback)
    ipcMain.on('user-input', (_: Electron.IpcMainEvent, input: string) => {
        agentRunner.provideUserInput(input);
    });

    // Cancel running agent
    ipcMain.on('cancel-agent', () => {
        agentRunner.cancel();
    });

    // Pause agent
    ipcMain.on('pause-agent', () => {
        agentRunner.pause();
    });

    // Resume agent with optional guidance
    ipcMain.on('resume-agent', (_: Electron.IpcMainEvent, guidance?: string) => {
        agentRunner.resume(guidance);
    });

    // Allow command type (e.g., "python", "npm")
    ipcMain.on('allow-command-type', (_: Electron.IpcMainEvent, type: string) => {
        agentRunner.allowCommandType(type);
    });

    // Allow exact command
    ipcMain.on('allow-exact-command', (_: Electron.IpcMainEvent, command: string) => {
        agentRunner.allowExactCommand(command);
    });

    // Directory picker
    ipcMain.handle('select-directory', async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory']
        });
        return result.canceled ? null : result.filePaths[0];
    });

    // Forward all agent events to renderer
    const events = [
        'pipeline:start',
        'pipeline:end',
        'pipeline:error',
        'node:enter',
        'node:exit',
        'agent:message',
        'agent:tool_call',
        'agent:tool_result',
        'agent:final',
        'agent:command_approval',
        'agent:paused',
        'agent:resumed',
        'agent:token_usage',
        'agent:context_summarized',
        'agent:supervisor_check',
        'agent:supervisor_result',
        'agent:supervisor_error',
        'model:info',
        'plan:extracted',
        'plan:updated',
        'permission:type_added',
        'permission:exact_added',
        'log',
        'ask_user',
        'error'
    ];

    for (const event of events) {
        agentRunner.on(event, (data: any) => {
            mainWindow.webContents.send('agent-event', { type: event, data });
        });
    }
}
