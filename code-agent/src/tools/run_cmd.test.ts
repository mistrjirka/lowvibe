/**
 * Tests for run_cmd tool - CWD handling and path validation
 * Run with: npx ts-node src/tools/run_cmd.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { runCmd } from './run_cmd';

const TEST_DIR = path.join(__dirname, '../../test_fixtures_runcmd');

function setupTestFixtures() {
    if (!fs.existsSync(TEST_DIR)) {
        fs.mkdirSync(TEST_DIR, { recursive: true });
    }
    // Create a subdirectory
    const subDir = path.join(TEST_DIR, 'subdir');
    if (!fs.existsSync(subDir)) {
        fs.mkdirSync(subDir, { recursive: true });
    }
    // Create a test script
    fs.writeFileSync(path.join(TEST_DIR, 'test.sh'), 'echo "hello from root"');
    fs.writeFileSync(path.join(subDir, 'test.sh'), 'echo "hello from subdir"');
}

function cleanupTestFixtures() {
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
    console.log('=== Setting up test fixtures ===\n');
    setupTestFixtures();

    try {
        // Test 1: Default CWD (no cwd arg) should use repoRoot
        console.log('--- Test: Default CWD ---');
        const result1 = await runCmd(TEST_DIR, { cmd: 'pwd' });
        assert(result1.exitCode === 0, 'pwd succeeds');
        assert(result1.cwd === TEST_DIR, 'Default CWD is repoRoot');

        // Test 2: Relative CWD "." should resolve to repoRoot
        console.log('\n--- Test: Relative CWD "." ---');
        const result2 = await runCmd(TEST_DIR, { cmd: 'pwd', cwd: '.' });
        assert(result2.exitCode === 0, 'pwd with cwd="." succeeds');
        assert(result2.cwd === TEST_DIR, 'CWD "." resolves to repoRoot');

        // Test 3: Relative subdirectory CWD should work
        console.log('\n--- Test: Relative Subdirectory CWD ---');
        const result3 = await runCmd(TEST_DIR, { cmd: 'pwd', cwd: 'subdir' });
        assert(result3.exitCode === 0, 'pwd with cwd="subdir" succeeds');
        assert(result3.cwd === path.join(TEST_DIR, 'subdir'), 'CWD "subdir" resolves correctly');

        // Test 4: Absolute path "/" should be normalized to "."
        console.log('\n--- Test: Absolute Path "/" Normalization ---');
        const result4 = await runCmd(TEST_DIR, { cmd: 'pwd', cwd: '/' });
        assert(result4.exitCode === 0, 'Absolute "/" is normalized and succeeds');
        assert(result4.cwd === TEST_DIR, 'Absolute "/" normalized to repoRoot');

        // Test 5: Absolute path "/home/..." should be normalized
        console.log('\n--- Test: Absolute Path "/home/..." Normalization ---');
        const result5 = await runCmd(TEST_DIR, { cmd: 'pwd', cwd: '/home/user/something' });
        assert(result5.exitCode === 0, 'Absolute "/home/..." is normalized and succeeds');
        assert(result5.cwd === TEST_DIR, 'Absolute "/home/..." normalized to repoRoot');

        // Test 6: Parent traversal "../" should fail (outside repoRoot)
        console.log('\n--- Test: Parent Traversal Rejection ---');
        const result6 = await runCmd(TEST_DIR, { cmd: 'pwd', cwd: '../../../' });
        // This might succeed or fail depending on normalization - check it's within TEST_DIR
        // Actually after normalization it will be TEST_DIR since it starts with relative
        // Let's check it doesn't escape
        assert(result6.cwd.startsWith(TEST_DIR) || result6.error !== undefined, 'Parent traversal is handled safely');

        // Test 7: Non-existent directory should fail gracefully
        console.log('\n--- Test: Non-existent Directory ---');
        const result7 = await runCmd(TEST_DIR, { cmd: 'pwd', cwd: 'nonexistent' });
        // The command should fail because the directory doesn't exist
        assert(result7.exitCode !== 0 || result7.error !== undefined, 'Non-existent directory fails');

        console.log('\n=== ALL TESTS PASSED ===\n');

    } finally {
        cleanupTestFixtures();
    }
}

runTests().catch(err => {
    console.error('\n❌ TEST FAILED:', err.message);
    cleanupTestFixtures();
    process.exit(1);
});
