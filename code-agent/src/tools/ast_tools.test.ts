/**
 * Tests for AST-based syntactic tree tools
 * Run with: npx ts-node src/tools/ast_tools.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { getOutline, detectLanguage, collectAllNames, findByName } from './ast_parser';
import { getFileOutline } from './get_file_outline';
import { readFunction } from './read_function';
import { editFunction } from './edit_function';
import { addFunction, removeFunction } from './add_remove_function';

const TEST_DIR = path.join(__dirname, '../../test_fixtures');

// Sample Python code for testing
const SAMPLE_PYTHON = `CONFIG = "test"

class Helper:
    def __init__(self):
        self.value = 0
    
    def process_data(self, data):
        return data * 2

def main():
    h = Helper()
    print(h.process_data(5))
`;

// Sample C++ code for testing
const SAMPLE_CPP = `#include <iostream>

int globalVar = 42;

class Calculator {
public:
    int add(int a, int b) {
        return a + b;
    }
};

int main() {
    Calculator calc;
    std::cout << calc.add(1, 2) << std::endl;
    return 0;
}
`;

function setupTestFiles() {
    if (!fs.existsSync(TEST_DIR)) {
        fs.mkdirSync(TEST_DIR, { recursive: true });
    }
    fs.writeFileSync(path.join(TEST_DIR, 'sample.py'), SAMPLE_PYTHON);
    fs.writeFileSync(path.join(TEST_DIR, 'sample.cpp'), SAMPLE_CPP);
}

function cleanupTestFiles() {
    if (fs.existsSync(TEST_DIR)) {
        fs.rmSync(TEST_DIR, { recursive: true });
    }
}

function assert(condition: boolean, message: string) {
    if (!condition) {
        throw new Error(`FAILED: ${message}`);
    }
    console.log(`✓ ${message}`);
}

async function runTests() {
    console.log('=== Setting up test files ===\n');
    setupTestFiles();

    try {
        // Test 1: Language detection
        console.log('--- Test: Language Detection ---');
        assert(detectLanguage('file.py') === 'python', 'Detect Python');
        assert(detectLanguage('file.cpp') === 'cpp', 'Detect C++');
        assert(detectLanguage('file.txt') === 'unknown', 'Detect unknown');

        // Test 2: Python outline
        console.log('\n--- Test: Python Outline ---');
        const pyOutline = getOutline(SAMPLE_PYTHON, 'python');
        assert(pyOutline.length === 3, 'Python has 3 top-level items');
        assert(pyOutline[0].type === 'variable' && pyOutline[0].name === 'CONFIG', 'First is CONFIG variable');
        assert(pyOutline[1].type === 'class' && pyOutline[1].name === 'Helper', 'Second is Helper class');
        assert(pyOutline[1].children?.length === 2, 'Helper has 2 methods');
        assert(pyOutline[2].type === 'function' && pyOutline[2].name === 'main', 'Third is main function');

        // Test 3: C++ outline
        console.log('\n--- Test: C++ Outline ---');
        const cppOutline = getOutline(SAMPLE_CPP, 'cpp');
        console.log('C++ Outline:', JSON.stringify(cppOutline, null, 2));
        assert(cppOutline.length >= 2, 'C++ has at least 2 items (class + main)');

        // Test 4: Collect all names
        console.log('\n--- Test: Collect All Names ---');
        const names = collectAllNames(pyOutline);
        assert(names.includes('CONFIG'), 'Names include CONFIG');
        assert(names.includes('Helper'), 'Names include Helper');
        assert(names.includes('process_data'), 'Names include process_data');
        assert(names.includes('main'), 'Names include main');

        // Test 5: Find by name
        console.log('\n--- Test: Find By Name ---');
        const found = findByName(pyOutline, 'process_data');
        assert(found !== null, 'Found process_data');
        assert(found?.type === 'method', 'process_data is a method');

        // Test 6: Get file outline (full integration)
        console.log('\n--- Test: Get File Outline ---');
        const result = getFileOutline(TEST_DIR, { path: 'sample.py' });
        assert(!('error' in result), 'No error in outline');
        if (!('error' in result)) {
            assert(result.allNames.length >= 4, 'Outline has at least 4 names');
        }

        // Test 7: Read function
        console.log('\n--- Test: Read Function ---');
        const readResult = readFunction(TEST_DIR, { path: 'sample.py', name: 'main' });
        assert(!('error' in readResult), 'No error reading main');
        if (!('error' in readResult)) {
            assert(readResult.content.includes('def main'), 'Content includes def main');
        }

        // Test 8: Add function
        console.log('\n--- Test: Add Function ---');
        const addResult = addFunction(TEST_DIR, {
            path: 'sample.py',
            code: '\ndef new_function():\n    pass\n',
            insertAtLine: 3
        });
        assert(!('error' in addResult), 'No error adding function');

        // Verify addition
        const afterAdd = fs.readFileSync(path.join(TEST_DIR, 'sample.py'), 'utf-8');
        assert(afterAdd.includes('def new_function'), 'New function was added');

        // Test 9: Remove function
        console.log('\n--- Test: Remove Function ---');
        const removeResult = removeFunction(TEST_DIR, { path: 'sample.py', name: 'new_function' });
        assert(!('error' in removeResult), 'No error removing function');

        console.log('\n=== ALL TESTS PASSED ===\n');

    } finally {
        cleanupTestFiles();
    }
}

runTests().catch(err => {
    console.error('\n❌ TEST FAILED:', err.message);
    cleanupTestFiles();
    process.exit(1);
});
