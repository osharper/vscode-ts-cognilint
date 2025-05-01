import * as vscode from 'vscode';
import { getFileOutput } from 'cognitive-complexity-ts';

// Diagnostic collection to manage complexity issues
let diagnosticCollection: vscode.DiagnosticCollection;

// Store complexity scores per document temporarily
const complexityScores: Map<string, Map<string, number>> = new Map();

// Debounce timer map per document
const debounceTimers: Map<string, NodeJS.Timeout> = new Map();

// Type for complexity items
interface ComplexityItem {
    score?: number;
    line?: number;
    inner?: ComplexityItem[];
}

/**
 * Activate the extension
 * @param context The extension context
 */
export function activate(context: vscode.ExtensionContext): void {
    // Create diagnostic collection
    diagnosticCollection = vscode.languages.createDiagnosticCollection("tsCognilint");
    context.subscriptions.push(diagnosticCollection);

    let config = vscode.workspace.getConfiguration('tsCognilint');

    // Update diagnostics when configuration changes
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('tsCognilint')) {
            config = vscode.workspace.getConfiguration('tsCognilint');
            // Re-process all visible editors
            vscode.window.visibleTextEditors.forEach(editor => {
                if (editor.document) {
                    processActiveFile(editor.document);
                }
            });
        }
    }));

    // Process active/visible editors on change/open
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(ev => processActiveFile(ev.document)));
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor?.document) {
            processActiveFile(editor.document);
        }
    }));
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(doc => {
        // Clear diagnostics when a document is closed
        diagnosticCollection.delete(doc.uri);
        complexityScores.delete(doc.uri.toString());
        const timer = debounceTimers.get(doc.uri.toString());
        if (timer) {
            clearTimeout(timer);
            debounceTimers.delete(doc.uri.toString());
        }
    }));

    // Process initially visible editors
    vscode.window.visibleTextEditors.forEach(editor => {
        if (editor.document) {
            processActiveFile(editor.document);
        }
    });

    // Ensure cleanup on activation if extension was previously active
    diagnosticCollection.clear();
    complexityScores.clear();
}

/**
 * Recursively sum scores in nested structures.
 * @param inner Array of complexity items
 * @returns The sum of scores
 */
function getScoreSum(inner: ComplexityItem[]): number {
    return inner.reduce((acc, item) => {
        const sum = getScoreSum(item.inner || []);
        return acc + (item.score || 0) + sum;
    }, 0);
}

/**
 * Flatten the complexity tree and adjust scores.
 * @param inner Array of complexity items
 * @returns Flattened array of complexity items with adjusted scores
 */
function flattenInner(inner: ComplexityItem[]): ComplexityItem[] {
    return (inner || []).reduce((acc: ComplexityItem[], item) => {
        const nestedFlattened = flattenInner(item.inner || []);
        const adjustedScore = (item.score || 0) - getScoreSum(item.inner || []);
        if (adjustedScore > 0 && item.line) {
            acc.push({ ...item, score: adjustedScore });
        }
        return acc.concat(nestedFlattened);
    }, []);
}

/**
 * Analyze the document for cognitive complexity and update diagnostics.
 * @param document The text document to process
 */
