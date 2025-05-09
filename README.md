# TS Cognilint

Extension based on (Cognitive-Complexity-TS)[https://github.com/Deskbot/Cognitive-Complexity-TS] inspired by (resharper-cognitivecomplexity)[https://github.com/matkoch/resharper-cognitivecomplexity] and (vscode-cognitive-complexity-show)[https://github.com/ampcpmgp/vscode-cognitive-complexity-show]

## Features

Calculates the Cognitive Complexity score for functions and methods in TypeScript and JavaScript files (`.js`, `.ts`, `.jsx`, `.tsx`) and displays scores exceeding configured thresholds as standard VS Code Diagnostics.

This means:

*   Functions with complexity scores above the `warningThreshold` will be marked as **Warnings** (typically with a yellow squiggle underline) in the editor.
*   Functions with complexity scores above the `errorThreshold` will be marked as **Errors** (typically with a red squiggle underline) in the editor.
*   The complexity score (e.g., "Cognitive Complexity: 12") will appear in the **Problems** panel (View > Problems).
*   When you hover over the function name, the complexity score will be shown in the standard hover tooltip, **integrated with any other diagnostics** from linters (like ESLint) or the TypeScript language server.

The analysis runs automatically when you open or edit supported files.

## Configuration

You can customize the behavior in VS Code Settings under "tsCognilint":

*   `tsCognilint.enabled`: Enable or disable the extension (default: `true`).
*   `tsCognilint.warningThreshold`: Complexity above this value triggers a `Warning` diagnostic (default: `10`). Complexity below this value is currently ignored.
*   `tsCognilint.errorThreshold`: Complexity above this value triggers a `Error` diagnostic (default: `20`).