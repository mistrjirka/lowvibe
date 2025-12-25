
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { replaceInFile } from './replace_in_file';

const TEST_DIR = path.join(os.tmpdir(), 'code-agent-replace-test');
// Log file path: repo_root/logs/test_execution.log
const LOG_FILE = path.join(__dirname, '../../logs/test_execution.log');

function log(message: string) {
    // Ensure logs dir exists
    const logDir = path.dirname(LOG_FILE);
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    fs.appendFileSync(LOG_FILE, message + '\n');
    console.log(message);
}

describe('replaceInFile', () => {
    beforeEach(() => {
        if (fs.existsSync(TEST_DIR)) {
            fs.rmSync(TEST_DIR, { recursive: true, force: true });
        }
        fs.mkdirSync(TEST_DIR, { recursive: true });
        log(`\n\n--- TEST RUN START: ${new Date().toISOString()} ---`);
    });

    afterEach(() => {
        if (fs.existsSync(TEST_DIR)) {
            fs.rmSync(TEST_DIR, { recursive: true, force: true });
        }
    });

    it('should replace exact matches', () => {
        log('\n--- Test: Exact Match ---');
        const filePath = path.join(TEST_DIR, 'test.txt');
        const initialContent = 'Hello World\nAnother Line';
        fs.writeFileSync(filePath, initialContent, 'utf-8');
        log('INPUT Content: ' + JSON.stringify(initialContent));
        log('FIND: ' + JSON.stringify('World'));
        log('REPLACE: ' + JSON.stringify('Universe'));

        const result = replaceInFile(TEST_DIR, {
            path: 'test.txt',
            find: 'World',
            replace: 'Universe'
        });

        log('RESULT: ' + (result.success ? 'SUCCESS' : 'FAILED'));
        log('OUTPUT Content: ' + JSON.stringify(fs.readFileSync(filePath, 'utf-8')));

        expect(result.success).toBe(true);
        expect(result.replacementsMade).toBe(1);
        expect(fs.readFileSync(filePath, 'utf-8')).toBe('Hello Universe\nAnother Line');
    });

    it('should handle multiline replacements', () => {
        log('\n--- Test: Multiline Replacement ---');
        const filePath = path.join(TEST_DIR, 'multiline.py');
        const content = `def foo():\n    print("start")\n    print("end")\n`;
        fs.writeFileSync(filePath, content, 'utf-8');
        log('INPUT Content: ' + JSON.stringify(content));

        const findStr = 'print("start")\n    print("end")';
        const replaceStr = 'print("done")';
        log('FIND: ' + JSON.stringify(findStr));
        log('REPLACE: ' + JSON.stringify(replaceStr));

        const result = replaceInFile(TEST_DIR, {
            path: 'multiline.py',
            find: findStr,
            replace: replaceStr
        });

        log('RESULT: ' + (result.success ? 'SUCCESS' : 'FAILED'));
        log('OUTPUT Content: ' + JSON.stringify(fs.readFileSync(filePath, 'utf-8')));

        expect(result.success).toBe(true);
        expect(fs.readFileSync(filePath, 'utf-8')).toBe(`def foo():\n    print("done")\n`);
    });

    it('should handle escape characters mismatch (CRLF vs LF)', () => {
        log('\n--- Test: Relaxed Matching (CRLF vs LF) ---');
        // This reproduces the issue: Use \r\n in find, but file has \n
        const filePath = path.join(TEST_DIR, 'newlines.txt');
        // File has LF
        const fileContent = 'Line1\nLine2\n';
        fs.writeFileSync(filePath, fileContent, 'utf-8');
        log('INPUT Content: ' + JSON.stringify(fileContent));

        // Find query uses CRLF (e.g. from a Windows user input or weird JSON escaping)
        const findStr = 'Line1\r\nLine2';
        const replaceStr = 'Line1\nModified';
        log('FIND (CRLF): ' + JSON.stringify(findStr));
        log('REPLACE: ' + JSON.stringify(replaceStr));

        const result = replaceInFile(TEST_DIR, {
            path: 'newlines.txt',
            find: findStr,
            replace: replaceStr
        });

        log('RESULT: ' + (result.success ? 'SUCCESS' : 'FAILED'));
        if (result.success) {
            // log('DIFF Generated: ' + result.diff);
        } else {
            log('ERROR: ' + result.error);
        }
        log('OUTPUT Content: ' + JSON.stringify(fs.readFileSync(filePath, 'utf-8')));

        expect(result.success).toBe(true);
    });

    it('should match literal backslashes correctly', () => {
        log('\n--- Test: Literal Backslash Matching ---');
        const filePath = path.join(TEST_DIR, 'escapes.py');
        const fileContent = 'print("Line with embedded \\r char")'; // Literal \r in string
        fs.writeFileSync(filePath, fileContent, 'utf-8');
        log('INPUT Content: ' + JSON.stringify(fileContent));

        const findStr = 'embedded \\r char';
        const replaceStr = 'embedded \\n char';
        log('FIND: ' + JSON.stringify(findStr));
        log('REPLACE: ' + JSON.stringify(replaceStr));

        const result = replaceInFile(TEST_DIR, {
            path: 'escapes.py',
            find: findStr,
            replace: replaceStr
        });

        log('RESULT: ' + (result.success ? 'SUCCESS' : 'FAILED'));
        log('OUTPUT Content: ' + JSON.stringify(fs.readFileSync(filePath, 'utf-8')));

        expect(result.success).toBe(true);
        expect(fs.readFileSync(filePath, 'utf-8')).toBe('print("Line with embedded \\n char")');
    });
    it('should handle the specific user reported failure (Complex Python with \\r\\n)', () => {
        log('\n--- Test: User Reported Regression (Complex Python) ---');
        const filePath = path.join(TEST_DIR, 'main.py');

        // This content uses standard \n (LF) as if written on Linux/Mac
        const fileContent = `# Helper function to strip Windows line endings
def strip_windows_line_ending(s):
    return s.replace('\\r', '')

# Function to parse input from a file content string
def parse_input(content):
    lines = [strip_windows_line_ending(line) for line in content.splitlines()]
    
    # Extract target sequence T
    T = lines[0].strip()
    
    # Extract N and Dmax
    N, Dmax = map(int, lines[1].split())
    
    # Extract costs and sequences (2N lines)
    costs = []
    sequences = []
    for i in range(2, 2 + 2 * N):
        if i % 2 == 1:  # Odd line: cost
            cost = int(lines[i])
            costs.append(cost)
        else:  # Even line: sequence
            seq = lines[i]
            sequences.append(seq)
    
    return T, N, Dmax, costs, sequences

# Example usage with pub01.in content
content = """
ACACAGCAGCCGT
3 4
2
ACC
3
AGCTA
4
CCGGTT
"""
T, N, Dmax, costs, sequences = parse_input(content)
print(f"Target sequence: {T}")
print(f"Number of units (N): {N}, Max deletions (Dmax): {Dmax}")
print(f"Costs: {costs}")
print(f"Sequences: {sequences}")`;

        fs.writeFileSync(filePath, fileContent, 'utf-8');
        log('INPUT Content length: ' + fileContent.length);

        // This find string mimics exactly what was sent in JSON: contains \r\n
        const findStr = `# Example usage with pub01.in content
content = """
ACACAGCAGCCGT\r
3 4\r
2\r
ACC\r
3\r
AGCTA\r
4\r
CCGGTT\r
"""
T, N, Dmax, costs, sequences = parse_input(content)
print(f"Target sequence: {T}")
print(f"Number of units (N): {N}, Max deletions (Dmax): {Dmax}")
print(f"Costs: {costs}")
print(f"Sequences: {sequences}")`;

        const replaceStr = '# Example usage will be handled in test_parser.py';

        log('FIND (contains \\r\\n): ' + JSON.stringify(findStr));
        log('REPLACE: ' + JSON.stringify(replaceStr));

        const result = replaceInFile(TEST_DIR, {
            path: 'main.py',
            find: findStr,
            replace: replaceStr
        });

        log('RESULT: ' + (result.success ? 'SUCCESS' : 'FAILED'));
        if (!result.success) log('ERROR: ' + result.error);
        log('OUTPUT Content length: ' + fs.readFileSync(filePath, 'utf-8').length);

        expect(result.success).toBe(true);
        expect(fs.readFileSync(filePath, 'utf-8')).toContain(replaceStr);
        expect(fs.readFileSync(filePath, 'utf-8')).not.toContain('ACACAGCAGCCGT');
    });
});
