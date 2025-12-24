import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import dagreD3 from 'dagre-d3';
import { AgentMessage } from '../../hooks/useAgentEvents';

interface PipelineGraphProps {
    nodes: string[];
    currentNode: string | null;
    completedNodes: string[];
    getMessagesForNode: (nodeName: string) => AgentMessage[];
}

interface PopoverState {
    visible: boolean;
    nodeName: string;
    x: number;
    y: number;
}

export function PipelineGraph({
    nodes,
    currentNode,
    completedNodes,
    getMessagesForNode
}: PipelineGraphProps) {
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [popover, setPopover] = useState<PopoverState>({
        visible: false,
        nodeName: '',
        x: 0,
        y: 0
    });

    useEffect(() => {
        if (!svgRef.current || !containerRef.current || nodes.length === 0) return;

        // Clear previous graph
        const svg = d3.select(svgRef.current);
        svg.selectAll('*').remove();

        // Create a new directed graph
        const g = new dagreD3.graphlib.Graph()
            .setGraph({
                rankdir: 'TB', // Top to bottom
                ranksep: 60,
                nodesep: 40,
                marginx: 20,
                marginy: 20
            })
            .setDefaultEdgeLabel(() => ({}));

        // Add nodes dynamically from pipeline structure
        nodes.forEach((nodeName, index) => {
            const isActive = nodeName === currentNode;
            const isCompleted = completedNodes.includes(nodeName);
            const nodeClass = isActive ? 'active' : isCompleted ? 'completed' : 'pending';

            g.setNode(nodeName, {
                label: nodeName,
                class: nodeClass,
                rx: 8,
                ry: 8,
                padding: 12
            });

            // Add edge to next node
            if (index > 0) {
                g.setEdge(nodes[index - 1], nodeName, {
                    arrowhead: 'vee',
                    curve: d3.curveBasis
                });
            }
        });

        // Create the renderer
        const render = new dagreD3.render();

        // Create a group for the graph
        const inner = svg.append('g');

        // Run the renderer
        render(inner as any, g as any);

        // Get container dimensions
        const containerRect = containerRef.current.getBoundingClientRect();
        const graphWidth = (g.graph() as any).width || 200;
        const graphHeight = (g.graph() as any).height || 200;

        // Calculate scale to fit
        const scaleX = (containerRect.width - 40) / graphWidth;
        const scaleY = (containerRect.height - 40) / graphHeight;
        const scale = Math.min(scaleX, scaleY, 1.5); // Cap at 1.5x

        // Center the graph
        const xOffset = (containerRect.width - graphWidth * scale) / 2;
        const yOffset = (containerRect.height - graphHeight * scale) / 2;

        inner.attr('transform', `translate(${xOffset}, ${yOffset}) scale(${scale})`);

        // Set SVG dimensions
        svg.attr('width', containerRect.width);
        svg.attr('height', containerRect.height);

        // Add click handlers to nodes
        svg.selectAll('.node')
            .style('cursor', 'pointer')
            .on('click', function (_event: MouseEvent) {
                const nodeEl = d3.select(this);
                const nodeName = nodeEl.select('text').text();

                // Get position for popover
                const rect = (this as Element).getBoundingClientRect();
                const containerRect = containerRef.current!.getBoundingClientRect();

                setPopover({
                    visible: true,
                    nodeName,
                    x: rect.left - containerRect.left + rect.width / 2,
                    y: rect.bottom - containerRect.top + 10
                });
            });

    }, [nodes, currentNode, completedNodes]);

    const closePopover = () => {
        setPopover(prev => ({ ...prev, visible: false }));
    };

    const popoverMessages = popover.visible ? getMessagesForNode(popover.nodeName) : [];

    return (
        <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
            <svg ref={svgRef} className="pipeline-graph" />

            {/* Node Details Popover */}
            {popover.visible && (
                <div
                    className="node-popover"
                    style={{
                        left: popover.x,
                        top: popover.y,
                        transform: 'translateX(-50%)'
                    }}
                >
                    <div className="node-popover-header">
                        <span className="node-popover-title">{popover.nodeName}</span>
                        <button className="node-popover-close" onClick={closePopover}>×</button>
                    </div>
                    <div className="node-popover-messages">
                        {popoverMessages.length === 0 ? (
                            <div className="node-popover-empty">No messages in this node yet</div>
                        ) : (
                            popoverMessages.slice(-5).map((msg) => (
                                <div key={msg.id} className="popover-message">
                                    <span className="popover-message-icon">
                                        {msg.type === 'tool_call' ? '🔧' :
                                            msg.type === 'tool_result' ? '📤' : '💬'}
                                    </span>
                                    <span className="popover-message-text">{msg.summary}</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
