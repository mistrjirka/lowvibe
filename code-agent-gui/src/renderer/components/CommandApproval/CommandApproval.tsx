
import './CommandApproval.css';

interface CommandApprovalProps {
    command: string;
    commandType: string;
    cwd: string;
    onApprove: () => void;
    onReject: () => void;
    onAllowType: () => void;
    onAllowExact: () => void;
}

export function CommandApproval({
    command,
    commandType,
    cwd,
    onApprove,
    onReject,
    onAllowType,
    onAllowExact
}: CommandApprovalProps) {
    return (
        <div className="command-approval">
            <div className="command-approval-header">
                <span className="approval-icon">⚠️</span>
                <span className="approval-title">Command Approval Required</span>
            </div>

            <div className="command-preview">
                <code className="command-text">{command}</code>
                <div className="command-meta">
                    <span className="command-type">Type: <strong>{commandType}</strong></span>
                    <span className="command-cwd">in {cwd}</span>
                </div>
            </div>

            <div className="approval-actions">
                <button
                    className="btn btn-success"
                    onClick={onApprove}
                    title="Allow this command once"
                >
                    ✓ Allow Once
                </button>
                <button
                    className="btn btn-warning"
                    onClick={onAllowType}
                    title={`Always allow commands starting with "${commandType}"`}
                >
                    🔓 Always Allow "{commandType}"
                </button>
                <button
                    className="btn btn-secondary"
                    onClick={onAllowExact}
                    title="Add this exact command to allowed list"
                >
                    📌 Allow Exact
                </button>
                <button
                    className="btn btn-danger"
                    onClick={onReject}
                    title="Reject this command"
                >
                    ✗ Reject
                </button>
            </div>
        </div>
    );
}
