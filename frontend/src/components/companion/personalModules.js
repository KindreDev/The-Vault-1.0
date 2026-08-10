/**
 * Personal-mode components (Drama Mode + Group Chat) are kept out of the public
 * source tree — see the personal-mode block in .gitignore.
 *
 * A static `import` of a missing file is a hard build error in Vite, so these
 * are resolved with `import.meta.glob` instead: it scans the filesystem at build
 * time and simply yields an empty object when the files aren't there. Present,
 * you get the real component; absent, you get null.
 *
 * Every call site is already gated on the `personal-mode` query, which can only
 * be true once the gate is unlocked — and a public clone has no password hash
 * configured, so it never is. The `&& Component` guards at those call sites are
 * belt-and-braces on top of that.
 */
const modules = import.meta.glob(
  ['./GroupChat.jsx', './GroupsPanel.jsx', './SimulationSection.jsx'],
  { eager: true },
)

const pick = name => modules[`./${name}.jsx`]?.default ?? null

export const GroupChat         = pick('GroupChat')
export const GroupsPanel       = pick('GroupsPanel')
export const SimulationSection = pick('SimulationSection')

/** True when this build has the personal-mode components available. */
export const hasPersonalModules = Boolean(GroupChat && GroupsPanel)
