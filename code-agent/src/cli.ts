#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as readline from 'readline';
import * as path from 'path';
import * as fs from 'fs';
import { Pipeline, PipelineContext } from './pipeline/Pipeline';
import { AgentState } from './pipeline/AgentState';
import { ScanWorkspaceNode } from './nodes/ScanWorkspaceNode';
import { SelectFilesNode } from './nodes/SelectFilesNode';
import { AttachFilesNode } from './nodes/AttachFilesNode';
import { ExtractPlanNode } from './nodes/ExtractPlanNode';
import { ExecutePlanNode } from './nodes/ExecutePlanNode';
import { logger } from './utils/logger';

// Setup readline interface
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const askUser = (query: string, options?: { multiline?: boolean }): Promise<string> => {
    if (options?.multiline) {
        console.log(query);
        console.log('(Enter feedback, end with empty line or Ctrl+D)');
        return readMultilineInput(false); // pass false to skip initial prompt
    }
    return new Promise((resolve) => {
        rl.question(query, (answer) => {
            resolve(answer);
        });
    });
};

/**
 * Read multiline input until EOF (Ctrl+D) or empty line
 */
const readMultilineInput = (showPrompt = true): Promise<string> => {
    return new Promise((resolve) => {
        const lines: string[] = [];
        if (showPrompt) {
            console.log('Enter your task (end with empty line or Ctrl+D):');
            console.log('---');
        }

        const lineReader = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: false
        });

        lineReader.on('line', (line) => {
            if (line === '') {
                lineReader.close();
                resolve(lines.join('\n'));
            } else {
                lines.push(line);
            }
        });

        lineReader.on('close', () => {
            resolve(lines.join('\n'));
        });
    });
};

const context: PipelineContext = {
    logger: logger.log,
    askUser: askUser
};

// Helper to extract string from yargs argument (handles array case)
function getString(arg: string | string[] | undefined, defaultVal: string = ''): string {
    if (Array.isArray(arg)) {
        // Return the last element (standard CLI behavior: last flag wins)
        return arg[arg.length - 1] || defaultVal;
    }
    return arg || defaultVal;
}

async function main() {
    // DEBUG LOGGING
    console.log('[DEBUG] Raw process.argv:', process.argv);

    const argv = await yargs(hideBin(process.argv))
        .option('model', { type: 'string', demandOption: true, description: 'LM Studio model ID' })
        .option('base-url', { type: 'string', default: 'http://localhost:1234/v1', description: 'LM Studio Base URL' })
        .option('root', { type: 'string', default: process.cwd(), description: 'Repository root' })
        .option('verbose', { type: 'boolean', default: false })
        .option('task-file', {
            type: 'string',
            alias: 'f',
            description: 'Read task from a file instead of command line'
        })
        .option('allow-cmd', {
            type: 'string',
            description: 'Comma-separated list of allowed command prefixes (e.g. "python,ls")'
        })
        .command('$0 [task]', 'The coding task to perform', (yargs) => {
            return yargs.positional('task', {
                describe: 'The task description (optional if using --task-file or stdin)',
                type: 'string'
            });
        })
        .help()
        .argv;

    console.log('[DEBUG] Parsed argv:', JSON.stringify(argv, null, 2));

    // Handle root path - resolve to absolute path
    const repoRoot = path.resolve(getString(argv.root as string | string[], process.cwd()));

    // Determine the task from various sources
    let task: string;

    const taskFile = getString(argv['task-file'] as string | string[] | undefined);
    if (taskFile) {
        // Read from file
        const taskFilePath = path.resolve(taskFile);
        if (!fs.existsSync(taskFilePath)) {
            console.error(`Error: Task file not found: ${taskFilePath}`);
            process.exit(1);
        }
        task = fs.readFileSync(taskFilePath, 'utf-8').trim();
        logger.info(`[CLI] Task loaded from file: ${taskFilePath}`);
    } else if (argv.task) {
        // From positional argument
        task = argv.task as string;
    } else if (argv._[0]) {
        // Fallback to _[0]
        task = argv._[0] as string;
    } else {
        // Interactive multiline input
        task = await readMultilineInput();
        if (!task.trim()) {
            console.error('Error: No task provided');
            process.exit(1);
        }
    }

    if (argv.verbose) {
        logger.info(`[CLI] Task: ${task.substring(0, 100)}${task.length > 100 ? '...' : ''}`);
        logger.info(`[CLI] Root: ${repoRoot}`);
        logger.info(`[CLI] Model: ${argv.model}`);
    }

    const pipeline = Pipeline.create<AgentState, AgentState>("CodeAgent")
        .pipe(new ScanWorkspaceNode())
        .pipe(new SelectFilesNode())
        .pipe(new AttachFilesNode())
        .pipe(new ExtractPlanNode())
        .pipe(new ExecutePlanNode());

    const initialState: AgentState = {
        repoRoot,
        userTask: task,
        allFiles: [],
        selectedFiles: [],
        fileContents: new Map(),
        history: [],
        results: null,
        clientConfig: {
            baseUrl: getString(argv['base-url'] as string | string[], 'http://localhost:1234/v1'),
            model: getString(argv.model as string | string[]),
            verbose: argv.verbose as boolean,
            allowedCommands: getString(argv['allow-cmd'] as string | string[] | undefined).split(',').filter(c => c.trim().length > 0)
        }
    };


    try {
        const result = await pipeline.run(initialState, context);
        logger.info("Pipeline completed successfully.");
        if (result.results) {
            logger.info("\n=== Final Result ===");
            logger.info(JSON.stringify(result.results, null, 2));
        }
    } catch (error) {
        logger.error("Pipeline failed.");
        console.error(error);
    } finally {
        rl.close();
    }
}

main();
