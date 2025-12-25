import { useState, useEffect, useCallback } from 'react';

export interface AgentMessage {
    id: string;
    type: 'message' | 'tool_call' | 'tool_result' | 'log' | 'user' | 'final' | 'error';
    summary: string;
    content: string;
    nodeName: string;
    timestamp: Date;
    tool?: string;
    args?: any;
    result?: any;
    diff?: string;
}

export interface AgentConfig {
    repoRoot: string;
    userTask: string;
    model: string;
    baseUrl: string;
    allowedCommands?: string[];
}

export interface Plan {
    restatement: string;
    todos: {
        title: string;
        details: string;
        status: 'pending' | 'completed';
        acceptanceCriteria: string[];
    }[];
}

export interface CommandApproval {
    command: string;
    commandType: string;
    cwd: string;
}

export interface FileDiff {
    filePath: string;
    diff: string;
    timestamp: Date;
}

export interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

export interface TokenUsageState {
    step: TokenUsage | null;
    cumulative: TokenUsage;
    currentPromptTokens: number;  // Current message size in tokens
    contextLimit: number;
    contextMessages?: Array<{ role: string; contentPreview?: string }>;  // Messages for viewer
}

interface UseAgentEventsReturn {
    messages: AgentMessage[];
    currentNode: string | null;
    completedNodes: string[];
    pipelineNodes: string[];
    isRunning: boolean;
    isPaused: boolean;
    plan: Plan | null;
    pendingQuery: { query: string; options?: any } | null;
    pendingCommand: CommandApproval | null;
    fileDiffs: FileDiff[];
    tokenUsage: TokenUsageState | null;
    startAgent: (config: AgentConfig) => Promise<void>;
    sendUserInput: (input: string) => void;
    pauseAgent: () => void;
    resumeAgent: (guidance?: string) => void;
    allowCommandType: (type: string) => void;
    allowExactCommand: (command: string) => void;
    approveCommand: (action: 'allow_once' | 'allow_type' | 'allow_exact' | 'reject') => void;
}

