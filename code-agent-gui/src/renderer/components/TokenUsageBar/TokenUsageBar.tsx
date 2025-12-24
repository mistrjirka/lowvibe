import { useState } from 'react';
import './TokenUsageBar.css';

interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

interface TokenUsageBarProps {
    stepUsage: TokenUsage | null;
    cumulativeUsage: TokenUsage;
    currentPromptTokens?: number;  // Current message size
    contextLimit: number;
    messages?: Array<{ role: string; contentPreview?: string }>;  // For messages viewer
}

export function TokenUsageBar({
    stepUsage,
    cumulativeUsage,
    currentPromptTokens,
    contextLimit,
    messages
}: TokenUsageBarProps) {
    const [showMessages, setShowMessages] = useState(false);

    // Use currentPromptTokens for context usage (current message size vs limit)
    const contextTokens = currentPromptTokens || stepUsage?.promptTokens || 0;
    const contextPercent = Math.min((contextTokens / contextLimit) * 100, 100);

    // Color coding based on usage
    const getBarColor = (): string => {
        if (contextPercent < 50) return 'var(--success)';
        if (contextPercent < 80) return 'var(--warning)';
        return 'var(--error)';
    };

    const formatNumber = (n: number): string => {
        return n.toLocaleString();
    };

    return (
        <div className="token-usage-bar">
            <div className="usage-header">
                <span className="usage-icon">📊</span>
                <span className="usage-title">Context Usage</span>
                <span className="usage-numbers">
                    <strong>{formatNumber(contextTokens)}</strong>
                    <span className="separator">/</span>
                    <span className="context-limit">{formatNumber(contextLimit)}</span>
                    <span className="usage-percent">({contextPercent.toFixed(1)}%)</span>
                </span>
            </div>

            <div className="usage-progress-container">
                <div
                    className="usage-progress-bar"
                    style={{
                        width: `${contextPercent}%`,
                        backgroundColor: getBarColor()
                    }}
                />
            </div>

            <div className="usage-details">
                <div className="usage-detail">
                    <span className="detail-label">Cumulative:</span>
                    <span className="detail-value">{formatNumber(cumulativeUsage.totalTokens)}</span>
                </div>
                {stepUsage && (
                    <div className="usage-detail step-usage">
                        <span className="detail-label">Last step:</span>
                        <span className="detail-value">+{formatNumber(stepUsage.totalTokens)}</span>
                    </div>
                )}
                {messages && messages.length > 0 && (
                    <button
                        className="messages-toggle-btn"
                        onClick={() => setShowMessages(!showMessages)}
                    >
                        {showMessages ? '▼ Hide' : '▶ Show'} Messages ({messages.length})
                    </button>
                )}
            </div>

            {showMessages && messages && (
                <div className="messages-viewer">
                    {messages.map((msg, i) => (
                        <details key={i} className={`message-item message-${msg.role}`}>
                            <summary>
                                <span className="msg-index">{i + 1}.</span>
                                <span className="msg-role">{msg.role}</span>
                            </summary>
                            <div className="msg-content">
                                {msg.contentPreview || '(empty)'}...
                            </div>
                        </details>
                    ))}
                </div>
            )}
        </div>
    );
}
