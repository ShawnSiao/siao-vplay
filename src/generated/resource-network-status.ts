/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export type NetworkMode = "direct" | "proxy";
export type ProxySource = "custom" | "environment" | "windows_system" | "direct";

export interface ResourceNetworkStatus {
  mode: NetworkMode;
  proxyAddress: string | null;
  proxySource: ProxySource;
  [k: string]: unknown;
}
