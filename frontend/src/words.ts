// The Russian word for a count: 1 протокол, 3 протокола, 5 протоколов, 21 протокол.
export function plural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100
  const units = count % 10
  if (tens >= 11 && tens <= 14) return many
  if (units === 1) return one
  if (units >= 2 && units <= 4) return few
  return many
}
