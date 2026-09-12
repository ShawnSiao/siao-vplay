export type PendingResourceAction = {
  id: string;
  capabilityId: string;
  label: string;
  profileId?: "fast" | "standard";
};
