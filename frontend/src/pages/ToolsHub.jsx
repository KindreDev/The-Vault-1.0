import React, { lazy } from 'react'
import { Tag, GitCompare, Terminal, ScrollText } from 'lucide-react'
import HubPage from '../components/layout/HubPage'

const TagManager = lazy(() => import('./TagManager'))
const Duplicates = lazy(() => import('./Duplicates'))
const Console    = lazy(() => import('./Console'))
const ScanLog    = lazy(() => import('./pages').then(m => ({ default: m.ScanLog })))

const TABS = [
  { id: 'tags',       label: 'Tag Manager', icon: Tag,        element: <TagManager /> },
  { id: 'duplicates', label: 'Duplicates',  icon: GitCompare, element: <Duplicates /> },
  { id: 'console',    label: 'Console',     icon: Terminal,   element: <Console /> },
  { id: 'scan-log',   label: 'Scan Log',    icon: ScrollText, element: <ScanLog /> },
]

// Library maintenance pages under one sidebar entry.
export default function ToolsHub() {
  return <HubPage basePath="/tools" tabs={TABS} />
}
