import { strict as assert } from "node:assert";
import { test } from "node:test";
import { prepareRuntimeSchema } from "./ipc-schema.mjs";

test("normalizes Rust bytes only when their integer bounds remain within 0..255", () => {
  const field = { type: "integer", format: "uint8", minimum: 0, maximum: 255 };
  assert.deepEqual(prepareRuntimeSchema(field), { type: "integer", minimum: 0, maximum: 255 });
  for (const patch of [{ minimum: -1 }, { maximum: 256 }, { maximum: undefined }, { type: "number" }]) {
    assert.throws(() => prepareRuntimeSchema({ ...field, ...patch }), /byte bounds/);
  }
});

test("preserves nullable integer types while requiring numeric bounds", () => {
  const field = { type: ["integer", "null"], format: "uint64", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
  assert.deepEqual(prepareRuntimeSchema(field), { type: ["integer", "null"], minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
  assert.throws(() => prepareRuntimeSchema({ ...field, type: ["integer", "string"] }), /safe integer bounds/);
});

test("normalizes explicitly bounded unsigned wire integers", () => {
  for (const format of ["uint32", "uint64", "uint"]) {
    assert.deepEqual(prepareRuntimeSchema({ type: "integer", format, minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
      { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
    assert.throws(() => prepareRuntimeSchema({ type: "integer", format, minimum: 0 }), /safe integer bounds/);
    assert.throws(() => prepareRuntimeSchema({ type: "integer", format, minimum: -1, maximum: 100 }), /safe integer bounds/);
  }
});

test("keeps integer bounds and original schema while removing build-only examples", () => {
  const schema = { examples: [{ value: 1 }], properties: { value: { type: "integer", format: "int64", minimum: 1, maximum: Number.MAX_SAFE_INTEGER } } };
  const output = prepareRuntimeSchema(schema);
  assert.deepEqual(output, { properties: { value: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER } } });
  assert.equal(schema.properties.value.format, "int64");
  assert.equal(schema.examples.length, 1);
});
for (const field of [
  { type: "integer", format: "int64" },
  { type: "integer", format: "int64", minimum: 0, maximum: Number.MAX_SAFE_INTEGER + 1 },
  { type: "number", format: "int64", minimum: 0, maximum: 10 },
]) {
  test(`rejects imprecise integer schema ${JSON.stringify(field)}`, () => {
    assert.throws(() => prepareRuntimeSchema({ properties: { value: field } }), /safe integer bounds/);
  });
}

test("normalizes bounded Rust doubles without weakening numeric validation", () => {
  const field = { type: "number", format: "double", minimum: 0, maximum: 1 };
  assert.deepEqual(prepareRuntimeSchema(field), { type: "number", minimum: 0, maximum: 1 });
  assert.equal(field.format, "double");
  for (const patch of [{ minimum: undefined }, { maximum: Infinity }, { type: "string" }, { minimum: 2 }]) {
    assert.throws(() => prepareRuntimeSchema({ ...field, ...patch }), /finite numeric bounds/);
  }
});

test("retains nullable double shape and rejects nonnumeric alternatives", () => {
  const field = { type: ["number", "null"], format: "double", minimum: 0, maximum: 1 };
  assert.deepEqual(prepareRuntimeSchema(field), { type: ["number", "null"], minimum: 0, maximum: 1 });
  assert.throws(() => prepareRuntimeSchema({ ...field, type: ["number", "string"] }), /finite numeric bounds/);
});
