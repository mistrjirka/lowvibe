/**
 * Tests for AST tool enhancements: Diffs and Logic Blocks
 * Run with: npx ts-node src/tools/ast_tools_v2.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { getOutline } from './ast_parser';
import { replaceCodeblock } from './replace_codeblock';
import { addFunction, removeFunction } from './add_remove_function';

const TEST_DIR = path.join(__dirname, '../../test_fixtures_v2');

// Sample Python with logic blocks
const SAMPLE_LOGIC = `
# Global var
DEBUG = True

if DEBUG:
    print("Debug mode")

def main():
    for i in range(10):
        print(i)
    
    if True:
        pass
`;

function setupTest() {
    if (!fs.existsSync(TEST_DIR)) {
        fs.mkdirSync(TEST_DIR, { recursive: true });
    }
    fs.writeFileSync(path.join(TEST_DIR, 'logic.py'), SAMPLE_LOGIC);
}

function cleanupTest() {
    if (fs.existsSync(TEST_DIR)) {
        fs.rmSync(TEST_DIR, { recursive: true });
    }
}

function assert(condition: boolean, message: string) {
    if (!condition) throw new Error(`FAILED: ${message}`);
    console.log(`✓ ${message}`);
}

async function runTests() {
    console.log('=== Setting up tests ===\n');
    setupTest();

    try {
        // Test 1: Logic Block Detection (Depth 0 only)
        console.log('--- Test: Logic Block Detection ---');
        const outline = getOutline(SAMPLE_LOGIC, 'python');

        // Should find: DEBUG (variable), if (logic), main (function)
        // Nested 'for' and 'if' inside main should NOT be at top level

        const ifBlock = outline.find(i => i.type === 'logic' && i.name === 'if');
        assert(!!ifBlock, 'Found top-level if block');

        const mainFn = outline.find(i => i.type === 'function' && i.name === 'main');
        assert(!!mainFn, 'Found main function');

        // Verify nested blocks didn't bubble up
        const forBlock = outline.find(i => i.type === 'logic' && i.name === 'for');
        assert(!forBlock, 'Nested for loop NOT in top-level outline');

        assert(outline.length === 3, `Expected 3 top-level items, got ${outline.length} (${outline.map(i => i.type).join(', ')})`);


        // Test 2: Edit Function Diff
        console.log('\n--- Test: Edit Function Diff ---');
        const editResult = replaceCodeblock(TEST_DIR, {
            path: 'logic.py',
            name: 'main',
            newContent: 'def main():\n    print("New Main")'
        });

        if ('error' in editResult) throw new Error(editResult.error);

        assert(!!editResult.diff, 'Diff exists in edit result');
        assert(editResult.diff!.includes('-    for i in range(10):'), 'Diff shows removed lines');
        assert(editResult.diff!.includes('+    print("New Main")'), 'Diff shows added lines');
        console.log('Diff Output:\n' + editResult.diff);


        // Test 3: Add Function Diff
        console.log('\n--- Test: Add Function Diff ---');
        const addResult = addFunction(TEST_DIR, {
            path: 'logic.py',
            code: 'def footer():\n    return 0',
            insertAtLine: 15
        });

        if ('error' in addResult) throw new Error(addResult.error);

        assert(!!addResult.diff, 'Diff exists in add result');
        assert(addResult.diff!.includes('+def footer():'), 'Diff shows added function');
        console.log('Diff Output:\n' + addResult.diff);


        // Test 4: Remove Function Diff
        console.log('\n--- Test: Remove Function Diff ---');
        const removeResult = removeFunction(TEST_DIR, {
            path: 'logic.py',
            name: 'footer'
        });

        if ('error' in removeResult) throw new Error(removeResult.error);

        assert(!!removeResult.diff, 'Diff exists in remove result');
        assert(removeResult.diff!.includes('-def footer():'), 'Diff shows removed function');
        console.log('Diff Output:\n' + removeResult.diff);


        // Test 5: Unchanged Logic Warning
        console.log('\n--- Test: Unchanged Logic Warning ---');
        // Reset file
        fs.writeFileSync(path.join(TEST_DIR, 'logic.py'), SAMPLE_LOGIC);

        // Replace main with same logic but different comments
        const sameLogicResult = replaceCodeblock(TEST_DIR, {
            path: 'logic.py',
            name: 'main',
            newContent: '# CHANGED COMMENT\ndef main():\n    for i in range(10):\n        print(i)\n    \n    if True:\n        pass'
        });

        if ('error' in sameLogicResult) throw new Error(sameLogicResult.error);

        assert(sameLogicResult.message.includes('WARNING'), 'Warning message for unchanged logic');
        assert(sameLogicResult.warning === 'logic_unchanged', 'Warning field set correctly');
        console.log('Warning triggered correctly:', sameLogicResult.message);

        // Test 6: Smart Add Function Insertion (Prevent Nesting)
        console.log('\n--- Test: Smart Add Function Insertion ---');
        // Setup file with a function
        const NESTED_TEST_CODE = `
def container():
    print("start")
    print("middle")
    print("end")
`;
        fs.writeFileSync(path.join(TEST_DIR, 'nested.py'), NESTED_TEST_CODE);

        // Attempt to insert inside 'container' at line 4 ("middle")
        const smartAddResult = addFunction(TEST_DIR, {
            path: 'nested.py',
            code: 'def new_helper():\n    pass',
            insertAtLine: 4
        });

        if ('error' in smartAddResult) throw new Error(smartAddResult.error);

        // Check if message mentions adjustment
        assert(smartAddResult.message.includes('Adjusted insertion'), 'Message mentions adjusted insertion');
        console.log('Adjustment Message:', smartAddResult.message);

        // Check content to ensure it's NOT nested
        const nestedContent = fs.readFileSync(path.join(TEST_DIR, 'nested.py'), 'utf-8');
        // Expected: container() ends, THEN new_helper starts
        const lines = nestedContent.split('\n');
        // container is lines 2-5 (inclusive of blank line maybe? Logic in python parser ends at block end)
        // Let's verify content structure.

        // If nested, it would look like:
        // def container():
        //     print("start")
        //     def new_helper(): ...
        //     print("middle")

        // If adjusted, it should look like:
        // def container():
        // ...
        //     print("end")
        // def new_helper(): ...

        // new_helper should be AFTER 'print("end")'
        const endIndex = lines.findIndex(l => l.includes('print("end")'));
        const helperIndex = lines.findIndex(l => l.includes('def new_helper():'));

        assert(helperIndex > endIndex, `New function line (${helperIndex}) should be after container end block (${endIndex})`);
        console.log('Smart Insertion Location Verified');


        console.log('\n=== ALL TESTS PASSED ===\n');

    } finally {
        cleanupTest();
    }
}

runTests().catch(err => {
    console.error('\n❌ TEST FAILED:', err.message);
    cleanupTest();
    process.exit(1);
});
