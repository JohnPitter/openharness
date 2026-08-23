/**
 * Best-effort human-readable message from an arbitrary thrown value.
 * `Error` instances use `.message`; objects with a string `message` use it;
 * objects with a string `kind` (the agent cancel cause) render that kind,
 * plus an optional string `reason`; everything else is stringified. A hostile
 * value that traps `instanceof`, property access, or coercion falls back to a
 * fixed unprintable marker so error normalization stays total.
 * @param error - thrown value or abort reason.
 * @returns a printable message, never `[object Object]`.
 */
export function formatThrownMessage(error: unknown): string {
  try {
    if (error instanceof Error) return error.message
    if (typeof error === 'string') return error
    if (typeof error === 'object' && error !== null) {
      if ('message' in error && typeof error.message === 'string') return error.message
      if ('kind' in error && typeof error.kind === 'string') {
        return 'reason' in error && typeof error.reason === 'string' && error.reason !== ''
          ? `${error.kind}: ${error.reason}`
          : error.kind
      }
      const json = JSON.stringify(error)
      if (typeof json === 'string' && json !== '{}' && json !== 'null') return json
    }
    const text = String(error)
    return text === '[object Object]' ? 'aborted' : text
  } catch {
    // A hostile thrown value can trap `instanceof`, property access, or string
    // coercion. Error normalization is the outermost safety boundary, so its
    // fallback must itself be total.
    return '<unprintable thrown value>'
  }
}
