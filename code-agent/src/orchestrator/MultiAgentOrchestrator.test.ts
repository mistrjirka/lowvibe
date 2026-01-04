import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the LMStudioClient
vi.mock('../llm/LMStudioClient', () => ({
    LMStudioClient: vi.fn().mockImplementation(() => ({
        completion: vi.fn()
    }))
}));

// Mock tools
vi.mock('../tools/read_file', () => ({
    readFile: vi.fn().mockReturnValue({ content: 'test content' })
}));

vi.mock('../tools/run_cmd', () => ({
    runCmd: vi.fn().mockResolvedValue({ stdout: 'ok', stderr: '', code: 0 })
}));

vi.mock('../tools/add_remove_function', () => ({
    addFunction: vi.fn().mockReturnValue({ success: true, message: 'Added' }),
    removeFunction: vi.fn().mockReturnValue({ success: true, message: 'Removed' })
}));

vi.mock('../tools/edit_function', () => ({
    editFunction: vi.fn().mockReturnValue({ success: true, message: 'Edited' })
}));

vi.mock('../tools/write_file', () => ({
    writeFile: vi.fn().mockReturnValue({ success: true, message: 'Written' })
}));

vi.mock('../tools/read_function', () => ({
    readFunction: vi.fn().mockReturnValue({ content: 'function code' })
}));

vi.mock('../tools/get_file_outline', () => ({
    getFileOutline: vi.fn().mockReturnValue({ outline: [] })
}));

import { MultiAgentOrchestrator, OrchestratorConfig } from './MultiAgentOrchestrator';
import { EventEmitter } from 'events';
import { LMStudioClient } from '../llm/LMStudioClient';

