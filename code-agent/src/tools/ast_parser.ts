import * as path from 'path';

// Lazy-load tree-sitter to avoid native module crash in Electron
let Parser: any = null;
let Python: any = null;
let Cpp: any = null;
let pythonParser: any = null;
let cppParser: any = null;
let treeSitterLoaded = false;

function ensureTreeSitterLoaded(): void {
    if (treeSitterLoaded) return;
    try {
        Parser = require('tree-sitter');
        Python = require('tree-sitter-python');
        Cpp = require('tree-sitter-cpp');

        pythonParser = new Parser();
        pythonParser.setLanguage(Python);

        cppParser = new Parser();
        cppParser.setLanguage(Cpp);

        treeSitterLoaded = true;
    } catch (err) {
        throw new Error(`Failed to load tree-sitter: ${err}. AST tools require tree-sitter native modules.`);
    }
}

export interface OutlineItem {
    type: 'class' | 'function' | 'method' | 'variable' | 'logic';
    name: string;
    line: number;
    endLine: number;
    children?: OutlineItem[];
}

export interface FileOutline {
    path: string;
    language: 'python' | 'cpp' | 'unknown';
    outline: OutlineItem[];
    allNames: string[];
}

/**
 * Detect language from file extension
 */
export function detectLanguage(filePath: string): 'python' | 'cpp' | 'unknown' {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.py') return 'python';
    if (['.cpp', '.cc', '.cxx', '.c', '.h', '.hpp'].includes(ext)) return 'cpp';
    return 'unknown';
}

/**
 * Parse file content and return AST tree
 */
export function parseFile(content: string, language: 'python' | 'cpp'): any {
    ensureTreeSitterLoaded();
    const parser = language === 'python' ? pythonParser : cppParser;
    return parser.parse(content);
}

/**
 * Extract outline from Python AST
 */
function extractPythonOutline(tree: any, content: string): OutlineItem[] {
    const outline: OutlineItem[] = [];
    const lines = content.split('\n');

    function visit(node: any, parent?: OutlineItem): void {
        if (node.type === 'class_definition') {
            const nameNode = node.childForFieldName('name');
            const item: OutlineItem = {
                type: 'class',
                name: nameNode?.text || 'unknown',
                line: node.startPosition.row + 1,
                endLine: node.endPosition.row + 1,
                children: []
            };
            if (parent?.children) {
                parent.children.push(item);
            } else {
                outline.push(item);
            }
            // Visit children with this as parent
            for (const child of node.children) {
                visit(child, item);
            }
        } else if (node.type === 'function_definition') {
            const nameNode = node.childForFieldName('name');
            const item: OutlineItem = {
                type: parent ? 'method' : 'function',
                name: nameNode?.text || 'unknown',
                line: node.startPosition.row + 1,
                endLine: node.endPosition.row + 1
            };
            if (parent?.children) {
                parent.children.push(item);
            } else {
                outline.push(item);
            }
        } else if (node.type === 'expression_statement' && node.parent?.type === 'module') {
            // Top-level assignment (global variable)
            const assignment = node.firstChild;
            if (assignment?.type === 'assignment') {
                const left = assignment.childForFieldName('left');
                if (left?.type === 'identifier') {
                    outline.push({
                        type: 'variable',
                        name: left.text,
                        line: node.startPosition.row + 1,
                        endLine: node.endPosition.row + 1
                    });
                }
            }
        } else if (['if_statement', 'for_statement', 'while_statement', 'try_statement', 'with_statement'].includes(node.type) && node.parent?.type === 'module') {
            // Top-level logic blocks
            outline.push({
                type: 'logic',
                name: node.type.replace('_statement', ''),
                line: node.startPosition.row + 1,
                endLine: node.endPosition.row + 1
            });

            // Continue traversing to find nested classes/functions
            for (const child of node.children) {
                visit(child, parent);
            }
        } else {
            // Continue traversing
            for (const child of node.children) {
                visit(child, parent);
            }
        }
    }

    visit(tree.rootNode);
    return outline;
}

/**
 * Extract outline from C++ AST
 */