export function useAgentEvents(): UseAgentEventsReturn {
    const [messages, setMessages] = useState<AgentMessage[]>([]);
    const [currentNode, setCurrentNode] = useState<string | null>(null);
    const [completedNodes, setCompletedNodes] = useState<string[]>([]);
    const [pipelineNodes, setPipelineNodes] = useState<string[]>([]);
    const [isRunning, setIsRunning] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [plan, setPlan] = useState<Plan | null>(null);
    const [pendingQuery, setPendingQuery] = useState<{ query: string; options?: any } | null>(null);
    const [pendingCommand, setPendingCommand] = useState<CommandApproval | null>(null);
    const [fileDiffs, setFileDiffs] = useState<FileDiff[]>([]);
    const [tokenUsage, setTokenUsage] = useState<TokenUsageState | null>(null);

    // Generate unique ID
    const genId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Truncate text for summary
    const truncate = (text: string, maxLen: number = 80): string => {
        if (text.length <= maxLen) return text;
        return text.substring(0, maxLen) + '...';
    };

    useEffect(() => {
        // Get initial pipeline structure
        window.electronAPI.getPipelineStructure().then((structure) => {
            setPipelineNodes(structure.nodes);
        });

        // Subscribe to agent events
        const unsubscribe = window.electronAPI.onAgentEvent((event) => {
            const { type, data } = event;

            switch (type) {
                case 'pipeline:start':
                    setIsRunning(true);
                    setIsPaused(false);
                    setMessages([]);
                    setCompletedNodes([]);
                    setCurrentNode(null);
                    setPlan(null);
                    setFileDiffs([]);
                    setTokenUsage(null);
                    if (data.nodes) {
                        setPipelineNodes(data.nodes);
                    }
                    break;

                case 'pipeline:end':
                    setIsRunning(false);
                    setIsPaused(false);
                    setCurrentNode(null);
                    break;

                case 'pipeline:error':
                    setIsRunning(false);
                    setMessages(prev => [...prev, {
                        id: genId(),
                        type: 'error',
                        summary: `Error in ${data.nodeName || 'pipeline'}`,
                        content: data.error?.message || JSON.stringify(data),
                        nodeName: data.nodeName || currentNode || '',
                        timestamp: new Date()
                    }]);
                    break;

                case 'node:enter':
                    setCurrentNode(data.nodeName);
                    break;

                case 'node:exit':
                    setCompletedNodes(prev => {
                        if (!prev.includes(data.nodeName)) {
                            return [...prev, data.nodeName];
                        }
                        return prev;
                    });
                    break;

                case 'plan:extracted':
                    setPlan(data.plan);
                    break;

                case 'plan:updated':
                    setPlan(data.plan);
                    break;

                case 'agent:message':
                    setMessages(prev => [...prev, {
                        id: genId(),
                        type: 'message',
                        summary: truncate(data.text),
                        content: data.text,
                        nodeName: currentNode || 'ExecutePlan',
                        timestamp: new Date()
                    }]);
                    break;

                case 'agent:tool_call':
                    setMessages(prev => [...prev, {
                        id: genId(),
                        type: 'tool_call',
                        summary: `${data.tool}(...)`,
                        content: JSON.stringify(data.args, null, 2),
                        nodeName: currentNode || 'ExecutePlan',
                        timestamp: new Date(),
                        tool: data.tool,
                        args: data.args
                    }]);
                    break;

                case 'agent:tool_result':
                    // Check if result has a diff
                    const resultDiff = data.result?.diff;
                    if (resultDiff && data.args?.path) {
                        setFileDiffs(prev => [...prev, {
                            filePath: data.args.path,
                            diff: resultDiff,
                            timestamp: new Date()
                        }]);
                    }

                    setMessages(prev => [...prev, {
                        id: genId(),
                        type: 'tool_result',
                        summary: `Result: ${truncate(JSON.stringify(data.result), 60)}`,
                        content: JSON.stringify(data.result, null, 2),
                        nodeName: currentNode || 'ExecutePlan',
                        timestamp: new Date(),
                        tool: data.tool,
                        result: data.result,
                        diff: resultDiff
                    }]);
                    break;

                case 'agent:final':
                    setMessages(prev => [...prev, {
                        id: genId(),
                        type: 'final',
                        summary: `✓ ${data.criteriaStatus}: ${truncate(data.text, 60)}`,
                        content: data.text,
                        nodeName: currentNode || 'ExecutePlan',
                        timestamp: new Date()
                    }]);
                    break;

                case 'agent:command_approval':
                    setPendingCommand({
                        command: data.command,
                        commandType: data.commandType,
                        cwd: data.cwd
                    });
                    break;

                case 'agent:paused':
                    setIsPaused(true);
                    break;

                case 'agent:resumed':
                    setIsPaused(false);
                    break;

                case 'agent:token_usage':
                    setTokenUsage({
                        step: data.step,
                        cumulative: data.cumulative,
                        currentPromptTokens: data.currentPromptTokens || data.step?.promptTokens || 0,
                        contextLimit: data.contextLimit
                    });
                    break;

                case 'agent:context_summarized':
                    // Update token usage with messages for viewer
                    setTokenUsage(prev => prev ? {
                        ...prev,
                        contextMessages: data.messages
                    } : null);
                    break;

                case 'log':
                    setMessages(prev => [...prev, {
                        id: genId(),
                        type: 'log',
                        summary: truncate(data.message),
                        content: data.message,
                        nodeName: currentNode || '',
                        timestamp: new Date()
                    }]);
                    break;

                case 'ask_user':
                    // Check if this is a command approval (has command info)
                    if (data.options?.command) {
                        setPendingCommand({
                            command: data.options.command,
                            commandType: data.options.commandType,
                            cwd: data.options.cwd
                        });
                    } else {
                        setPendingQuery({ query: data.query, options: data.options });
                    }
                    break;

                case 'error':
                    setMessages(prev => [...prev, {
                        id: genId(),
                        type: 'error',
                        summary: `Error: ${truncate(data.message)}`,
                        content: data.message,
                        nodeName: currentNode || '',
                        timestamp: new Date()
                    }]);
                    break;
            }
        });

        return unsubscribe;
    }, [currentNode]);

    const startAgent = useCallback(async (config: AgentConfig) => {
        setIsRunning(true);
        setMessages([]);
        setCompletedNodes([]);
        setCurrentNode(null);
        setPendingQuery(null);
        setPendingCommand(null);
        setPlan(null);
        setFileDiffs([]);

        try {
            await window.electronAPI.startAgent(config);
        } catch (error: any) {
            setMessages(prev => [...prev, {
                id: genId(),
                type: 'error',
                summary: 'Failed to start agent',
                content: error.message,
                nodeName: '',
                timestamp: new Date()
            }]);
        } finally {
            setIsRunning(false);
        }
    }, []);

    const sendUserInput = useCallback((input: string) => {
        window.electronAPI.sendUserInput(input);
        setPendingQuery(null);
        setPendingCommand(null);

        // Add user message to chat
        setMessages(prev => [...prev, {
            id: genId(),
            type: 'user',
            summary: truncate(input),
            content: input,
            nodeName: currentNode || '',
            timestamp: new Date()
        }]);
    }, [currentNode]);

    const pauseAgent = useCallback(() => {
        window.electronAPI.pauseAgent();
    }, []);

    const resumeAgent = useCallback((guidance?: string) => {
        window.electronAPI.resumeAgent(guidance);
        if (guidance) {
            setMessages(prev => [...prev, {
                id: genId(),
                type: 'user',
                summary: `Guidance: ${truncate(guidance)}`,
                content: guidance,
                nodeName: currentNode || '',
                timestamp: new Date()
            }]);
        }
    }, [currentNode]);

    const allowCommandType = useCallback((type: string) => {
        window.electronAPI.allowCommandType(type);
    }, []);

    const allowExactCommand = useCallback((command: string) => {
        window.electronAPI.allowExactCommand(command);
    }, []);

    const approveCommand = useCallback((action: 'allow_once' | 'allow_type' | 'allow_exact' | 'reject') => {
        if (!pendingCommand) return;

        if (action === 'allow_type') {
            window.electronAPI.allowCommandType(pendingCommand.commandType);
        } else if (action === 'allow_exact') {
            window.electronAPI.allowExactCommand(pendingCommand.command);
        }

        window.electronAPI.sendUserInput(action);
        setPendingCommand(null);
    }, [pendingCommand]);

    return {
        messages,
        currentNode,
        completedNodes,
        pipelineNodes,
        isRunning,
        isPaused,
        plan,
        pendingQuery,
        pendingCommand,
        fileDiffs,
        tokenUsage,
        startAgent,
        sendUserInput,
        pauseAgent,
        resumeAgent,
        allowCommandType,
        allowExactCommand,
        approveCommand
    };
}
