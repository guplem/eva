/** Short times for lists, such as the chats of a clone. */

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "09:05" today, "Mon" in the last 6 days, "12 Oct" this year, and "2 Jan 2025" before. */
export function chatTime(iso: string, now: Date): string {
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return "";
  const startOfDay = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  // Rounded, because a day with a clock change is 23 or 25 hours long.
  const daysAgo = Math.round((startOfDay(now) - startOfDay(time)) / 86_400_000);
  if (daysAgo === 0) {
    return `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`;
  }
  if (daysAgo > 0 && daysAgo < 7) return weekdays[time.getDay()] ?? "";
  const dayAndMonth = `${String(time.getDate())} ${months[time.getMonth()] ?? ""}`;
  return time.getFullYear() === now.getFullYear() ? dayAndMonth : `${dayAndMonth} ${String(time.getFullYear())}`;
}
