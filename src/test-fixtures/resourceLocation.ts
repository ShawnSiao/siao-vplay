import type { LocalResourceStatus } from "../types";
export const resourceLocationPlan = {
  planFingerprint: "a".repeat(64), selectedParent: "W:/fixture", resourceRoot: "W:/fixture/SiaoVPlay",
  parentExists: true, resourceRootExists: false, freeSpaceBytes: null, confirmationRequired: true,
};

export const locationResult = (status: LocalResourceStatus) => ({ ...status, bindingError: null, configurationFingerprint: "a".repeat(64), taskSnapshot: { generation: 1, tasks: [] } });
