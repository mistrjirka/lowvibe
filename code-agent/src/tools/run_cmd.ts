import { spawn } from 'child_process';
import * as path from 'path';
import { z } from 'zod';

export const RunCmdSchema = z.object({
    cmd: z.string(),
    cwd: z.string().optional()
});

export type RunCmdArgs = z.infer<typeof RunCmdSchema>;

export async function runCmd(repoRoot: string, args: RunCmdArgs): Promise<{ exitCode: number; stdout: string; stderr: string; cwd: string; repoRoot: string; error?: string }> {
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
            // Kill the child process (and its process group if possible, but basic kill is usually enough)
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
            process.off('SIGINT', sigintHandler); // Cleanup
            resolve({ exitCode: -1, stdout, stderr, cwd, repoRoot, error: err.message });
        });

        child.on('close', (code) => {
            process.off('SIGINT', sigintHandler); // Cleanup
            resolve({ exitCode: code ?? -1, stdout, stderr, cwd, repoRoot }); // Exit code might be null if killed
        });
    });
}
