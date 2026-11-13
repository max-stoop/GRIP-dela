/** Alleen een pad binnen deze site als doel na inloggen of een e-maillink, nooit een andere host. */
export function veiligeVolgende(next: string | null, standaard = '/'): string {
  if (!next) return standaard;
  if (!next.startsWith('/') || next.startsWith('//')) return standaard;
  if (next.includes('://') || next.includes('\\')) return standaard;
  return next;
}
