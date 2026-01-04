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
    stepCount?: number;
}

export interface AgentConfig {
    repoRoot: string;
    userTask: string;
    model: string;
    baseUrl: string;
    allowedCommands?: string[];
    useMultiAgent?: boolean;  // NEW: Toggle between single and multi-agent mode
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
    currentPromptTokens: number;
    contextLimit: number;
    contextMessages?: Array<{ role: string; contentPreview?: string }>;
}

// NEW: Multi-agent specific types
export interface ImplementTask {
    type: 'create_file' | 'edit_file' | 'delete_file';
    task_description: string;
    code: string;
    file: string;
}

export interface MultiAgentState {
    mode: 'single' | 'multi';
    activeAgent: 'thinker' | 'implementer' | 'tester' | 'finisher' | null;
    thinkerMessages: AgentMessage[];
    implementerMessages: AgentMessage[];
    testerMessages: AgentMessage[];
    currentTask: { index: number; total: number; task: ImplementTask } | null;
    finisherFeedback: string | null;
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
    multiAgent: MultiAgentState;  // NEW
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

    // NEW: Multi-agent state
    const [multiAgent, setMultiAgent] = useState<MultiAgentState>({
        mode: 'single',
        activeAgent: null,
        thinkerMessages: [],
        implementerMessages: [],
        testerMessages: [],
        currentTask: null,
        finisherFeedback: null
    });

    const genId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const truncate = (text: string, maxLen: number = 80): string => {
        if (text.length <= maxLen) return text;
        return text.substring(0, maxLen) + '...';
    };

