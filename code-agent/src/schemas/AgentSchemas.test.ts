timport { describe, it, expect } from 'vitest';
import {
    ThinkerOutputSchema,
    ImplementerOutputSchema,
    TesterOutputSchema,
    ThinkerReadFileSchema,
    ThinkerRunCmdSchema,
} from './AgentSchemas';

describe('AgentSchemas', () => {
    describe('ThinkerOutputSchema', () => {
        it('should accept valid message output', () => {
            const result = ThinkerOutputSchema.parse({
                type: 'message',
                text: 'I am analyzing the task...'
            });
            expect(result.type).toBe('message');
        });

        it('should accept valid read_file tool call with flat path', () => {
            const result = ThinkerOutputSchema.parse({
                type: 'tool_call',
                tool: 'read_file',
                args: { path: 'datapub/pub01.in' }
            });
            expect(result.type).toBe('tool_call');
            expect(result.tool).toBe('read_file');
            expect(result.args.path).toBe('datapub/pub01.in');
        });

        it('should reject read_file with nested path structure', () => {
            // This is what the LLM was incorrectly outputting before
            expect(() => ThinkerOutputSchema.parse({
                type: 'tool_call',
                tool: 'read_file',
                args: { file_path: { path: 'datapub/pub01.in' } }
            })).toThrow();
        });

        it('should reject read_file without path', () => {
            expect(() => ThinkerOutputSchema.parse({
                type: 'tool_call',
                tool: 'read_file',
                args: {}
            })).toThrow();
        });

        it('should accept valid run_cmd tool call', () => {
            const result = ThinkerOutputSchema.parse({
                type: 'tool_call',
                tool: 'run_cmd',
                args: { cmd: 'ls -la', cwd: 'datapub' }
            });
            expect(result.tool).toBe('run_cmd');
            expect(result.args.cmd).toBe('ls -la');
        });

        it('should accept valid implement output', () => {
            const result = ThinkerOutputSchema.parse({
                type: 'implement',
                payload: {
                    description: 'Create a hello world file',
                    tasks: [{
                        type: 'create_file',
                        task_description: 'Create hello.py',
                        code: 'print("hello")',
                        file: 'hello.py'
                    }]
                }
            });
            expect(result.type).toBe('implement');
        });

        it('should accept valid final output', () => {
            const result = ThinkerOutputSchema.parse({
                type: 'final',
                text: 'Task completed successfully',
                criteriaStatus: 'success'
            });
            expect(result.type).toBe('final');
            expect(result.criteriaStatus).toBe('success');
        });
    });

    describe('ImplementerOutputSchema', () => {
        it('should accept valid add_function tool call', () => {
            const result = ImplementerOutputSchema.parse({
                type: 'tool_call',
                tool: 'add_function',
                args: {
                    path: 'solution.py',
                    function_code: 'def solve():\n    pass'
                }
            });
            expect(result.tool).toBe('add_function');
        });

        it('should accept valid edit_function tool call', () => {
            const result = ImplementerOutputSchema.parse({
                type: 'tool_call',
                tool: 'edit_function',
                args: {
                    path: 'solution.py',
                    function_name: 'solve',
                    new_code: 'def solve():\n    return 42'
                }
            });
            expect(result.tool).toBe('edit_function');
        });

        it('should accept valid write_file tool call with content', () => {
            const result = ImplementerOutputSchema.parse({
                type: 'tool_call',
                tool: 'write_file',
                args: {
                    path: 'setup.py',
                    content: 'print("hello")'
                }
            });
            expect(result.tool).toBe('write_file');
            expect(result.args.content).toBe('print("hello")');
        });

        it('should reject write_file without content', () => {
            // This should now fail because each tool has explicit schema
            expect(() => ImplementerOutputSchema.parse({
                type: 'tool_call',
                tool: 'write_file',
                args: { path: 'setup.py' }
            })).toThrow();
        });

        it('should accept done output', () => {
            const result = ImplementerOutputSchema.parse({
                type: 'done',
                summary: 'Implemented the solve function'
            });
            expect(result.type).toBe('done');
        });

        it('should accept error output', () => {
            const result = ImplementerOutputSchema.parse({
                type: 'error',
                reason: 'Function not found in file'
            });
            expect(result.type).toBe('error');
        });
    });

    describe('TesterOutputSchema', () => {
        it('should accept valid run_cmd tool call', () => {
            const result = TesterOutputSchema.parse({
                type: 'tool_call',
                tool: 'run_cmd',
                args: { cmd: 'python solution.py < input.txt' }
            });
            expect(result.tool).toBe('run_cmd');
        });

        it('should accept valid create_file tool call with content', () => {
            const result = TesterOutputSchema.parse({
                type: 'tool_call',
                tool: 'create_file',
                args: {
                    path: 'test_input.txt',
                    content: '1 2 3'
                }
            });
            expect(result.tool).toBe('create_file');
        });

        it('should reject create_file without content', () => {
            expect(() => TesterOutputSchema.parse({
                type: 'tool_call',
                tool: 'create_file',
                args: { path: 'test_input.txt' }
            })).toThrow();
        });

        it('should accept valid result output', () => {
            const result = TesterOutputSchema.parse({
                type: 'result',
                payload: {
                    successfully_implemented: true,
                    successes: 'All test cases passed',
                    mistakes: '',
                    tests_to_keep: []
                }
            });
            expect(result.type).toBe('result');
        });
    });

    describe('Individual Tool Schemas', () => {
        it('ThinkerReadFileSchema should require path in args', () => {
            expect(() => ThinkerReadFileSchema.parse({
                type: 'tool_call',
                tool: 'read_file',
                args: {}
            })).toThrow();

            expect(ThinkerReadFileSchema.parse({
                type: 'tool_call',
                tool: 'read_file',
                args: { path: 'file.txt' }
            }).args.path).toBe('file.txt');
        });

        it('ThinkerRunCmdSchema should require cmd in args', () => {
            expect(() => ThinkerRunCmdSchema.parse({
                type: 'tool_call',
                tool: 'run_cmd',
                args: {}
            })).toThrow();
        });
    });
});
