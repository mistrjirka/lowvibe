import { spawn, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { z } from 'zod';

export const RunCmdSchema = z.object({
    cmd: z.string(),
    cwd: z.string().optional()
});

export type RunCmdArgs = z.infer<typeof RunCmdSchema>;

const OUTPUT_TRUNCATE_THRESHOLD = 5000; // chars
const OUTPUT_SHOW_HALF = 2000; // show first and last this many chars

/**
 * Truncate large output, save full output to file, and advise using tail/head
 */
function truncateLargeOutput(output: string, type: 'stdout' | 'stderr', repoRoot: string): { truncated: string; savedPath?: string } {
    if (output.length <= OUTPUT_TRUNCATE_THRESHOLD) {
        return { truncated: output };
    }

    // Save full output to file
    const logsDir = path.join(repoRoot, 'logs');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `cmd_${type}_${timestamp}.txt`;
    const savedPath = path.join(logsDir, filename);
    fs.writeFileSync(savedPath, output);

    // Truncate for return - show first and last portions
    const firstPart = output.slice(0, OUTPUT_SHOW_HALF);
    const lastPart = output.slice(-OUTPUT_SHOW_HALF);
    const truncated = firstPart +
        `\n\n... MIDDLE TRUNCATED (${output.length} chars total, showing first and last ${OUTPUT_SHOW_HALF}) ...\n\n` +
        lastPart +
        `\n\nFull output saved to: ${path.relative(repoRoot, savedPath)}\n` +
        `TIP: Use "tail -n 50 ${path.relative(repoRoot, savedPath)}" or "head -n 50 ${path.relative(repoRoot, savedPath)}" to view other portions.`;

    return { truncated, savedPath: path.relative(repoRoot, savedPath) };
}

/**
 * Detect if a process is waiting on stdin by checking /proc
 */
function isWaitingOnStdin(pid: number): boolean {
    try {
        // Check wchan (what kernel function the process is waiting on)
        const wchanPath = `/proc/${pid}/wchan`;
        if (fs.existsSync(wchanPath)) {
            const wchan = fs.readFileSync(wchanPath, 'utf-8').trim();
            // Common wait functions for stdin/select/poll
            if (['wait_woken', 'poll_schedule_timeout', 'do_select', 'ep_poll', 'pipe_read', 'unix_stream_read_generic'].some(fn => wchan.includes(fn))) {
                return true;
            }
        }

        // Check syscall - if it's read (0) on fd 0 (stdin)
        const syscallPath = `/proc/${pid}/syscall`;
        if (fs.existsSync(syscallPath)) {
            const syscall = fs.readFileSync(syscallPath, 'utf-8').trim();
            const parts = syscall.split(' ');
            // syscall 0 = read, first arg 0x0 = fd 0 (stdin)
            if (parts[0] === '0' && parts[1] === '0x0') {
                return true;
            }
        }
    } catch {
        // Ignore errors (process may have exited, or /proc not available)
    }
    return false;
}

/**
 * Detect programming language from command
 */
function detectLanguage(cmd: string): 'python' | 'cpp' | 'unknown' {
    const lower = cmd.toLowerCase();
    if (lower.includes('python') || lower.includes('.py')) return 'python';
    if (lower.includes('g++') || lower.includes('clang++') || lower.includes('./') && (lower.includes('.cpp') || lower.includes('.cc'))) return 'cpp';
    // Check for compiled executables (common patterns)
    if (lower.match(/\.\/(main|program|solution|a\.out)/)) return 'cpp';
    return 'unknown';
}

/**
 * Generate profiling suggestion based on language
 */
function getProfilingSuggestion(cmd: string, language: 'python' | 'cpp' | 'unknown'): string {
    switch (language) {
        case 'python':
            // Extract the script name
            const pyMatch = cmd.match(/python[3]?\s+(\S+\.py)/);
            const pyScript = pyMatch ? pyMatch[1] : 'script.py';
            return `
**PROFILING SUGGESTION (Python):**
Run with cProfile to find bottlenecks:
\`\`\`bash
python -m cProfile -s cumtime ${pyScript} < input.txt 2>&1 | head -30
\`\`\`
Or for line-by-line profiling, install and use line_profiler:
\`\`\`bash
pip install line_profiler
kernprof -l -v ${pyScript}
\`\`\``;

        case 'cpp':
            // Extract executable name
            const exeMatch = cmd.match(/\.\/(\S+)/);
            const exe = exeMatch ? exeMatch[1] : 'program';
            return `
**PROFILING SUGGESTION (C++):**
1. Recompile with debug symbols: \`g++ -O2 -g -o ${exe} ${exe}.cpp\`
2. Run with perf:
\`\`\`bash
perf record -g ./${exe} < input.txt
perf report --sort=comm,dso,symbol
\`\`\`
Or use gprof:
\`\`\`bash
g++ -pg -O2 -o ${exe} ${exe}.cpp
./${exe} < input.txt
gprof ${exe} gmon.out | head -50
\`\`\``;

        default:
            return `
**PROFILING SUGGESTION:**
Consider using language-specific profiling tools:
- Python: \`python -m cProfile -s cumtime script.py\`
- C/C++: \`perf record -g ./program && perf report\`
- General: \`time ./program < input.txt\` to measure wall-clock time`;
    }
}

export async function runCmd(repoRoot: string, args: RunCmdArgs): Promise<{ exitCode: number; stdout: string; stderr: string; cwd: string; repoRoot: string; savedPaths?: { stdout?: string; stderr?: string }; error?: string }> {
    // Normalize CWD: strip absolute paths, default to project root
    let cwdArg = args.cwd || '.';
    if (cwdArg.startsWith('/')) {
        cwdArg = '.'; // Force to project root if absolute path detected
    }
    const cwd = path.resolve(repoRoot, cwdArg);

    // Security check: ensure CWD is within repoRoot
    if (!cwd.startsWith(path.resolve(repoRoot))) {
        return { exitCode: -1, stdout: "", stderr: "", cwd, repoRoot, error: "Access denied: CWD is outside repository root. Use relative paths like '.' or 'datapub'." };
    }

    return new Promise((resolve) => {
        const [command, ...cmdArgs] = args.cmd.split(' ');
        const child = spawn(command, cmdArgs, { cwd, shell: true });

        // Timeout after 20 seconds
        const TIMEOUT_MS = 20000;
        let timedOut = false;
        let waitingOnStdin = false;

        const timeoutId = setTimeout(() => {
            timedOut = true;

            // Check if waiting on stdin BEFORE killing
            if (child.pid) {
                waitingOnStdin = isWaitingOnStdin(child.pid);
            }

            child.kill('SIGKILL');
        }, TIMEOUT_MS);

        // Handle Ctrl+C (SIGINT)
        const sigintHandler = () => {
            console.log('\n[CLI] Caught SIGINT. Terminating child process...');
            child.kill('SIGINT');
        };
        process.on('SIGINT', sigintHandler);

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('error', (err) => {
            clearTimeout(timeoutId);
            process.off('SIGINT', sigintHandler);
            resolve({ exitCode: -1, stdout, stderr, cwd, repoRoot, error: err.message });
        });

        child.on('close', (code) => {
            clearTimeout(timeoutId);
            process.off('SIGINT', sigintHandler);

            // Truncate large outputs
            const stdoutResult = truncateLargeOutput(stdout, 'stdout', repoRoot);
            const stderrResult = truncateLargeOutput(stderr, 'stderr', repoRoot);

            const savedPaths: { stdout?: string; stderr?: string } = {};
            if (stdoutResult.savedPath) savedPaths.stdout = stdoutResult.savedPath;
            if (stderrResult.savedPath) savedPaths.stderr = stderrResult.savedPath;

            // Check if timed out
            if (timedOut) {
                const language = detectLanguage(args.cmd);
                let errorMsg: string;

                if (waitingOnStdin) {
                    // Process was waiting for input
                    errorMsg = `TIMEOUT: Command timed out after ${TIMEOUT_MS / 1000}s.
**DIAGNOSIS:** The program is WAITING FOR INPUT from stdin.
**FIX:** Use input redirection to provide input:
\`\`\`bash
${args.cmd} < input.txt
\`\`\`
Or pipe input directly:
\`\`\`bash
echo "your input" | ${args.cmd}
\`\`\``;
                } else {
                    // Process was computing (not waiting on stdin)
                    errorMsg = `TIMEOUT: Command timed out after ${TIMEOUT_MS / 1000}s.
**DIAGNOSIS:** The program is COMPUTING (not waiting for input). This suggests:
- An infinite loop
- Inefficient algorithm (high time complexity)
- Processing very large data

${getProfilingSuggestion(args.cmd, language)}`;
                }

                resolve({
                    exitCode: -1,
                    stdout: stdoutResult.truncated,
                    stderr: stderrResult.truncated,
                    cwd,
                    repoRoot,
                    error: errorMsg
                });
                return;
            }

            resolve({
                exitCode: code ?? -1,
                stdout: stdoutResult.truncated,
                stderr: stderrResult.truncated,
                cwd,
                repoRoot,
                ...(Object.keys(savedPaths).length > 0 ? { savedPaths } : {})
            });
        });
    });
}