    useEffect(() => {
        window.electronAPI.getPipelineStructure().then((structure) => {
            setPipelineNodes(structure.nodes);
        });

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
                    // Reset multi-agent state
                    setMultiAgent(prev => ({
                        ...prev,
                        mode: data.multiAgent ? 'multi' : 'single',
                        activeAgent: null,
                        thinkerMessages: [],
                        implementerMessages: [],
                        testerMessages: [],
                        currentTask: null,
                        finisherFeedback: null
                    }));
                    if (data.nodes) {
                        setPipelineNodes(data.nodes);
                    }
                    break;

                case 'pipeline:end':
                    setIsRunning(false);
                    setIsPaused(false);
                    setCurrentNode(null);
                    setMultiAgent(prev => ({ ...prev, activeAgent: null }));
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

                // === MULTI-AGENT EVENTS ===
                case 'orchestrator:start':
                    setMultiAgent(prev => ({
                        ...prev,
                        mode: 'multi',
                        thinkerMessages: [],
                        implementerMessages: [],
                        testerMessages: [],
                        currentTask: null,
                        finisherFeedback: null
                    }));
                    break;

                case 'thinker:step':
                    setMultiAgent(prev => {
                        const newMsg: AgentMessage = {
                            id: genId(),
                            type: data.response.type === 'message' ? 'message' :
                                data.response.type === 'tool_call' ? 'tool_call' :
                                    data.response.type === 'implement' ? 'message' : 'log',
                            summary: data.response.type === 'message' ? truncate(data.response.text) :
                                data.response.type === 'tool_call' ? `${data.response.tool}(...)` :
                                    data.response.type === 'implement' ? `Dispatching ${data.response.payload.tasks.length} tasks` :
                                        'Step',
                            content: JSON.stringify(data.response, null, 2),
                            nodeName: 'Thinker',
                            timestamp: new Date()
                        };
                        return {
                            ...prev,
                            activeAgent: 'thinker',
                            thinkerMessages: [...prev.thinkerMessages, newMsg]
                        };
                    });
                    break;

                case 'implementer:step':
                    setMultiAgent(prev => {
                        const newMsg: AgentMessage = {
                            id: genId(),
                            type: data.response.type === 'message' ? 'message' :
                                data.response.type === 'tool_call' ? 'tool_call' :
                                    data.response.type === 'done' ? 'final' :
                                        data.response.type === 'error' ? 'error' : 'log',
                            summary: data.response.type === 'message' ? truncate(data.response.text) :
                                data.response.type === 'tool_call' ? `${data.response.tool}(...)` :
                                    data.response.type === 'done' ? `Done: ${truncate(data.response.summary)}` :
                                        data.response.type === 'error' ? `Error: ${truncate(data.response.reason)}` : 'Step',
                            content: JSON.stringify(data.response, null, 2),
                            nodeName: 'Implementer',
                            timestamp: new Date()
                        };
                        return {
                            ...prev,
                            activeAgent: 'implementer',
                            implementerMessages: [...prev.implementerMessages, newMsg]
                        };
                    });
                    break;

                case 'implementer:task_start':
                    setMultiAgent(prev => ({
                        ...prev,
                        currentTask: {
                            index: data.index,
                            total: data.total,
                            task: data.task
                        },
                        implementerMessages: []  // Clear for new task
                    }));
                    break;

                case 'tester:step':
                    setMultiAgent(prev => {
                        const newMsg: AgentMessage = {
                            id: genId(),
                            type: data.response.type === 'message' ? 'message' :
                                data.response.type === 'tool_call' ? 'tool_call' :
                                    data.response.type === 'result' ? 'final' : 'log',
                            summary: data.response.type === 'message' ? truncate(data.response.text) :
                                data.response.type === 'tool_call' ? `${data.response.tool}(...)` :
                                    data.response.type === 'result' ?
                                        (data.response.payload.successfully_implemented ? '✓ Success' : '✗ Failed') : 'Step',
                            content: JSON.stringify(data.response, null, 2),
                            nodeName: 'Tester',
                            timestamp: new Date()
                        };
                        return {
                            ...prev,
                            activeAgent: 'tester',
                            testerMessages: [...prev.testerMessages, newMsg]
                        };
                    });
                    break;

                case 'finisher:feedback':
                    setMultiAgent(prev => {
                        // Add finisher feedback to thinker messages
                        const feedbackMsg: AgentMessage = {
                            id: genId(),
                            type: 'message',
                            summary: `Finisher: ${truncate(data.overall)}`,
                            content: data.overall,
                            nodeName: 'Finisher',
                            timestamp: new Date()
                        };
                        return {
                            ...prev,
                            activeAgent: 'thinker',  // Return to thinker
                            finisherFeedback: data.overall,
                            thinkerMessages: [...prev.thinkerMessages, feedbackMsg],
                            testerMessages: []  // Clear tester for next round
                        };
                    });
                    break;

                case 'thinker:final':
                    setMultiAgent(prev => {
                        const finalMsg: AgentMessage = {
                            id: genId(),
                            type: 'final',
                            summary: `✓ ${data.criteriaStatus}: ${truncate(data.text)}`,
                            content: data.text,
                            nodeName: 'Thinker',
                            timestamp: new Date()
                        };
                        return {
                            ...prev,
                            thinkerMessages: [...prev.thinkerMessages, finalMsg]
                        };
                    });
                    break;
                // === END MULTI-AGENT EVENTS ===

                case 'agent:message':
                    if (data.text.startsWith('\n[Agent Step') || data.text.startsWith('[Agent Step')) {
                        return;
                    }
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
                        args: data.args,
                        result: undefined,
                        diff: undefined,
                        stepCount: data.stepCount
                    }]);
                    break;

                case 'agent:tool_result':
                    const resultDiff = data.result?.diff;
                    if (resultDiff && data.args?.path) {
                        setFileDiffs(prev => [...prev, {
                            filePath: data.args.path,
                            diff: resultDiff,
                            timestamp: new Date()
                        }]);
                    }

                    setMessages(prev => {
                        const matchIndex = prev.findIndex(
                            msg => msg.type === 'tool_call' &&
                                msg.stepCount === data.stepCount &&
                                msg.tool === data.tool
                        );

                        if (matchIndex === -1) {
                            console.warn('[useAgentEvents] No matching tool_call for result:', data.stepCount, data.tool);
                            return [...prev, {
                                id: genId(),
                                type: 'tool_result',
                                summary: `Result: ${truncate(JSON.stringify(data.result), 60)}`,
                                content: JSON.stringify(data.result, null, 2),
                                nodeName: currentNode || 'ExecutePlan',
                                timestamp: new Date(),
                                tool: data.tool,
                                result: data.result,
                                diff: resultDiff,
                                stepCount: data.stepCount
                            }];
                        }

                        const updated = [...prev];
                        const msg = updated[matchIndex];
                        const success = data.result?.success !== false && !data.result?.error;
                        updated[matchIndex] = {
                            ...msg,
                            summary: `${msg.tool}: ${success ? '✓' : '✗'}`,
                            result: data.result,
                            diff: resultDiff
                        };
                        return updated;
                    });
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
                    setTokenUsage(prev => prev ? {
                        ...prev,
                        contextMessages: data.messages
                    } : null);
                    break;

                case 'log':
                    if (data.message.startsWith('[Agent Tool]')) {
                        return;
                    }
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
        multiAgent,
        startAgent,
        sendUserInput,
        pauseAgent,
        resumeAgent,
        allowCommandType,
        allowExactCommand,
        approveCommand
    };
}
