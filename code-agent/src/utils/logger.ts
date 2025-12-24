// Simple ANSI color codes
const colors = {
    reset: "\x1b[0m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    gray: "\x1b[90m",
};

export const logger = {
    info: (msg: string) => console.log(`${colors.cyan}[INFO]${colors.reset} ${msg}`),
    error: (msg: string) => console.error(`${colors.red}[ERROR] ${msg}${colors.reset}`),
    log: (msg: string) => {
        // Auto-colorize known prefixes
        if (msg.startsWith('[Agent Step')) console.log(`${colors.magenta}${msg}${colors.reset}`);
        else if (msg.startsWith('[Agent Tool]')) console.log(`${colors.yellow}${msg}${colors.reset}`);
        else if (msg.startsWith('[Tool Result]')) console.log(`${colors.gray}${msg}${colors.reset}`);
        else if (msg.startsWith('[Agent Final]')) console.log(`${colors.green}${msg}${colors.reset}`);
        else if (msg.startsWith('[Agent]')) console.log(`${colors.cyan}[Agent]${colors.reset} ${msg.substring(7)}`);
        else console.log(msg);
    },
    // Raw helpers for other modules to use
    colors
};
