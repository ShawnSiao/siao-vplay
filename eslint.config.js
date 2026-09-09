import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
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
    files: ["src/lib/*Gateway.ts", "src/lib/subtitleMetadata.ts", "src/lib/aiExecutionRequest.ts", "src/lib/subtitleBodyContract.ts", "src/lib/translationContract.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["**/features/**", "**/components/**", "**/desktop", "**/desktop.ts", "react", "react-dom", "react-dom/**"],
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
          group: ["**/components/**", "**/environment-settings/**", "**/playback/**", "**/desktop", "**/desktop.ts"],
          message: "Capability intent state receives resource status and actions; it must not depend on UI or the desktop facade."
        }]
      }]
    }
  }
);
