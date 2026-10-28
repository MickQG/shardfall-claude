/**
 * Which queue indices to cancel: the newest `count` items of `kind`, highest index first,
 * so earlier indices stay valid while the commands are applied in order (the head keeps its progress).
 */
export function cancelPlan(queue: readonly { kind: string }[], kind: string, count: number): number[] {
  const out: number[] = [];
  for (let i = queue.length - 1; i >= 0 && out.length < count; i--) if (queue[i]?.kind === kind) out.push(i);
  return out;
}
