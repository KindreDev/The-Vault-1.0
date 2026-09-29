// ── In-app internationalisation (i18n) ──────────────────────────────────────
//
// Design: key-based translation where the KEY is the English source string.
//   t('Dashboard')  →  '仪表盘'  (zh-CN)  /  'Dashboard'  (en, fallback to key)
//
// This is safe by construction: only strings explicitly wrapped in t(...) are
// translated, so it can never corrupt logic values, enum keys, or API fields
// the way a blind find-and-replace would. Adding a new language = drop in one
// more JSON file below and register it in LANGUAGES + DICTS. Nothing else.

import { createElement, Fragment } from 'react'
import { useVaultStore } from '../store/vault'
import en from './en.json'
import zhCN from './zh-CN.json'

// Languages shown in the Settings selector (order preserved). English is the
// default and its dictionary is empty — t() falls back to the key itself.
export const LANGUAGES = [
  { id: 'en',    label: 'English',             native: 'English'  },
  { id: 'zh-CN', label: 'Chinese (Simplified)', native: '简体中文' },
]

const DICTS = {
  'en':    en,
  'zh-CN': zhCN,
}

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
  return (key, params) => translate(locale, key, params)
}

// Render one dictionary-backed phrase and subscribe to locale changes. The fragment adds no DOM wrapper.
export function LocalizedText({ text, params, before = '', after = '' }) {
  const t = useT()
  return createElement(Fragment, null, before, t(text, params), after)
}
