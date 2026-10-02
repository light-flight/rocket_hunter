// One request to the JSON API. Callers branch on response.status.
// null means no answer at all (offline, timeout).
export async function api(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  timeoutMs = 10_000,
): Promise<Response | null> {
  try {
    return await fetch(`/api${path}`, {
      method,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    return null
  }
}
