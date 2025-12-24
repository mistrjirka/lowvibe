import { useState } from 'react';
import { AgentMessage } from '../../hooks/useAgentEvents';
import './MessageItem.css';

interface MessageItemProps {
    message: AgentMessage;
    onViewDiff?: () => void;
}

export function MessageItem({ message, onViewDiff }: MessageItemProps) {
    // Text messages expanded by default, tool calls/results collapsed
    const defaultExpanded = message.type === 'message' ||
        message.type === 'final' ||
        message.type === 'user' ||
        message.type === 'error';
    const [expanded, setExpanded] = useState(defaultExpanded);

    const getIcon = (): string => {
        switch (message.type) {
            case 'tool_call': return '🔧';
            case 'tool_result': return '📤';
            case 'user': return '👤';
            case 'log': return '📝';
            case 'final': return '✅';
            case 'error': return '❌';
            default: return '💬';
        }
    };

    const getTypeClass = (): string => {
        return `message-${message.type}`;
    };

    const formatTimestamp = (date: Date): string => {
        return date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    };

    return (
        <div className={`message-item ${getTypeClass()} ${expanded ? 'expanded' : ''}`}>
            <div className="message-header" onClick={() => setExpanded(!expanded)}>
                <span className="message-icon">{getIcon()}</span>
                <span className="message-summary">{message.summary}</span>
                {onViewDiff && (
                    <button
                        className="diff-btn"
                        onClick={(e) => { e.stopPropagation(); onViewDiff(); }}
                        title="View file changes"
                    >
                        📝 Diff
                    </button>
                )}
                <span className="message-time">{formatTimestamp(message.timestamp)}</span>
                <span className="message-chevron">{expanded ? '▼' : '▶'}</span>
            </div>
            {expanded && (
                <div className="message-content">
                    {message.tool && (
                        <div className="message-tool-badge">
                            Tool: <strong>{message.tool}</strong>
                        </div>
                    )}
                    <pre>{message.content}</pre>
                </div>
            )}
        </div>
    );
}