function extractCppOutline(tree: any, content: string): OutlineItem[] {
    const outline: OutlineItem[] = [];

    function visit(node: any, parent?: OutlineItem): void {
        if (node.type === 'class_specifier' || node.type === 'struct_specifier') {
            const nameNode = node.childForFieldName('name');
            const item: OutlineItem = {
                type: 'class',
                name: nameNode?.text || 'anonymous',
                line: node.startPosition.row + 1,
                endLine: node.endPosition.row + 1,
                children: []
            };
            if (parent?.children) {
                parent.children.push(item);
            } else {
                outline.push(item);
            }
            for (const child of node.children) {
                visit(child, item);
            }
        } else if (node.type === 'function_definition') {
            const declarator = node.childForFieldName('declarator');
            let name = 'unknown';
            // Navigate to find the function name
            if (declarator) {
                const nameNode = declarator.descendantsOfType('identifier')[0] ||
                    declarator.descendantsOfType('field_identifier')[0];
                if (nameNode) name = nameNode.text;
            }
            const item: OutlineItem = {
                type: parent ? 'method' : 'function',
                name,
                line: node.startPosition.row + 1,
                endLine: node.endPosition.row + 1
            };
            if (parent?.children) {
                parent.children.push(item);
            } else {
                outline.push(item);
            }
        } else if (node.type === 'declaration' && node.parent?.type === 'translation_unit') {
            // Global variable
            const declarator = node.childForFieldName('declarator');
            if (declarator) {
                const nameNode = declarator.descendantsOfType('identifier')[0];
                if (nameNode) {
                    outline.push({
                        type: 'variable',
                        name: nameNode.text,
                        line: node.startPosition.row + 1,
                        endLine: node.endPosition.row + 1
                    });
                }
            }
        } else {
            for (const child of node.children) {
                visit(child, parent);
            }
        }
    }

    visit(tree.rootNode);
    return outline;
}

/**
 * Get file outline with nested structure
 */
export function getOutline(content: string, language: 'python' | 'cpp'): OutlineItem[] {
    const tree = parseFile(content, language);
    return language === 'python'
        ? extractPythonOutline(tree, content)
        : extractCppOutline(tree, content);
}

/**
 * Collect all names from outline (flattened) for strict schema validation
 */
export function collectAllNames(outline: OutlineItem[]): string[] {
    const names: string[] = [];
    function collect(items: OutlineItem[]): void {
        for (const item of items) {
            names.push(item.name);
            if (item.children) {
                collect(item.children);
            }
        }
    }
    collect(outline);
    return names;
}

/**
 * Find an item in the outline by name
 */
export function findByName(outline: OutlineItem[], name: string): OutlineItem | null {
    for (const item of outline) {
        if (item.name === name) return item;
        if (item.children) {
            const found = findByName(item.children, name);
            if (found) return found;
        }
    }
    return null;
}

/**
 * Information about a function call
 */
export interface FunctionCallInfo {
    /** Name of the called function */
    calledFunction: string;
    /** Qualified name of the calling context (e.g., ClassName.method or standalone function) */
    callerContext: string;
    /** Line number of the call */
    line: number;
}

/**
 * Find all function calls in a file
 * Returns list of { calledFunction, callerContext, line }
 */
export function findFunctionCalls(content: string, language: 'python' | 'cpp'): FunctionCallInfo[] {
    ensureTreeSitterLoaded();
    const tree = parseFile(content, language);
    const calls: FunctionCallInfo[] = [];

    // Build a map of line -> enclosing function/method name
    const outline = getOutline(content, language);
    const lineToContext = buildLineToContextMap(outline);

    function visit(node: any): void {
        if (language === 'python' && node.type === 'call') {
            const funcNode = node.childForFieldName('function');
            let calledName = '';

            if (funcNode?.type === 'identifier') {
                calledName = funcNode.text;
            } else if (funcNode?.type === 'attribute') {
                // method call like obj.method()
                const attrNode = funcNode.childForFieldName('attribute');
                calledName = attrNode?.text || '';
            }

            if (calledName) {
                const line = node.startPosition.row + 1;
                calls.push({
                    calledFunction: calledName,
                    callerContext: lineToContext.get(line) || '<module>',
                    line
                });
            }
        } else if (language === 'cpp' && node.type === 'call_expression') {
            const funcNode = node.childForFieldName('function');
            let calledName = '';

            if (funcNode?.type === 'identifier') {
                calledName = funcNode.text;
            } else if (funcNode?.type === 'field_expression') {
                const fieldNode = funcNode.childForFieldName('field');
                calledName = fieldNode?.text || '';
            }

            if (calledName) {
                const line = node.startPosition.row + 1;
                calls.push({
                    calledFunction: calledName,
                    callerContext: lineToContext.get(line) || '<global>',
                    line
                });
            }
        }

        // Recurse
        for (const child of node.children || []) {
            visit(child);
        }
    }

    visit(tree.rootNode);
    return calls;
}

/**
 * Build a map of line number -> enclosing function/class.method context
 */
function buildLineToContextMap(outline: OutlineItem[], prefix = ''): Map<number, string> {
    const map = new Map<number, string>();

    for (const item of outline) {
        const qualifiedName = prefix ? `${prefix}.${item.name}` : item.name;

        if (item.type === 'function' || item.type === 'method') {
            for (let line = item.line; line <= item.endLine; line++) {
                map.set(line, qualifiedName);
            }
        }

        if (item.children) {
            const childMap = buildLineToContextMap(item.children, item.type === 'class' ? item.name : qualifiedName);
            childMap.forEach((v, k) => map.set(k, v));
        }
    }

    return map;
}
