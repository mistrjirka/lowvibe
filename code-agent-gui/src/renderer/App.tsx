import { useState } from 'react';
import { ChatPanel } from './components/ChatPanel/ChatPanel';
import { GraphPanel } from './components/GraphPanel/GraphPanel';
import { DiffViewer } from './components/DiffViewer/DiffViewer';
import { MultiAgentPanel } from './components/MultiAgentPanel/MultiAgentPanel';
import { useAgentEvents, AgentMessage, FileDiff } from './hooks/useAgentEvents';

export function App() {
    const {
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
        approveCommand
    } = useAgentEvents();

    const [config, setConfig] = useState({
        repoRoot: '',
        model: '',
        baseUrl: 'http://localhost:1234/v1',
        maxContextHistory: 10,
        summarizationThreshold: 0.65,
        supervisorInterval: 5,
        useMultiAgent: false
    });

    const [viewingDiff, setViewingDiff] = useState<FileDiff | null>(null);

    const getMessagesForNode = (nodeName: string): AgentMessage[] => {
        return messages.filter(m => m.nodeName === nodeName);
    };

    const isMultiAgentMode = multiAgent.mode === 'multi';

    return (
        <div className={`app-container ${isMultiAgentMode ? 'multi-agent-mode' : ''}`}>
            {isMultiAgentMode ? (
                <>
                    <div className="panel multi-agent-main">
                        <MultiAgentPanel multiAgent={multiAgent} />
                    </div>
                    <div className="panel chat-panel-side">
                        <ChatPanel
                            messages={messages}
                            isRunning={isRunning}
                            isPaused={isPaused}
                            plan={plan}
                            pendingQuery={pendingQuery}
                            pendingCommand={pendingCommand}
                            fileDiffs={fileDiffs}
                            tokenUsage={tokenUsage}
                            config={config}
                            onConfigChange={setConfig}
                            onStartAgent={(task) => startAgent({ ...config, userTask: task, useMultiAgent: config.useMultiAgent })}
                            onUserInput={sendUserInput}
                            onPause={pauseAgent}
                            onResume={resumeAgent}
                            onApproveCommand={approveCommand}
                            onViewDiff={setViewingDiff}
                        />
                    </div>
                </>
            ) : (
                <>
                    <div className="panel chat-panel">
                        <ChatPanel
                            messages={messages}
                            isRunning={isRunning}
                            isPaused={isPaused}
                            plan={plan}
                            pendingQuery={pendingQuery}
                            pendingCommand={pendingCommand}
                            fileDiffs={fileDiffs}
                            tokenUsage={tokenUsage}
                            config={config}
                            onConfigChange={setConfig}
                            onStartAgent={(task) => startAgent({ ...config, userTask: task, useMultiAgent: config.useMultiAgent })}
                            onUserInput={sendUserInput}
                            onPause={pauseAgent}
                            onResume={resumeAgent}
                            onApproveCommand={approveCommand}
                            onViewDiff={setViewingDiff}
                        />
                    </div>
                    <div className="panel graph-panel">
                        <GraphPanel
                            nodes={pipelineNodes}
                            currentNode={currentNode}
                            completedNodes={completedNodes}
                            getMessagesForNode={getMessagesForNode}
                        />
                    </div>
                </>
            )}

            {viewingDiff && (
                <DiffViewer
                    diff={viewingDiff.diff}
                    filePath={viewingDiff.filePath}
                    onClose={() => setViewingDiff(null)}
                />
            )}
        </div>
    );
}
