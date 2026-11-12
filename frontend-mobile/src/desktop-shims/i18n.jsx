// Stand-in for the desktop translation layer used by the shared TCG card
// faces. Mobile is English-only, so text passes straight through.
export function LocalizedText({ text }) {
  return text ?? null
}

export function useT() {
  return (text, vars) => (vars
    ? String(text).replace(/\{(\w+)\}/g, (_, key) => (vars[key] ?? `{${key}}`))
    : text)
}
