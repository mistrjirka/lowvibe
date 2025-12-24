import { useState, useRef, useEffect } from 'react';
import { MessageItem } from './MessageItem';
import { InputBar } from './InputBar';
import { PlanPanel } from '../PlanPanel/PlanPanel';
import { CommandApproval } from '../CommandApproval/CommandApproval';
import { TokenUsageBar } from '../TokenUsageBar/TokenUsageBar';
import { ModelSelector } from '../ModelSelector/ModelSelector';
import { AgentMessage, Plan, CommandApproval as CommandApprovalType, FileDiff, TokenUsageState } from '../../hooks/useAgentEvents';
import './ChatPanel.css';

interface ChatPanelProps {
    messages: AgentMessage[];
    isRunning: boolean;
    isPaused: boolean;
    plan: Plan | null;
    pendingQuery: { query: string; options?: any } | null;
    pendingCommand: CommandApprovalType | null;
    fileDiffs: FileDiff[];
    tokenUsage: TokenUsageState | null;
    config: {
        repoRoot: string;
        model: string;
        baseUrl: string;
        maxContextHistory: number;
        summarizationThreshold: number;
        supervisorInterval: number;
    };
    onConfigChange: (config: {
        repoRoot: string;
        model: string;
        baseUrl: string;
        maxContextHistory: number;
        summarizationThreshold: number;
        supervisorInterval: number;
    }) => void;
    onStartAgent: (task: string) => void;
    onUserInput: (input: string) => void;
    onPause: () => void;
    onResume: (guidance?: string) => void;
    onApproveCommand: (action: 'allow_once' | 'allow_type' | 'allow_exact' | 'reject') => void;
    onViewDiff: (diff: FileDiff) => void;
}

