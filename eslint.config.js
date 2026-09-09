import { ipcImportRule } from "./tools/ipc-import-rule.mjs";
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    files: ["src/features/library/useLibrarySearch.ts", "src/features/library/useLibraryFolderScan.ts", "src/features/library/useLibraryFolderImport.ts", "src/features/library/useLibraryRecoveryPreview.ts", "src/features/library/useLibraryRecoveryApply.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["**/useLibraryController", "**/useLibraryController.*", "**/components/**", "**/desktop", "**/desktop.*", "@tauri-apps/**"],
          message: "Search lifecycle publishes narrow result actions; parent controller, UI and transport are outside its boundary."
        }]
      }]
    }
  },
  {
    ignores: ["dist", "coverage", "src-tauri/target"],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        {
          allowConstantExport: true
        }
      ]
    }
  },
  {
    files: ["src/lib/**/*.{ts,tsx}", "src/types.ts"],
    ignores: ["src/lib/**/*.{test,spec}.{ts,tsx}"],
    plugins: { architecture: { rules: { "ipc-imports": ipcImportRule } } },
    rules: {
      "architecture/ipc-imports": "error",
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["**/features/**", "**/components/**", "**/desktop", "**/desktop.*", "react", "react/**", "react-dom", "react-dom/**"],
          message: "IPC gateways depend on wire contracts and transport, not UI or the desktop facade."
        }]
      }]
    }
  },
  {
    files: ["src/features/resources/useCapabilityPreparation.ts", "src/features/resources/pendingResourceAction.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["**/components/**", "**/environment-settings/**", "**/playback/**", "**/desktop", "**/desktop.*"],
          message: "Capability intent state receives resource status and actions; it must not depend on UI or the desktop facade."
        }]
      }]
    }
  }
);
