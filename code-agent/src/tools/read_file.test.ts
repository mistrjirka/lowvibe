import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { readFile } from './read_file';

describe('readFile with includeCallers', () => {
    let tempDir: string;

    beforeAll(() => {
        // Create temp directory with test files
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-file-test-'));

        // Create a target file with functions
        fs.writeFileSync(path.join(tempDir, 'math_utils.py'), `
def add(a, b):
    return a + b

def multiply(a, b):
    return a * b

class Calculator:
    def divide(self, a, b):
        return a / b
`);

        // Create a file that calls functions from target
        fs.writeFileSync(path.join(tempDir, 'main.py'), `
from math_utils import add, multiply

def compute():
    x = add(1, 2)
    y = multiply(3, 4)
    return x + y

def other():
    result = add(5, 6)
    return result
`);

        // Create another caller file
        fs.writeFileSync(path.join(tempDir, 'test.py'), `
from math_utils import add

def test_add():
    assert add(2, 3) == 5
`);
    });

    afterAll(() => {
        // Clean up temp directory
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should return basic content without callers when includeCallers is false', () => {
        const result = readFile(tempDir, { path: 'math_utils.py' });
        expect(result.error).toBeUndefined();
        expect(result.content).toContain('def add');
        expect(result.callers).toBeUndefined();
        expect(result.outline).toBeUndefined();
    });

    it('should return callers and outline when includeCallers is true', () => {
        const result = readFile(tempDir, { path: 'math_utils.py', includeCallers: true });
        expect(result.error).toBeUndefined();
        expect(result.content).toContain('def add');

        // Should have outline
        expect(result.outline).toBeDefined();
        expect(result.outline!.length).toBeGreaterThan(0);
        expect(result.outline!.some(item => item.name === 'add')).toBe(true);
        expect(result.outline!.some(item => item.name === 'multiply')).toBe(true);
        expect(result.outline!.some(item => item.name === 'Calculator')).toBe(true);

        // Should have callers
        expect(result.callers).toBeDefined();

        // add() should be called by compute(), other(), and test_add()
        expect(result.callers!['add']).toBeDefined();
        expect(result.callers!['add'].length).toBe(3);

        // multiply() should be called by compute()
        expect(result.callers!['multiply']).toBeDefined();
        expect(result.callers!['multiply'].length).toBe(1);
    });

    it('should return caller context with qualified names', () => {
        const result = readFile(tempDir, { path: 'math_utils.py', includeCallers: true });
        expect(result.callers).toBeDefined();

        // Check that caller contexts are correct
        const addCallers = result.callers!['add'];
        const callerContexts = addCallers.map(c => c.functionName);
        expect(callerContexts).toContain('compute');
        expect(callerContexts).toContain('other');
        expect(callerContexts).toContain('test_add');
    });

    it('should handle non-code files gracefully', () => {
        fs.writeFileSync(path.join(tempDir, 'readme.txt'), 'This is a readme file');
        const result = readFile(tempDir, { path: 'readme.txt', includeCallers: true });
        expect(result.error).toBeUndefined();
        expect(result.content).toBeDefined();
        expect(result.callers).toBeUndefined(); // Should not have callers for non-code files
    });
});
