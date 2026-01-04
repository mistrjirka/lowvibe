import { AgentMessage, MultiAgentState, ImplementTask } from '../../hooks/useAgentEvents';
import './MultiAgentPanel.css';

interface AgentColumnProps {
    title: string;
    messages: AgentMessage[];
    isActive: boolean;
    currentTask?: { index: number; total: number; task: ImplementTask } | null;
}

function AgentColumn({ title, messages, isActive, currentTask }: AgentColumnProps) {
    return (
        <div className={`agent-column ${isActive ? 'active' : ''}`}>
            <div className="agent-column-header">
                <h3>{title}</h3>
                {isActive && <span className="active-indicator">●</span>}
            </div>

            {currentTask && title === 'Implementer' && (
                <div className="current-task">
                    <div className="task-badge">Task {currentTask.index}/{currentTask.total}</div>
                    <div className="task-type">{currentTask.task.type}</div>
                    <div className="task-file">{currentTask.task.file}</div>
                    <div className="task-description">{currentTask.task.task_description}</div>
                </div>
            )}

            <div className="agent-messages">
                {messages.map(msg => (
                    <div key={msg.id} className={`agent-message ${msg.type}`}>
                        <div className="message-header">
                            <span className="message-type">{msg.type}</span>
                            <span className="message-time">
                                {msg.timestamp.toLocaleTimeString()}
                            </span>
                        </div>
                        <div className="message-summary">{msg.summary}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}

interface MultiAgentPanelProps {
    multiAgent: MultiAgentState;
}

export function MultiAgentPanel({ multiAgent }: MultiAgentPanelProps) {
    if (multiAgent.mode !== 'multi') {
        return null; // Don't show in single-agent mode
    }

    return (
        <div className="multi-agent-panel">
            <AgentColumn
                title="Thinker"
                messages={multiAgent.thinkerMessages}
                isActive={multiAgent.activeAgent === 'thinker'}
            />
            <AgentColumn
                title="Implementer"
                messages={multiAgent.implementerMessages}
                isActive={multiAgent.activeAgent === 'implementer'}
                currentTask={multiAgent.currentTask}
            />
            <AgentColumn
                title="Tester"
                messages={multiAgent.testerMessages}
                isActive={multiAgent.activeAgent === 'tester'}
            />
        </div>
    );
}
