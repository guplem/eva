/** The choices of a select of minutes. A value set by hand, such as 45, shows too, in its place. */
export function minuteChoices(presets: readonly number[], current: number): { value: string; label: string }[] {
  const minutes = presets.includes(current) ? presets : [...presets, current].sort((a, b) => a - b);
  return minutes.map((value) => ({ value: String(value), label: minutesLabel(value) }));
}

/** The choices of a time to answer a permission or a question (#938). The core takes 1 minute to 12 hours. */
const answerWaitMinutes: readonly number[] = [5, 10, 30, 60, 240, 720];

export function answerWaitChoices(current: number | null): { value: string; label: string }[] {
  const noLimit = { value: "null", label: "No limit" };
  return [noLimit, ...minuteChoices(answerWaitMinutes, current ?? answerWaitMinutes[0] ?? 5)];
}

function minutesLabel(minutes: number): string {
  if (minutes % 60 !== 0) return minutes === 1 ? "1 minute" : `${String(minutes)} minutes`;
  const hours = minutes / 60;
  if (hours % 24 === 0) return hours === 24 ? "1 day" : `${String(hours / 24)} days`;
  return hours === 1 ? "1 hour" : `${String(hours)} hours`;
}
