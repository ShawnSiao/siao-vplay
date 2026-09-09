// Static imports and re-exports use no-restricted-imports. This covers the
// TypeScript inline type and JavaScript dynamic forms that rule does not inspect.
export const ipcImportRule = {
  meta: { type: "problem", schema: [], messages: {
    forbidden: "IPC contracts must not depend on UI, feature modules, React, or the desktop facade.",
    computed: "IPC imports must use a literal path so their dependency direction can be checked.",
  } },
  create(context) {
    function check(node) {
      const source = node.source?.value;
      if (typeof source !== "string") { context.report({ node, messageId: "computed" }); return; }
      if (source === "react" || source.startsWith("react/") || source === "react-dom" || source.startsWith("react-dom/") ||
        /(?:^|\/)(?:features|components)\//.test(source) || /(?:^|\/)desktop(?:\.[cm]?[jt]sx?)?$/.test(source)) {
        context.report({ node, messageId: "forbidden" });
      }
    }
    return { TSImportType: check, ImportExpression: check };
  },
};
