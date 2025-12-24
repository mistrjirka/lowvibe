import React, { useState } from 'react';

interface InputBarProps {
    task: string;
    setTask: (task: string) => void;
    isRunning: boolean;
    pendingQuery: { query: string; options?: { multiline?: boolean } } | null;
    config: {
        repoRoot: string;
        model: string;
        baseUrl: string;
    };
    onStart: () => void;
    onUserInput: (input: string) => void;
}

export function InputBar({
    task,
    setTask,
    isRunning,
    pendingQuery,
    config,
    onStart,
    onUserInput
}: InputBarProps) {
    const [userResponse, setUserResponse] = useState('');

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (pendingQuery) {
                onUserInput(userResponse);
                setUserResponse('');
            } else if (!isRunning) {
                onStart();
            }
        }
    };

    const isConfigValid = config.repoRoot && config.model && config.baseUrl;

    // If there's a pending query, show the response input
    if (pendingQuery) {
        return (
            <div className="input-bar">
                <div className="pending-query">
                    <div className="pending-query-label">
                        <span>⏳</span>
                        <span>Agent is waiting for your input</span>
                    </div>
                    <div className="pending-query-text">{pendingQuery.query}</div>
                    <div className="pending-input-row">
                        <input
                            type="text"
                            className="input-field"
                            placeholder="Type your response..."
                            value={userResponse}
                            onChange={(e) => setUserResponse(e.target.value)}
                            onKeyDown={handleKeyDown}
                            autoFocus
                        />
                        <button
                            className="btn btn-primary"
                            onClick={() => {
                                onUserInput(userResponse);
                                setUserResponse('');
                            }}
                        >
                            Send
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Normal input for starting new task
    return (
        <div className="input-bar">
            <div className="input-bar-inner">
                <textarea
                    className="input-field"
                    placeholder={isRunning ? 'Agent is running...' : 'Describe your task...'}
                    value={task}
                    onChange={(e) => setTask(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={isRunning}
                />
                <button
                    className="btn btn-primary"
                    onClick={onStart}
                    disabled={isRunning || !task.trim() || !isConfigValid}
                >
                    {isRunning ? (
                        <>
                            <span className="spinner">⟳</span>
                            Running
                        </>
                    ) : (
                        <>
                            ▶️ Start
                        </>
                    )}
                </button>
            </div>
            {!isConfigValid && !isRunning && (
                <div className="config-warning">
                    ⚠️ Please configure repository root and model above
                </div>
            )}
        </div>
    );
}
