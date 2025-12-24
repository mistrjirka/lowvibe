import { EventEmitter } from 'events';

// Event types emitted by the Pipeline
export interface PipelineEvents {
    'node:enter': { nodeName: string; nodeIndex: number; totalNodes: number };
    'node:exit': { nodeName: string; nodeIndex: number; state: any };
    'pipeline:start': { name: string; nodes: string[] };
    'pipeline:end': { name: string; finalState: any };
    'pipeline:error': { nodeName: string; error: Error };
}

export class Pipeline<S, R> extends EventEmitter {
    private nodes: Node<S>[] = [];
    private name: string;

    private constructor(name: string) {
        super();
        this.name = name;
    }

    static create<S, R>(name: string): Pipeline<S, R> {
        return new Pipeline<S, R>(name);
    }

    pipe(node: Node<S>): Pipeline<S, R> {
        this.nodes.push(node);
        return this;
    }

    /**
     * Get the names of all nodes in the pipeline.
     * Used by the GUI to dynamically render the pipeline graph.
     */
    getNodeNames(): string[] {
        return this.nodes.map(n => n.name);
    }

    async run(initialState: S, context: PipelineContext): Promise<R> {
        let state = initialState;
        const nodeNames = this.getNodeNames();

        console.log(`\n[Pipeline] Starting: ${this.name}`);
        this.emit('pipeline:start', { name: this.name, nodes: nodeNames });

        for (let i = 0; i < this.nodes.length; i++) {
            const node = this.nodes[i];

            console.log(`[Pipeline] Running node: ${node.name}`);
            this.emit('node:enter', {
                nodeName: node.name,
                nodeIndex: i,
                totalNodes: this.nodes.length
            });

            try {
                state = await node.execute(state, context);
                this.emit('node:exit', {
                    nodeName: node.name,
                    nodeIndex: i,
                    state
                });
            } catch (error) {
                console.error(`[Pipeline] Error in node ${node.name}:`, error);
                this.emit('pipeline:error', {
                    nodeName: node.name,
                    error: error as Error
                });
                throw error;
            }
        }

        this.emit('pipeline:end', { name: this.name, finalState: state });
        return state as unknown as R;
    }
}

export interface Node<S> {
    name: string;
    execute(state: S, context: PipelineContext): Promise<S>;
}

export interface PipelineContext {
    logger: (msg: string) => void;
    askUser: (query: string, options?: { multiline?: boolean }) => Promise<string>;
}
