import { spawn } from 'child_process';
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

export async function runCmd(repoRoot: string, args: RunCmdArgs): Promise<{ exitCode: number; stdout: string; stderr: string; cwd: string; repoRoot: string; savedPaths?: { stdout?: string; stderr?: string }; error?: string }> {
    const cwd = args.cwd ? path.resolve(repoRoot, args.cwd) : repoRoot;

    // Simple security check (imperfect, but basic)
    if (!cwd.startsWith(path.resolve(repoRoot))) {
        return { exitCode: -1, stdout: "", stderr: "", cwd, repoRoot, error: "Access denied: Cwd is outside repository root" };
    }

    return new Promise((resolve) => {
        const [command, ...cmdArgs] = args.cmd.split(' ');
        const child = spawn(command, cmdArgs, { cwd, shell: true });

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
            process.off('SIGINT', sigintHandler);
            resolve({ exitCode: -1, stdout, stderr, cwd, repoRoot, error: err.message });
        });

        child.on('close', (code) => {
            process.off('SIGINT', sigintHandler);

            // Truncate large outputs
            const stdoutResult = truncateLargeOutput(stdout, 'stdout', repoRoot);
            const stderrResult = truncateLargeOutput(stderr, 'stderr', repoRoot);

            const savedPaths: { stdout?: string; stderr?: string } = {};
            if (stdoutResult.savedPath) savedPaths.stdout = stdoutResult.savedPath;
            if (stderrResult.savedPath) savedPaths.stderr = stderrResult.savedPath;

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

