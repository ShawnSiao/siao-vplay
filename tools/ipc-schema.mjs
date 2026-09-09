// int64 is an annotation, while explicit safe bounds protect JS numeric precision.
// Reject schemas lacking these bounds instead of silently ignoring the format.
function normalizeIntegerFormats(value) {
  if (!value || typeof value !== "object") return;
  if (["int64", "uint64", "uint32"].includes(value.format)) {
    const integerType = value.type === "integer" || (Array.isArray(value.type) && value.type.length === 2 && value.type.includes("integer") && value.type.includes("null"));
    if (!integerType || !Number.isSafeInteger(value.minimum) || !Number.isSafeInteger(value.maximum) || value.minimum > value.maximum || (value.format.startsWith("uint") && value.minimum < 0)) {
      throw new Error("IPC integer requires explicit JavaScript-safe integer bounds");
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
