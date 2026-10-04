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

// Sends a file: the body is multipart, so the browser sets its own Content-Type. onSent hears the
// part of it gone, from 0 to 1: fetch cannot tell that, so the file goes by XMLHttpRequest.
export function upload(
  path: string,
  form: FormData,
  onSent?: (part: number) => void,
  timeoutMs = 90_000,
): Promise<Response | null> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest()
    request.open('PUT', `/api${path}`)
    request.setRequestHeader('Accept', 'application/json')
    request.timeout = timeoutMs
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onSent?.(event.loaded / event.total)
    }
    request.onload = () => {
      try {
        resolve(
          new Response([204, 205, 304].includes(request.status) ? null : request.responseText, {
            status: request.status,
            headers: { 'Content-Type': request.getResponseHeader('Content-Type') ?? 'text/plain' },
          }),
        )
      } catch {
        // A status a Response cannot have.
        resolve(null)
      }
    }
    request.onerror = request.ontimeout = request.onabort = () => resolve(null)
    request.send(form)
  })
}
