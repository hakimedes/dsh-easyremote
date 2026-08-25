export function nextStreamingTextLength(current: number, target: number) {
  if (current >= target) return target;
  const remaining = target - current;
  const batch = remaining > 240 ? 24 : remaining > 80 ? 10 : remaining > 20 ? 4 : 2;
  return Math.min(target, current + batch);
}
