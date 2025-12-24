export interface Plan {
    restatement: string;
    todos: {
        title: string;
        details: string;
        acceptanceCriteria: string[];
        status?: 'pending' | 'completed' | 'failed';
    }[];
}

export interface AgentState {
    repoRoot: string;
    userTask: string;
    allFiles: string[];
    selectedFiles: string[];
    fileContents: Map<string, string>;
    plan?: Plan;
    history: any[]; // Chat messages
    results: any;
    clientConfig: {
        baseUrl?: string;
        model: string;
        verbose?: boolean;
        allowedCommands?: string[];
    };
    config?: {
        supervisorInterval?: number;
        maxContextHistory?: number;
        summarizationThreshold?: number;
    };
}