export function ChatPanel({
    messages,
    isRunning,
    isPaused,
    plan,
    pendingQuery,
    pendingCommand,
    fileDiffs,
    tokenUsage,
    config,
    onConfigChange,
    onStartAgent,
    onUserInput,
    onPause,
    onResume,
    onApproveCommand,
    onViewDiff
}: ChatPanelProps) {
    const [task, setTask] = useState('');
    const [showConfig, setShowConfig] = useState(true);
    const [showPlan, setShowPlan] = useState(false);
    const [resumeGuidance, setResumeGuidance] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom when new messages arrive
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Hide config panel once agent starts
    useEffect(() => {
        if (isRunning && showConfig) {
            setShowConfig(false);
        }
    }, [isRunning]);

    // Show plan panel when plan is extracted
    useEffect(() => {
        if (plan && !showPlan) {
            setShowPlan(true);
        }
    }, [plan]);

    const handleStart = () => {
        if (!task.trim() || !config.repoRoot || !config.model) return;
        onStartAgent(task);
        setTask('');
    };

    const handleSelectDirectory = async () => {
        const dir = await window.electronAPI.selectDirectory();
        if (dir) {
            onConfigChange({ ...config, repoRoot: dir });
        }
    };

    const handleResume = () => {
        onResume(resumeGuidance || undefined);
        setResumeGuidance('');
    };

    return (
        <div className="chat-panel-container">
            <div className="panel-header">
                <h2>
                    <span className={`status-dot ${isRunning ? (isPaused ? 'paused' : 'active') : ''}`}></span>
                    Agent Activity
                    {isPaused && <span className="paused-badge">PAUSED</span>}
                </h2>
                <div className="header-actions">
                    {!showConfig && (
                        <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => setShowConfig(true)}
                        >
                            ⚙️ Config
                        </button>
                    )}
                    {isRunning && !isPaused && (
                        <button
                            className="btn btn-warning btn-sm"
                            onClick={onPause}
                        >
                            ⏸ Pause
                        </button>
                    )}
                </div>
            </div>

            {/* Configuration Panel */}
            {showConfig && (
                <div className="config-panel">
                    <div className="config-row">
                        <label>Repository Root</label>
                        <div className="config-input-group">
                            <input
                                type="text"
                                className="input-field"
                                placeholder="/path/to/your/project"
                                value={config.repoRoot}
                                onChange={(e) => onConfigChange({ ...config, repoRoot: e.target.value })}
                            />
                            <button className="btn btn-secondary" onClick={handleSelectDirectory}>
                                📁
                            </button>
                        </div>
                    </div>
                    <div className="config-row">
                        <ModelSelector
                            baseUrl={config.baseUrl}
                            selectedModel={config.model}
                            onModelChange={(model) => onConfigChange({ ...config, model })}
                            disabled={isRunning}
                        />
                    </div>
                    <div className="config-row">
                        <label>Base URL</label>
                        <input
                            type="text"
                            className="input-field"
                            placeholder="http://localhost:1234/v1"
                            value={config.baseUrl}
                            onChange={(e) => onConfigChange({ ...config, baseUrl: e.target.value })}
                        />
                    </div>

                    <div className="config-row" style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border-color)' }}>
                        <label style={{ marginBottom: '8px', display: 'block', color: 'var(--text-secondary)' }}>Advanced Tuning</label>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                            <div className="setting-item">
                                <label style={{ fontSize: '0.8em', marginBottom: '4px', display: 'block' }}>Context History</label>
                                <input
                                    type="number"
                                    className="input-field"
                                    value={config.maxContextHistory || 10}
                                    onChange={(e) => onConfigChange({ ...config, maxContextHistory: parseInt(e.target.value) })}
                                    title="Number of recent messages to keep when summarizing"
                                />
                            </div>
                            <div className="setting-item">
                                <label style={{ fontSize: '0.8em', marginBottom: '4px', display: 'block' }}>Summary Threshold</label>
                                <input
                                    type="number"
                                    step="0.05"
                                    min="0.1"
                                    max="1.0"
                                    className="input-field"
                                    value={config.summarizationThreshold || 0.85}
                                    onChange={(e) => onConfigChange({ ...config, summarizationThreshold: parseFloat(e.target.value) })}
                                    title="Token usage threshold (0.0-1.0) to trigger summarization"
                                />
                            </div>
                            <div className="setting-item">
                                <label style={{ fontSize: '0.8em', marginBottom: '4px', display: 'block' }}>Duck Freq (steps)</label>
                                <input
                                    type="number"
                                    min="1"
                                    className="input-field"
                                    value={config.supervisorInterval || 5}
                                    onChange={(e) => onConfigChange({ ...config, supervisorInterval: parseInt(e.target.value) })}
                                    title="How often the debugging duck checks in (in steps)"
                                />
                            </div>
                        </div>
                    </div>
                    <button
                        className="btn btn-secondary collapse-btn"
                        onClick={() => setShowConfig(false)}
                    >
                        Collapse ▲
                    </button>
                </div>
            )}

            {/* Plan Panel */}
            <PlanPanel
                plan={plan}
                isExpanded={showPlan}
                onToggle={() => setShowPlan(!showPlan)}
            />

            {/* Token Usage Bar - visible during execution */}
            {tokenUsage && (
                <TokenUsageBar
                    stepUsage={tokenUsage.step}
                    cumulativeUsage={tokenUsage.cumulative}
                    currentPromptTokens={tokenUsage.currentPromptTokens}
                    contextLimit={tokenUsage.contextLimit}
                    messages={tokenUsage.contextMessages}
                />
            )}

            {/* Paused State with Resume */}
            {isPaused && (
                <div className="pause-panel">
                    <div className="pause-info">
                        <span className="pause-icon">⏸</span>
                        <span>Agent is paused. Provide guidance or resume.</span>
                    </div>
                    <div className="pause-actions">
                        <input
                            type="text"
                            className="input-field"
                            placeholder="Optional guidance..."
                            value={resumeGuidance}
                            onChange={(e) => setResumeGuidance(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleResume()}
                        />
                        <button className="btn btn-success" onClick={handleResume}>
                            ▶ Resume
                        </button>
                    </div>
                </div>
            )}

            {/* Command Approval */}
            {pendingCommand && (
                <div className="command-approval-container">
                    <CommandApproval
                        command={pendingCommand.command}
                        commandType={pendingCommand.commandType}
                        cwd={pendingCommand.cwd}
                        onApprove={() => onApproveCommand('allow_once')}
                        onReject={() => onApproveCommand('reject')}
                        onAllowType={() => onApproveCommand('allow_type')}
                        onAllowExact={() => onApproveCommand('allow_exact')}
                    />
                </div>
            )}

            {/* File Diffs Bar */}
            {fileDiffs.length > 0 && (
                <div className="diffs-bar">
                    <span className="diffs-label">📝 Recent Changes:</span>
                    {fileDiffs.slice(-5).map((diff, i) => (
                        <button
                            key={i}
                            className="diff-chip"
                            onClick={() => onViewDiff(diff)}
                            title={`View changes to ${diff.filePath}`}
                        >
                            {diff.filePath.split('/').pop()}
                        </button>
                    ))}
                </div>
            )}

            {/* Messages List */}
            <div className="messages-container">
                {messages.length === 0 && !isRunning ? (
                    <div className="empty-state">
                        <div className="empty-icon">🤖</div>
                        <h3>Ready to start</h3>
                        <p>Enter a task below to begin</p>
                    </div>
                ) : (
                    messages.map((msg) => (
                        <MessageItem
                            key={msg.id}
                            message={msg}
                            onViewDiff={msg.diff ? () => onViewDiff({
                                filePath: msg.args?.path || 'file',
                                diff: msg.diff!,
                                timestamp: msg.timestamp
                            }) : undefined}
                        />
                    ))
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <InputBar
                task={task}
                setTask={setTask}
                isRunning={isRunning}
                pendingQuery={pendingQuery}
                config={config}
                onStart={handleStart}
                onUserInput={onUserInput}
            />
        </div>
    );
}
