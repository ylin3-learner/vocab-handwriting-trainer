export function calculateOverdueDays(
  nextReviewDate: string | null,
  now: Date
): number {
  if (!nextReviewDate) return 0;
  const nextDate = new Date(nextReviewDate);
  const diffMs = now.getTime() - nextDate.getTime();
  const days = diffMs / (24 * 60 * 60 * 1000);
  return Math.max(0, Math.floor(days));
}