describe('MultiAgentOrchestrator', () => {
    let orchestrator: MultiAgentOrchestrator;
    let mockClient: any;
    let mockEmitter: EventEmitter;
    let config: OrchestratorConfig;

    beforeEach(() => {
        mockClient = {
            completion: vi.fn()
        };
        mockEmitter = new EventEmitter();

        config = {
            client: mockClient as any,
            repoRoot: '/test/repo',
            emitter: mockEmitter,
            logger: vi.fn(),
            askUser: vi.fn().mockResolvedValue('y'),
            maxStepsPerAgent: 10
        };

        orchestrator = new MultiAgentOrchestrator(config);
    });

    describe('Thinker agent', () => {
        it('should process message responses', async () => {
            mockClient.completion
                .mockResolvedValueOnce({
                    type: 'message',
                    text: 'Let me analyze this task'
                })
                .mockResolvedValueOnce({
                    type: 'final',
                    text: 'Task complete',
                    criteriaStatus: 'success'
                });

            const result = await orchestrator.run('Test task', '- [ ] Do something', ['file.py']);

            expect(result.success).toBe(true);
            expect(result.message).toBe('Task complete');
        });

        it('should process tool_call responses', async () => {
            mockClient.completion
                .mockResolvedValueOnce({
                    type: 'tool_call',
                    tool: 'read_file',
                    args: { path: 'test.py' }
                })
                .mockResolvedValueOnce({
                    type: 'final',
                    text: 'Done reading',
                    criteriaStatus: 'success'
                });

            const result = await orchestrator.run('Read a file', '', []);

            expect(result.success).toBe(true);
        });

        it('should prevent consecutive implement calls', async () => {
            mockClient.completion
                .mockResolvedValueOnce({
                    type: 'implement',
                    payload: {
                        description: 'Task 1',
                        tasks: [{
                            type: 'create_file',
                            task_description: 'Create file',
                            code: 'content',
                            file: 'new.py'
                        }]
                    }
                })
                // After implement, if another implement is attempted:
                .mockResolvedValueOnce({
                    type: 'implement',
                    payload: {
                        description: 'Task 2',
                        tasks: [{
                            type: 'create_file',
                            task_description: 'Another file',
                            code: 'content2',
                            file: 'new2.py'
                        }]
                    }
                })
                .mockResolvedValueOnce({
                    type: 'message',
                    text: 'Now I understand'
                })
                .mockResolvedValueOnce({
                    type: 'final',
                    text: 'Complete',
                    criteriaStatus: 'success'
                });

            // Mock implementer responses
            mockClient.completion
                .mockResolvedValueOnce({
                    type: 'done',
                    summary: 'File created'
                })
                .mockResolvedValueOnce({
                    type: 'done',
                    summary: 'File 2 created'
                });

            // Mock tester responses
            mockClient.completion
                .mockResolvedValueOnce({
                    type: 'result',
                    payload: {
                        successfully_implemented: true,
                        successes: 'All good',
                        mistakes: '',
                        tests_to_keep: []
                    }
                })
                .mockResolvedValueOnce({
                    type: 'result',
                    payload: {
                        successfully_implemented: true,
                        successes: 'All good',
                        mistakes: '',
                        tests_to_keep: []
                    }
                });

            // Mock finisher responses
            mockClient.completion.mockResolvedValueOnce({
                overall: 'Great work',
                task_results: []
            });

            await orchestrator.run('Test', '', []);

            // Verify logger was called about needing a message
            expect(config.logger).toHaveBeenCalled();
        });
    });

    describe('Implementer agent', () => {
        it('should handle done response', async () => {
            mockClient.completion
                .mockResolvedValueOnce({
                    type: 'implement',
                    payload: {
                        description: 'Create file',
                        tasks: [{
                            type: 'create_file',
                            task_description: 'Create new file',
                            code: 'print("hello")',
                            file: 'hello.py'
                        }]
                    }
                });

            // Implementer: uses write_file then done
            mockClient.completion
                .mockResolvedValueOnce({
                    type: 'tool_call',
                    tool: 'write_file',
                    args: { path: 'hello.py', content: 'print("hello")' }
                })
                .mockResolvedValueOnce({
                    type: 'done',
                    summary: 'Created hello.py'
                });

            // Tester
            mockClient.completion.mockResolvedValueOnce({
                type: 'result',
                payload: {
                    successfully_implemented: true,
                    successes: 'File exists and runs',
                    mistakes: '',
                    tests_to_keep: []
                }
            });

            // Finisher
            mockClient.completion.mockResolvedValueOnce({
                overall: 'All tasks succeeded',
                task_results: []
            });

            // Final from thinker
            mockClient.completion.mockResolvedValueOnce({
                type: 'final',
                text: 'Done',
                criteriaStatus: 'success'
            });

            const result = await orchestrator.run('Create file', '', []);
            expect(result.success).toBe(true);
        });

        it('should handle error response', async () => {
            mockClient.completion
                .mockResolvedValueOnce({
                    type: 'implement',
                    payload: {
                        description: 'Impossible task',
                        tasks: [{
                            type: 'edit_file',
                            task_description: 'Edit nonexistent',
                            code: 'new code',
                            file: 'nonexistent.py'
                        }]
                    }
                });

            // Implementer returns error
            mockClient.completion.mockResolvedValueOnce({
                type: 'error',
                reason: 'File not found'
            });

            // Back to thinker who gives up
            mockClient.completion.mockResolvedValueOnce({
                type: 'final',
                text: 'Could not complete',
                criteriaStatus: 'blocked'
            });

            const result = await orchestrator.run('Edit file', '', []);
            expect(result.success).toBe(false);
        });
    });

    describe('Tester agent', () => {
        it('should create test files and track them', async () => {
            // Setup implement call
            mockClient.completion
                .mockResolvedValueOnce({
                    type: 'implement',
                    payload: {
                        description: 'Test task',
                        tasks: [{
                            type: 'create_file',
                            task_description: 'Create',
                            code: 'code',
                            file: 'test.py'
                        }]
                    }
                });

            // Implementer done
            mockClient.completion.mockResolvedValueOnce({
                type: 'done',
                summary: 'Done'
            });

            // Tester creates a test file then returns result
            mockClient.completion
                .mockResolvedValueOnce({
                    type: 'tool_call',
                    tool: 'create_file',
                    args: { path: 'test_verify.py', content: 'import test' }
                })
                .mockResolvedValueOnce({
                    type: 'tool_call',
                    tool: 'run_cmd',
                    args: { cmd: 'python test_verify.py' }
                })
                .mockResolvedValueOnce({
                    type: 'result',
                    payload: {
                        successfully_implemented: true,
                        successes: 'Test passed',
                        mistakes: '',
                        tests_to_keep: ['test_verify.py']
                    }
                });

            // Finisher
            mockClient.completion.mockResolvedValueOnce({
                overall: 'Success',
                task_results: []
            });

            // Final
            mockClient.completion.mockResolvedValueOnce({
                type: 'final',
                text: 'Complete',
                criteriaStatus: 'success'
            });

            await orchestrator.run('Test', '', []);
        });
    });

    describe('Event emissions', () => {
        it('should emit orchestrator:start on run', async () => {
            const startSpy = vi.fn();
            mockEmitter.on('orchestrator:start', startSpy);

            mockClient.completion.mockResolvedValue({
                type: 'final',
                text: 'Done',
                criteriaStatus: 'success'
            });

            await orchestrator.run('Task', '', []);

            expect(startSpy).toHaveBeenCalledWith({ task: 'Task' });
        });

        it('should emit thinker:step on each thinker response', async () => {
            const stepSpy = vi.fn();
            mockEmitter.on('thinker:step', stepSpy);

            mockClient.completion
                .mockResolvedValueOnce({
                    type: 'message',
                    text: 'Thinking...'
                })
                .mockResolvedValueOnce({
                    type: 'final',
                    text: 'Done',
                    criteriaStatus: 'success'
                });

            await orchestrator.run('Task', '', []);

            expect(stepSpy).toHaveBeenCalledTimes(2);
        });
    });
});
