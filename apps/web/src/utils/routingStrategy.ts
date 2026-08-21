export type RoutingStrategy = 'round-robin' | 'weighted-round-robin' | 'fill-first';

export const normalizeRoutingStrategy = (value: unknown): RoutingStrategy | undefined => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();

  if (['round-robin', 'roundrobin', 'rr'].includes(normalized)) return 'round-robin';
  if (['weighted-round-robin', 'weightedroundrobin', 'wrr'].includes(normalized)) {
    return 'weighted-round-robin';
  }
  if (['fill-first', 'fillfirst', 'ff'].includes(normalized)) return 'fill-first';
  return undefined;
};
