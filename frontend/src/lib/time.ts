export function greeting(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 5) return "Still up, Hunter.";
  if (hour < 12) return "Good morning, Hunter.";
  if (hour < 18) return "Good afternoon, Hunter.";
  return "Good evening, Hunter.";
}

const UNITS: [number, string][] = [
  [86_400, "day"],
  [3_600, "hour"],
  [60, "minute"],
];

export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  for (const [size, unit] of UNITS) {
    if (seconds >= size) {
      const count = Math.floor(seconds / size);
      return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
    }
  }
  return "just now";
}
