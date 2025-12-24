
import './DiffViewer.css';

interface DiffViewerProps {
    diff: string;
    filePath: string;
    onClose: () => void;
}

export function DiffViewer({ diff, filePath, onClose }: DiffViewerProps) {
    const lines = diff.split('\n');

    // Count additions and deletions
    const additions = lines.filter(l => l.startsWith('+')).length;
    const deletions = lines.filter(l => l.startsWith('-')).length;

    return (
        <div className="diff-viewer-overlay" onClick={onClose}>
            <div className="diff-viewer" onClick={(e) => e.stopPropagation()}>
                <div className="diff-header">
                    <div className="diff-title">
                        <span className="diff-icon">📝</span>
                        <span>Changes to <strong>{filePath}</strong></span>
                    </div>
                    <div className="diff-stats">
                        <span className="diff-additions">+{additions}</span>
                        <span className="diff-deletions">-{deletions}</span>
                    </div>
                    <button className="diff-close" onClick={onClose}>×</button>
                </div>

                <pre className="diff-content">
                    {lines.map((line, i) => {
                        let className = 'diff-line diff-context';
                        if (line.startsWith('+')) {
                            className = 'diff-line diff-add';
                        } else if (line.startsWith('-')) {
                            className = 'diff-line diff-remove';
                        }

                        return (
                            <div key={i} className={className}>
                                <span className="diff-line-number">{i + 1}</span>
                                <span className="diff-line-content">{line}</span>
                            </div>
                        );
                    })}
                </pre>
            </div>
        </div>
    );
}
