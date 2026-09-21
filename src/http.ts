export function fetchWithTimeout(url: string): Promise<Response> {
    return globalThis.fetch(url, { signal: AbortSignal.timeout(12_000) })
}

export async function json<T>(url: string): Promise<T> {
    const response = await fetchWithTimeout(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`)
    return response.json() as Promise<T>
}
