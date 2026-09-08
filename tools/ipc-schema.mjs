// int64 is an annotation, while explicit safe bounds protect JS numeric precision.
// Reject schemas lacking these bounds instead of silently ignoring the format.
function normalizeIntegerFormats(value) {
  if (!value || typeof value !== "object") return;
  if (value.format === "int64") {
    if (value.type !== "integer" || !Number.isSafeInteger(value.minimum) || !Number.isSafeInteger(value.maximum)) {
      throw new Error("IPC int64 requires explicit JavaScript-safe integer bounds");
    }
    delete value.format;
  }
  for (const child of Object.values(value)) normalizeIntegerFormats(child);
}

export function prepareRuntimeSchema(schema) {
  const result = structuredClone(schema);
  delete result.examples;
  normalizeIntegerFormats(result);
  return result;
}
