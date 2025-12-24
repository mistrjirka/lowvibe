import { contextBridge, ipcRenderer } from 'electron';

// Type definitions for model info
export interface ModelInfo {
    id: string;
    type?: string;
    maxContextLength?: number;
    loaded?: boolean;
    architecture?: string;
    quantization?: string;
}

// Type definitions for the exposed API
export interface ElectronAPI {
    getPipelineStructure: () => Promise<{ nodes: string[] }>;
    getCurrentPlan: () => Promise<any>;
    listModels: (baseUrl?: string) => Promise<ModelInfo[]>;
    getModelInfo: (baseUrl?: string, modelId?: string) => Promise<ModelInfo | null>;
    getLoadedModel: (baseUrl?: string) => Promise<ModelInfo | null>;
    startAgent: (config: AgentConfig) => Promise<void>;
    sendUserInput: (input: string) => void;
    cancelAgent: () => void;
    pauseAgent: () => void;
    resumeAgent: (guidance?: string) => void;
    allowCommandType: (type: string) => void;
    allowExactCommand: (command: string) => void;
    onAgentEvent: (callback: (event: AgentEvent) => void) => () => void;
    selectDirectory: () => Promise<string | null>;
}

export interface AgentConfig {
    repoRoot: string;
    userTask: string;
    model: string;
    baseUrl: string;
    allowedCommands?: string[];
}

export interface AgentEvent {
    type: string;
    data: any;
}

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    // Get pipeline structure for graph rendering
    getPipelineStructure: (): Promise<{ nodes: string[] }> => {
        return ipcRenderer.invoke('get-pipeline-structure');
    },

    // Get current plan
    getCurrentPlan: (): Promise<any> => {
        return ipcRenderer.invoke('get-current-plan');
    },

    // List available models from LM Studio
    listModels: (baseUrl?: string): Promise<ModelInfo[]> => {
        return ipcRenderer.invoke('list-models', baseUrl);
    },

    // Get model info (including context length)
    getModelInfo: (baseUrl?: string, modelId?: string): Promise<ModelInfo | null> => {
        return ipcRenderer.invoke('get-model-info', baseUrl, modelId);
    },

    // Get currently loaded model
    getLoadedModel: (baseUrl?: string): Promise<ModelInfo | null> => {
        return ipcRenderer.invoke('get-loaded-model', baseUrl);
    },

    // Start the agent with given config
    startAgent: (config: AgentConfig): Promise<void> => {
        return ipcRenderer.invoke('start-agent', config);
    },

    // Send user input (for approvals, feedback, etc.)
    sendUserInput: (input: string): void => {
        ipcRenderer.send('user-input', input);
    },

    // Cancel the running agent
    cancelAgent: (): void => {
        ipcRenderer.send('cancel-agent');
    },

    // Pause the agent
    pauseAgent: (): void => {
        ipcRenderer.send('pause-agent');
    },

    // Resume the agent with optional guidance
    resumeAgent: (guidance?: string): void => {
        ipcRenderer.send('resume-agent', guidance);
    },

    // Allow a command type (e.g., "python", "npm")
    allowCommandType: (type: string): void => {
        ipcRenderer.send('allow-command-type', type);
    },

    // Allow an exact command
    allowExactCommand: (command: string): void => {
        ipcRenderer.send('allow-exact-command', command);
    },

    // Subscribe to agent events
    onAgentEvent: (callback: (event: AgentEvent) => void): (() => void) => {
        const handler = (_: Electron.IpcRendererEvent, event: AgentEvent) => {
            callback(event);
        };
        ipcRenderer.on('agent-event', handler);

        // Return cleanup function
        return () => {
            ipcRenderer.removeListener('agent-event', handler);
        };
    },

    // Open directory picker
    selectDirectory: (): Promise<string | null> => {
        return ipcRenderer.invoke('select-directory');
    }
} as ElectronAPI);

// Declare the global type
declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}
