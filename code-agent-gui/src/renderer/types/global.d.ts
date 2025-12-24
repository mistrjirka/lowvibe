// Global type declarations for the renderer process

export interface ModelInfo {
    id: string;
    type?: string;
    maxContextLength?: number;
    loaded?: boolean;
    architecture?: string;
    quantization?: string;
}

interface ElectronAPI {
    getPipelineStructure: () => Promise<{ nodes: string[] }>;
    getCurrentPlan: () => Promise<any>;
    listModels: (baseUrl?: string) => Promise<ModelInfo[]>;
    getModelInfo: (baseUrl?: string, modelId?: string) => Promise<ModelInfo | null>;
    getLoadedModel: (baseUrl?: string) => Promise<ModelInfo | null>;
    startAgent: (config: {
        repoRoot: string;
        userTask: string;
        model: string;
        baseUrl: string;
        allowedCommands?: string[];
    }) => Promise<void>;
    sendUserInput: (input: string) => void;
    cancelAgent: () => void;
    pauseAgent: () => void;
    resumeAgent: (guidance?: string) => void;
    allowCommandType: (type: string) => void;
    allowExactCommand: (command: string) => void;
    onAgentEvent: (callback: (event: { type: string; data: any }) => void) => () => void;
    selectDirectory: () => Promise<string | null>;
}

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}

export { };

