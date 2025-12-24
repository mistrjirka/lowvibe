
import { PipelineGraph } from './PipelineGraph';
import { AgentMessage } from '../../hooks/useAgentEvents';
import './GraphPanel.css';

interface GraphPanelProps {
    nodes: string[];
    currentNode: string | null;
    completedNodes: string[];
    getMessagesForNode: (nodeName: string) => AgentMessage[];
}

export function GraphPanel({
    nodes,
    currentNode,
    completedNodes,
    getMessagesForNode
}: GraphPanelProps) {
    return (
        <div className="graph-panel-container">
            <div className="panel-header">
                <h2>
                    <span>📊</span>
                    Pipeline Graph
                </h2>
                <div className="graph-legend">
                    <span className="legend-item">
                        <span className="legend-dot pending"></span>
                        Pending
                    </span>
                    <span className="legend-item">
                        <span className="legend-dot active"></span>
                        Active
                    </span>
                    <span className="legend-item">
                        <span className="legend-dot completed"></span>
                        Completed
                    </span>
                </div>
            </div>

            <div className="graph-container">
                {nodes.length === 0 ? (
                    <div className="graph-empty">
                        <div className="graph-empty-icon">🔗</div>
                        <p>Pipeline structure will appear here</p>
                    </div>
                ) : (
                    <PipelineGraph
                        nodes={nodes}
                        currentNode={currentNode}
                        completedNodes={completedNodes}
                        getMessagesForNode={getMessagesForNode}
                    />
                )}
            </div>

            {/* Current Node Info */}
            {currentNode && (
                <div className="current-node-info">
                    <div className="current-node-label">Currently executing:</div>
                    <div className="current-node-name">{currentNode}</div>
                </div>
            )}
        </div>
    );
}
