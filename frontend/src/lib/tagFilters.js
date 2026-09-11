export const tagTokensFromParams = (params, namesKey, idsKey, legacyNameKey = null) => {
  const names = (params.get(namesKey) || (legacyNameKey ? params.get(legacyNameKey) : '') || '')
    .split(',').map(v => v.trim()).filter(Boolean).map(name => `name:${name}`)
  const ids = (params.get(idsKey) || '')
    .split(',').map(v => v.trim()).filter(v => /^\d+$/.test(v)).map(id => `id:${id}`)
  return [...ids, ...names]
}

export const normalizeTagTokens = (tokens = []) => tokens.map(token =>
  token.startsWith('id:') || token.startsWith('name:') ? token : `name:${token}`
)

export const tagTokensToParams = (tokens = []) => {
  const ids = []
  const names = []
  for (const token of tokens) {
    if (token.startsWith('id:')) ids.push(token.slice(3))
    else if (token.startsWith('name:')) names.push(token.slice(5))
  }
  return {
    ids: ids.length ? ids.join(',') : null,
    names: names.length ? names.join(',') : null,
  }
}

export const tagTokenKey = (tokens = []) => tokens.join('|')
