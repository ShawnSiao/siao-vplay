export function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null || !Number.isFinite(milliseconds)) {
    return "时长未知";
  }
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return [hours, minutes, seconds]
      .map((value) => String(value).padStart(2, "0"))
      .join(":");
  }
  return [minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

export function formatFileSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) {
    return "大小未知";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1_024 && unitIndex < units.length - 1) {
    value /= 1_024;
    unitIndex += 1;
  }
  const digits = unitIndex === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

export function formatRecentTime(timestampMs: number): string {
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) {
    return "最近打开";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function fileExtension(name: string): string {
  const extension = name.split(".").pop()?.trim();
  return extension && extension !== name ? extension.toUpperCase() : "VIDEO";
}
