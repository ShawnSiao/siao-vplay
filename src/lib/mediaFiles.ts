export const supportedVideoExtensions = [
  "mp4",
  "mkv",
  "mov",
  "webm",
  "avi",
  "m4v",
  "ts",
  "mts",
  "m2ts",
] as const;

const supportedVideoExtensionSet = new Set<string>(supportedVideoExtensions);

export function isSupportedVideoPath(path: string): boolean {
  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const fileName = path.slice(separatorIndex + 1);
  const extensionIndex = fileName.lastIndexOf(".");
  if (extensionIndex <= 0 || extensionIndex === fileName.length - 1) {
    return false;
  }
  return supportedVideoExtensionSet.has(
    fileName.slice(extensionIndex + 1).toLocaleLowerCase("en-US"),
  );
}