async function processActiveFile(document: vscode.TextDocument | undefined): Promise<void> {
    if (!document || !isSupportedLanguage(document)) {
        // If a document becomes unsupported or closed, clear its diagnostics
        if (document) {
            diagnosticCollection.delete(document.uri);
            complexityScores.delete(document.uri.toString());
        }
        return;
    }

    const config = vscode.workspace.getConfiguration('tsCognilint');
    const docUriString = document.uri.toString();

    if (!config.get<boolean>('enabled', true)) {
        // If disabled, clear diagnostics for this document and return
        diagnosticCollection.delete(document.uri);
        complexityScores.delete(docUriString);
        return;
    }

    // Debounce analysis to avoid excessive processing during typing
    if (debounceTimers.has(docUriString)) {
        clearTimeout(debounceTimers.get(docUriString)!);
    }

    debounceTimers.set(docUriString, setTimeout(async () => {
        debounceTimers.delete(docUriString);

        // Thresholds from configuration
        const warningThreshold = config.get<number>('warningThreshold', 10);
        const errorThreshold = config.get<number>('errorThreshold', 20);

        const diagnostics: vscode.Diagnostic[] = [];
        const currentScores: Map<string, number> = new Map(); // Store scores for this run

        try {
            // 1. Get complexity scores
            const output = await getFileOutput(document.fileName);
            const complexityItems = flattenInner(output.inner as ComplexityItem[]);

            // 2. Get document symbols
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                document.uri
            );
            const functionSymbols = filterFunctionSymbols(symbols || []);

            // 3. Match complexity items with symbols and create diagnostics
            complexityItems.forEach(item => {
                const symbol = functionSymbols.find(
                    s => s.selectionRange.start.line === (item.line || 0) - 1,
                );
                if (!symbol || item.score === undefined) return;

                const range = symbol.selectionRange;
                const score = item.score;
                currentScores.set(rangeToString(range), score); // Store score keyed by range string

                // Determine severity based on score
                let severity: vscode.DiagnosticSeverity | null = null;
                if (score > errorThreshold) {
                    severity = vscode.DiagnosticSeverity.Error; // Use Error for > errorThreshold
                } else if (score > warningThreshold) {
                    severity = vscode.DiagnosticSeverity.Warning; // Use Warning for > warningThreshold
                } else if (score > 0) { // Optionally show scores > 0 but <= warningThreshold as Info
                    // severity = vscode.DiagnosticSeverity.Information;
                }

                // Only create diagnostic if severity is set (i.e., above threshold)
                if (severity !== null) {
                    const diagnostic = new vscode.Diagnostic(
                        range,
                        `Cognitive Complexity: ${score}`,
                        severity
                    );
                    diagnostic.severity = severity;
                    diagnostic.source = 'tsCognilint';
                    diagnostics.push(diagnostic);
                }
            });

            // Store the calculated scores for hover provider
            complexityScores.set(docUriString, currentScores);

            // 4. Update the diagnostic collection for this document
            diagnosticCollection.set(document.uri, diagnostics);

        } catch (error) {
            console.error("tsCognilint: Error processing cognitive complexity:", error);
            // Clear scores and diagnostics for this doc on error to avoid stale data
            complexityScores.delete(docUriString);
            diagnosticCollection.delete(document.uri);
        }
    }, 300)); // 300ms debounce delay
}

/**
 * Convert a range object to a string key.
 * @param range The range to convert
 * @returns A string representation of the range
 */
function rangeToString(range: vscode.Range): string {
    return `${range.start.line},${range.start.character}-${range.end.line},${range.end.character}`;
}

/**
 * Recursively filter symbols to find functions and methods.
 * @param symbols The symbols to filter
 * @returns An array of function symbols
 */
function filterFunctionSymbols(symbols: vscode.DocumentSymbol[]): vscode.DocumentSymbol[] {
    let functions: vscode.DocumentSymbol[] = [];
    for (const symbol of symbols) {
        // Include functions, methods, constructors, and potentially classes if desired
        if ([vscode.SymbolKind.Function, vscode.SymbolKind.Method, vscode.SymbolKind.Constructor].includes(symbol.kind)) {
            functions.push(symbol);
        }
        if (symbol.children && symbol.children.length > 0) {
            functions = functions.concat(filterFunctionSymbols(symbol.children));
        }
    }
    return functions;
}

/**
 * Check if the document language is supported.
 * @param document The document to check
 * @returns Whether the language is supported
 */
function isSupportedLanguage(document: vscode.TextDocument): boolean {
    switch (document.languageId) {
        case "typescript":
        case "typescriptreact":
        case "javascript":
        case "javascriptreact":
            return true;
        default:
            return false;
    }
}

// Cleanup function when the extension is deactivated
export function deactivate(): void {
    // Clear and dispose the diagnostic collection
    diagnosticCollection?.clear();
    diagnosticCollection?.dispose();
    complexityScores.clear();
    // Clear any pending timers
    debounceTimers.forEach(timer => clearTimeout(timer));
    debounceTimers.clear();
}