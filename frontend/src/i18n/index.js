// ── In-app internationalisation (i18n) ──────────────────────────────────────
//
// Design: key-based translation where the KEY is the English source string.
//   t('Dashboard')  →  '仪表盘'  (zh-CN)  /  'Dashboard'  (en, fallback to key)
//
// This is safe by construction: only strings explicitly wrapped in t(...) are
// translated, so it can never corrupt logic values, enum keys, or API fields
// the way a blind find-and-replace would. Adding a new language = drop in one
// more JSON file below and register it in LANGUAGES + DICTS. Nothing else.

import { createElement, Fragment, useCallback } from 'react'
import { create } from 'zustand'
import { useVaultStore } from '../store/vault'
import en from './en.json'

// Languages shown in the Settings selector (order preserved). English is the
// default and its dictionary is empty — t() falls back to the key itself.
export const LANGUAGES = [
  { id: 'en',    label: 'English',             native: 'English'  },
  { id: 'zh-CN', label: 'Chinese (Simplified)', native: '简体中文' },
]

// Other languages load on demand so English users never download them (the
// Chinese dictionary alone is ~270 KB of the startup bundle otherwise).
const DICTS = { 'en': en }
const LOADERS = {
  'zh-CN': () => import('./zh-CN.json'),
}
const loading = {}
// Bumped when a dictionary arrives so components re-render with it.
const useDictionaryRevision = create(() => ({ revision: 0 }))

export function ensureLocale(locale) {
  if (DICTS[locale] || !LOADERS[locale]) return Promise.resolve()
  loading[locale] ||= LOADERS[locale]()
    .then(module => {
      DICTS[locale] = module.default || module
      useDictionaryRevision.setState(state => ({ revision: state.revision + 1 }))
    })
    .catch(() => { delete loading[locale] })
  return loading[locale]
}

// Switching language in Settings loads the new dictionary.
useVaultStore.subscribe(state => { void ensureLocale(state.locale) })

export const DEFAULT_LOCALE = 'en'

// Pure translate — usable outside React (e.g. constants, non-component code).
export function translate(locale, key, params = {}) {
  if (key == null) return key
  const dict = DICTS[locale]
  if (!dict) return key
  const translated = dict[key] ?? key
  return Object.entries(params).reduce((text, [name, value]) =>
    text.replaceAll(`{${name}}`, String(value ?? '')),
  translated)
}

// React hook — returns a t() bound to the active locale. Subscribing to the
// store means every component using t() re-renders the moment the user switches
// language, with no page reload needed.
export function useT() {
  const locale = useVaultStore(s => s.locale)
  const revision = useDictionaryRevision(s => s.revision)
  // Stable between renders so effects and callbacks that list `t` as a
  // dependency don't re-run on every render; it still changes with the
  // language or dictionary.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((key, params) => translate(locale, key, params), [locale, revision])
}

// Render one dictionary-backed phrase and subscribe to locale changes. The fragment adds no DOM wrapper.
export function LocalizedText({ text, params, before = '', after = '' }) {
  const t = useT()
  return createElement(Fragment, null, before, t(text, params), after)
}
