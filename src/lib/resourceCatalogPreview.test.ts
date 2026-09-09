import { expect, it } from "vitest";
import schema from "../../contracts/local-resource-catalog.schema.json";
import validate from "../generated/local-resource-catalog.validator.mjs";
import { getBrowserResourceCatalog } from "./resourceCatalogPreview";

it("uses the same complete wire catalogue serialized by Rust", () => {
  const catalog = getBrowserResourceCatalog();
  expect(validate(catalog)).toBe(true);
  expect(catalog).toEqual(schema.examples[0]);
});
it("does not share mutable preview data between consumers", () => {
  const baseline = getBrowserResourceCatalog();
  const changed = getBrowserResourceCatalog();
  changed.resources[0].entrypoints.tool = "changed";
  changed.capabilities[0].resourceIds.push("changed");
  changed.profiles[0].resourceIds.push("changed");
  const profileCapability = changed.capabilities.find(capability => capability.profileIds.length > 0);
  profileCapability?.profileIds.push("changed");
  expect(getBrowserResourceCatalog()).toEqual(baseline);
});
