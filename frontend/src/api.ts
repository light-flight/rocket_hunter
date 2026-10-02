// One request to the JSON API, with a body sent as JSON. Callers branch on response.status.
// null means no answer at all (offline, timeout).
export async function api(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  timeoutMs = 10_000,
  body?: unknown,
): Promise<Response | null> {
  try {
    return await fetch(`/api${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    return null
  }
}
