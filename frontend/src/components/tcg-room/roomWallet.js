/* Keep the room computer's display balance tied to the authoritative economy
   queries instead of the TCG V2 collection summary (which has no wallet). */
export function resolveRoomWallet({ profile, materials, fallback = {} } = {}) {
  return {
    vault_credits: Number(profile?.vault_credits ?? fallback.vault_credits ?? 0),
    shards: Number(materials?.shards ?? fallback.shards ?? 0),
  }
}
