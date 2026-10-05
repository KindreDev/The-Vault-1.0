export const SURVEY_DELAY_MS = 15 * 60 * 1000
export const SURVEY_KEY = 'vault_release_survey_2.0.0'

export function readSurveyState() {
  try {
    const value = JSON.parse(localStorage.getItem(SURVEY_KEY) || '{}')
    return {
      activeMs: Math.max(0, Number(value?.activeMs) || 0),
      done: value?.done === true,
      laterUntil: Math.max(0, Number(value?.laterUntil) || 0),
    }
  } catch { return { activeMs: 0, done: false, laterUntil: 0 } }
}

export function writeSurveyState(value) {
  try { localStorage.setItem(SURVEY_KEY, JSON.stringify(value)) } catch {}
}

export function surveyIsDue(state, now = Date.now()) {
  return !state.done && state.activeMs >= SURVEY_DELAY_MS && now >= state.laterUntil
}
