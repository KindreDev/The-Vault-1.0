import React, { lazy } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BarChart2, Sparkles, Trophy, Star } from 'lucide-react'
import HubPage from '../components/layout/HubPage'
import { recapApi } from '../lib/api'

const Stats      = lazy(() => import('./pages').then(m => ({ default: m.Stats })))
const Quests     = lazy(() => import('./pages').then(m => ({ default: m.Quests })))
const Recap      = lazy(() => import('./Recap'))
const HallOfFame = lazy(() => import('./HallOfFame'))

// Stats, Recap, Quests and Hall of Fame under one sidebar entry.
export default function ProgressHub() {
  const { tab } = useParams()
  // Same query the sidebar used: Recap stays hidden until it has enough data.
  const { data: recapAvail, isLoading } = useQuery({
    queryKey: ['recap-availability'],
    queryFn: () => recapApi.availability().then(r => r.data),
    staleTime: 5 * 60 * 1000,
  })
  const recapUnlocked = recapAvail?.unlocked === true
  // Don't bounce a /progress/recap link away before availability is known.
  if (tab === 'recap' && isLoading) return null

  const tabs = [
    { id: 'stats',        label: 'Stats',        icon: BarChart2, element: <Stats /> },
    ...(recapUnlocked ? [{ id: 'recap', label: 'Recap', icon: Sparkles, element: <Recap /> }] : []),
    { id: 'quests',       label: 'Quests',       icon: Trophy,    element: <Quests /> },
    { id: 'hall-of-fame', label: 'Hall of Fame', icon: Star,      element: <HallOfFame /> },
  ]
  return <HubPage basePath="/progress" tabs={tabs} />
}
