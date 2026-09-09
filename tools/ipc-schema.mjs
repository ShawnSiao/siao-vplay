// int64 is an annotation, while explicit safe bounds protect JS numeric precision.
// Reject schemas lacking these bounds instead of silently ignoring the format.
function normalizeNumericFormats(value) {
  if (!value || typeof value !== "object") return;
  if (["int64", "uint64", "uint32", "uint"].includes(value.format)) {
    const integerType = value.type === "integer" || (Array.isArray(value.type) && value.type.length === 2 && value.type.includes("integer") && value.type.includes("null"));
    if (!integerType || !Number.isSafeInteger(value.minimum) || !Number.isSafeInteger(value.maximum) || value.minimum > value.maximum || (value.format.startsWith("uint") && value.minimum < 0)) {
      throw new Error("IPC integer requires explicit JavaScript-safe integer bounds");
    }
    delete value.format;
  }
  if (value.format === "double") {
    if (value.type !== "number" || !Number.isFinite(value.minimum) || !Number.isFinite(value.maximum) || value.minimum > value.maximum) {
      throw new Error("IPC double requires explicit finite numeric bounds");
    }
    delete value.format;
  }
  for (const child of Object.values(value)) normalizeNumericFormats(child);
}

export function prepareRuntimeSchema(schema) {
  const result = structuredClone(schema);
  delete result.examples;
  normalizeNumericFormats(result);
  return result;
}
