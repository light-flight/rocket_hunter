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

// Sends a file: the body is multipart, so the browser sets its own Content-Type.
export async function upload(path: string, form: FormData, timeoutMs = 90_000): Promise<Response | null> {
  try {
    return await fetch(`/api${path}`, {
      method: 'PUT',
      headers: { Accept: 'application/json' },
      body: form,
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    return null
  }
}
