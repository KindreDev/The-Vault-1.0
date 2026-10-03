import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { LoaderCircle, Sparkles } from 'lucide-react'
import { useT } from '../../i18n'
import { cardsApi } from '../../lib/api'

export default function TCGSetupFlow({ children }) {
  const t = useT()
  const qc = useQueryClient()
  const setup = useQuery({
    queryKey: ['tcg-v2-setup'],
    queryFn: () => cardsApi.setupStatus().then(r => r.data),
    staleTime: 0,
    refetchInterval: q => q.state.data?.foundation?.status === 'building' ? 1500 : false,
  })
  const start = useMutation({
    mutationFn: async () => {
      if (!setup.data?.enabled) {
        const { data } = await cardsApi.startV2()
        qc.setQueryData(['tcg-v2-setup'], data)
      }
      await cardsApi.publishFoundation()
      const { data } = await cardsApi.setupStatus()
      if (!data.foundation?.ready) throw new Error(t('Your card catalogue is not ready yet. Please try again.'))
      qc.setQueryData(['tcg-v2-setup'], data)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ predicate: q => String(q.queryKey[0]).startsWith('tcg-v2-') }),
  })
  if (setup.data?.enabled && setup.data?.foundation?.ready) return children
  const busy = start.isPending || setup.data?.foundation?.status === 'building'
  const error = start.error || setup.error
  const waiting = setup.data?.owned_cards_waiting || 0
  return <div className="tcgws-setup" role="region" aria-label={t('Card collection setup')}>
    <div className="tcgws-setup-panel">
      {busy || setup.isLoading ? <LoaderCircle size={36} className="animate-spin" /> : <Sparkles size={36} />}
      <h1>{t(busy ? 'Preparing your card collection' : 'Start your card collection')}</h1>
      <p>{t(busy
        ? 'Building cards from your library. Keep this window open while your catalogue is prepared.'
        : 'Import your images, link your creators and characters, then build your first card catalogue.')}</p>
      {waiting > 0 && <p>{t('Your {count} existing cards will be preserved as Legacy cards.', { count: waiting })}</p>}
      {error && <p role="alert">{error.response?.data?.detail || error.message}</p>}
      {!setup.isLoading && !setup.isError && <button type="button" disabled={busy} onClick={() => start.mutate()}>
        {t(busy ? 'Preparing your collection…' : setup.data?.enabled ? 'Build card catalogue' : 'Start the TCG')}
      </button>}
      {setup.isError && <button type="button" onClick={() => setup.refetch()}>{t('Retry')}</button>}
      {!busy && <Link to="/galleries">{t('Open your library')}</Link>}
    </div>
  </div>
}
