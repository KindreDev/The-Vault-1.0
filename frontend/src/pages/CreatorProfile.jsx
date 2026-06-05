import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Star, Globe, Droplets, Images, Columns3, Shuffle,
  Upload, Camera, X, Image as ImageIcon, Play, Video, MoreHorizontal,
  Pencil, Trash2, Sparkles, FolderOpen,
} from 'lucide-react'
import BondHearts from '../components/BondHearts'
import { creatorsApi, galleriesApi, imagesApi, taggerApi, gamiApi } from '../lib/api'
import { useVaultStore } from '../store/vault'
import toast from 'react-hot-toast'
import { FormDropdown } from '../components/FormDropdown'
import { COUNTRIES } from '../lib/countries'

const COUNTRY_OPTIONS = [
  { value: '', label: 'Select Country' },
  ...COUNTRIES.map(c => ({ value: c, label: c }))
]

const GENDER_OPTIONS = [
  { value: '', label: 'Unknown' },
  { value: 'Female', label: 'Female' },
  { value: 'Male', label: 'Male' },
  { value: 'Other', label: 'Other' },
]

const YES_NO_OPTIONS = [
  { value: '', label: 'Not Set / Unknown' },
  { value: 'no', label: 'No' },
  { value: 'yes', label: 'Yes' },
]

const STATUS_OPTIONS = [
  { value: 'Active', label: 'Active' },
  { value: 'Hiatus', label: 'Hiatus' },
  { value: 'Retired', label: 'Retired' },
]

const TYPE_LABELS = {
  cosplayer: 'Cosplayer',
  ethot: 'Ethot',
  artist: 'Artist',
  character: 'Character',
  actress: 'Actress',
  custom: 'Model/Other'
}

function calculateAge(dobString) {
  if (!dobString) return null;
  const parts = dobString.split('-');
  if (parts.length < 2) return null;
  const birthYear = parseInt(parts[0], 10);
  const birthMonth = parseInt(parts[1], 10);
  const birthDay = parts.length > 2 ? parseInt(parts[2], 10) : 1;
  if (isNaN(birthYear) || isNaN(birthMonth)) return null;

  const today = new Date();
  let age = today.getFullYear() - birthYear;
  if (today.getMonth() + 1 < birthMonth || (today.getMonth() + 1 === birthMonth && today.getDate() < birthDay)) {
    age--;
  }
  return age;
}

const TYPE_COLORS = {
  cosplayer: { bg: 'rgba(29,158,117,0.15)',  text: '#9FE1CB' },
  ethot:     { bg: 'rgba(212,83,126,0.15)',  text: '#ED93B1' },
  artist:    { bg: 'rgba(127,119,221,0.15)', text: '#CECBF6' },
  character: { bg: 'rgba(186,117,23,0.15)',  text: '#FAC775' },
  actress:   { bg: 'rgba(212,83,126,0.15)',  text: '#ED93B1' },
  custom:    { bg: 'rgba(136,135,128,0.15)', text: '#D3D1C7' },
}

const RARITY_COLORS = {
  common:    '#888780',
  uncommon:  '#1D9E75',
  rare:      '#378ADD',
  epic:      '#7F77DD',
  legendary: '#BA7517',
}

const RARITY_LABELS = {
  common:    'Snapshot',
  uncommon:  'Album · 500+',
  rare:      'Big Portfolio · 2.5K+',
  epic:      'Library · 6K+',
  legendary: 'Grand Collection · 15K+',
}

const TYPES = ['cosplayer', 'ethot', 'artist', 'character', 'actress', 'custom']
const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary']

function thumbSrc(path) {
  if (!path) return null
  const filename = path.replace(/\\/g, '/').split('/').pop()
  return `/thumbs/${filename}`
}

// ── 10-star rating ────────────────────────────────────────────────────────────
function RatingInput({ value, onChange }) {
  const [hover, setHover] = useState(0)
  const display = hover || value
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
        <button key={n} type="button"
                onClick={() => onChange(n)}
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                className="text-[16px] leading-none cursor-pointer transition-colors"
                style={{ color: n <= display ? '#EF9F27' : 'rgba(255,255,255,0.12)' }}>★</button>
      ))}
      {value > 0 && (
        <span className="ml-1.5 text-[11px] font-medium" style={{ color: '#EF9F27' }}>
          {Number(value) % 1 === 0 ? `${value}.0` : value}
        </span>
      )}
    </div>
  )
}

// ── Portrait gallery card (horizontal grid) ───────────────────────────────────
function PortraitGalleryCard({ gallery, onClick }) {
  const [failed, setFailed] = useState(false)
  const cover = !failed && gallery.cover_thumb ? thumbSrc(gallery.cover_thumb) : null
  return (
    <div onClick={onClick}
         className="rounded-[10px] overflow-hidden cursor-pointer group relative flex-shrink-0"
         style={{ width: 195, aspectRatio: '2/3', background: '#1a1a1a', border: '0.5px solid rgba(255,255,255,0.08)' }}>
      {cover
        ? <img src={cover} alt={gallery.name}
               className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
               onError={() => setFailed(true)} />
        : <div className="w-full h-full flex items-center justify-center opacity-15"><Images size={36} /></div>
      }
      <div className="absolute inset-x-0 bottom-0 p-3 pt-10"
           style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.88) 0%, transparent 100%)' }}>
        <div className="text-[15px] font-medium text-white truncate leading-tight">{gallery.name}</div>
        <div className="text-[13px] text-[rgba(255,255,255,0.45)] mt-0.5">{gallery.image_count} photos</div>
        {gallery.period_month && gallery.period_year && (
          <div className="text-[12px] mt-0.5 font-medium" style={{ color: '#9FE1CB' }}>
            {new Date(gallery.period_year, gallery.period_month - 1).toLocaleString('default', { month: 'short', year: 'numeric' })}
          </div>
        )}
      </div>
      {gallery.cum_count > 0 && (
        <div className="absolute top-2 right-2 flex items-center gap-0.5 text-[12px] px-2 py-0.5 rounded-full"
             style={{ background: 'rgba(0,0,0,0.75)', color: '#ED93B1' }}>
          <Droplets size={10} /> {gallery.cum_count}
        </div>
      )}
    </div>
  )
}

// ── Horizontal gallery scroll section ────────────────────────────────────────
function GalleryScroll({ title, icon: Icon, galleries, onGalleryClick, onViewAll }) {
  if (!galleries || galleries.length === 0) return null
  return (
    <div className="vault-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] font-medium text-[rgba(255,255,255,0.5)] uppercase tracking-wider flex items-center gap-1.5">
          <Icon size={11} /> {title}
        </div>
        {onViewAll && (
          <button onClick={onViewAll} className="text-[11px] cursor-pointer" style={{ color: '#7F77DD' }}>
            view all
          </button>
        )}
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
        {galleries.map(g => (
          <PortraitGalleryCard key={g.id} gallery={g} onClick={() => onGalleryClick(g.id)} />
        ))}
      </div>
    </div>
  )
}

// ── Avatar picker modal ────────────────────────────────────────────────────────
function AvatarModal({ creatorId, onClose, onSuccess }) {
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)
  const qc = useQueryClient()
  const bumpAvatarBust = useVaultStore(s => s.bumpAvatarBust)

  const randomMutation = useMutation({
    mutationFn: () => creatorsApi.setAvatarRandom(creatorId),
    onSuccess: () => {
      toast.success('Avatar updated!')
      qc.invalidateQueries({ queryKey: ['creator', String(creatorId)] })
      qc.invalidateQueries({ queryKey: ['creators'] })
      bumpAvatarBust()
      onSuccess()
    },
  })

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await creatorsApi.uploadAvatar(creatorId, file)
      toast.success('Avatar uploaded!')
      qc.invalidateQueries({ queryKey: ['creator', String(creatorId)] })
      qc.invalidateQueries({ queryKey: ['creators'] })
      bumpAvatarBust()
      onSuccess()
    } catch { toast.error('Upload failed') }
    finally { setUploading(false) }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center"
         style={{ background: 'rgba(0,0,0,0.75)' }}
         onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="rounded-[14px] w-80 overflow-hidden"
           style={{ background: '#1a1a1a', border: '0.5px solid rgba(255,255,255,0.12)' }}>
        <div className="flex items-center justify-between p-4 border-b border-[rgba(255,255,255,0.07)]">
          <div className="text-[14px] font-medium text-[rgba(255,255,255,0.9)]">Set avatar</div>
          <button onClick={onClose} className="cursor-pointer text-[rgba(255,255,255,0.4)] hover:text-white"><X size={16} /></button>
        </div>
        <div className="p-5 flex flex-col items-center gap-4">
          <div className="text-[12px] text-[rgba(255,255,255,0.45)] text-center">
            Upload an image from your PC to use as avatar
          </div>
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-full text-[12px] font-medium cursor-pointer"
                  style={{ background: 'rgba(127,119,221,0.2)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.35)' }}>
            <Upload size={14} /> {uploading ? 'Uploading...' : 'Pick from PC'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
          <div className="text-[10px] text-[rgba(255,255,255,0.2)]">— or —</div>
          <button onClick={() => randomMutation.mutate()} disabled={randomMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 rounded-full text-[11px] cursor-pointer"
                  style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
            <Shuffle size={11} /> {randomMutation.isPending ? 'Setting...' : 'Random from gallery'}
          </button>
        </div>
      </div>
    </div>
  )
}

// BannerPickerModal removed — banner upload is now inline in the banner controls

function EditCreatorModal({ creator, onClose }) {
  let initialLinks = ''
  try {
    const pl = JSON.parse(creator.platform_links || '{}')
    initialLinks = Object.values(pl).join('\n')
  } catch {}

  const [form, setForm] = useState({
    name: creator.name || '', title: creator.title || '', real_name: creator.real_name || '',
    creator_type: creator.creator_type || 'cosplayer', gender: creator.gender || '',
    eye_color: creator.eye_color || '',
    fake_boobs: creator.fake_boobs === true ? 'yes' : creator.fake_boobs === false ? 'no' : '',
    fake_ass: creator.fake_ass === true ? 'yes' : creator.fake_ass === false ? 'no' : '',
    date_of_birth: creator.date_of_birth || '', height: creator.height || '', body_measurements: creator.body_measurements || '',
    country: creator.country || '', series: creator.series || '', origin: creator.origin || '',
    description: creator.description || '', wiki_url: creator.wiki_url || '', card_rarity: creator.card_rarity || 'common',
    patreon_price: creator.patreon_price || '', platform_links: initialLinks,
    status: creator.status || 'Active',
    retirement_year: creator.retirement_year || ''
  })
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: () => {
      const payload = { ...form }
      payload.height = payload.height ? parseInt(payload.height, 10) || null : null
      payload.patreon_price = payload.patreon_price ? parseFloat(payload.patreon_price) || 0.0 : 0.0
      payload.fake_boobs = form.fake_boobs === 'yes' ? true : form.fake_boobs === 'no' ? false : null
      payload.fake_ass = form.fake_ass === 'yes' ? true : form.fake_ass === 'no' ? false : null
      payload.retirement_year = form.status === 'Retired' && form.retirement_year ? parseInt(form.retirement_year, 10) || null : null
      if (payload.platform_links) {
        const links = payload.platform_links.split(/[\n,]+/).map(l => l.trim()).filter(Boolean)
        const linksObj = {}
        links.forEach((l, i) => linksObj[`link_${i}`] = l)
        payload.platform_links = JSON.stringify(linksObj)
      } else {
        payload.platform_links = "{}"
      }
      return creatorsApi.update(creator.id, payload).then(r => r.data)
    },
    onSuccess: () => {
      toast.success('Creator updated')
      qc.invalidateQueries({ queryKey: ['creator', String(creator.id)] })
      qc.invalidateQueries({ queryKey: ['creators'] })
      onClose()
    },
    onError: () => toast.error('Update failed')
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in" style={{ background: 'rgba(0,0,0,0.8)' }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="rounded-[14px] p-6 w-[880px] max-h-[85vh] overflow-y-auto animate-modal-pop shadow-2xl" style={{ background: '#1a1a1a', border: '0.5px solid rgba(255,255,255,0.15)' }}>
        <div className="flex items-center justify-between mb-5">
          <div className="text-[22px] font-medium text-[rgba(255,255,255,0.9)] flex items-center gap-2">
            <Pencil size={20} style={{ color: '#7F77DD' }} /> Edit creator
          </div>
          <button onClick={onClose} className="cursor-pointer text-[rgba(255,255,255,0.4)] hover:text-white"><X size={20} /></button>
        </div>

        <div className="mb-4">
          <div className="text-[16px] text-[rgba(255,255,255,0.4)] mb-2 uppercase tracking-wider font-semibold">Category</div>
          <div className="flex flex-wrap gap-1.5">
            {TYPES.map(t => (
              <button key={t} onClick={() => set('creator_type', t)}
                      className="text-[16px] px-3.5 py-2 rounded-full cursor-pointer capitalize transition-all"
                      style={{
                        background: form.creator_type === t ? 'rgba(127,119,221,0.25)' : 'rgba(255,255,255,0.05)',
                        color: form.creator_type === t ? '#CECBF6' : 'rgba(255,255,255,0.45)',
                        border: `0.5px solid ${form.creator_type === t ? 'rgba(127,119,221,0.5)' : 'rgba(255,255,255,0.08)'}`,
                      }}>{TYPE_LABELS[t] || t}</button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-4 mt-4">
          {/* Left Column */}
          <div className="flex flex-col gap-4">
            {[
              { label: 'Name *', key: 'name', placeholder: 'Name' },
              { label: 'Title', key: 'title', placeholder: 'Optional — shown after name' },
              { label: 'Real name', key: 'real_name', placeholder: 'Real name' },
            ].map(f => (
              <div key={f.key}>
                <div className="text-[16px] text-[rgba(255,255,255,0.4)] mb-1.5 font-medium">{f.label}</div>
                <input value={form[f.key]} onChange={e => set(f.key, e.target.value)}
                       placeholder={f.placeholder}
                       className="w-full rounded-[8px] px-3.5 py-2.5 text-[18px] text-[rgba(255,255,255,0.85)] placeholder-[rgba(255,255,255,0.2)] outline-none"
                       style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)' }} />
              </div>
            ))}

            <div>
              <div className="text-[16px] text-[rgba(255,255,255,0.4)] mb-1.5 font-medium">Country</div>
              <FormDropdown value={form.country} onChange={v => set('country', v)} options={COUNTRY_OPTIONS} placeholder="Select Country" isSearchable={true} />
            </div>

            <div>
              <div className="text-[16px] text-[rgba(255,255,255,0.4)] mb-1.5 font-medium">Gender</div>
              <FormDropdown value={form.gender} onChange={v => set('gender', v)} options={GENDER_OPTIONS} placeholder="Unknown" />
            </div>

            {form.creator_type !== 'character' && (
              <div>
                <div className="text-[16px] text-[rgba(255,255,255,0.4)] mb-1.5 font-medium">Status</div>
                <FormDropdown value={form.status} onChange={v => set('status', v)} options={STATUS_OPTIONS} placeholder="Active" />
              </div>
            )}

            {form.creator_type !== 'character' && form.status === 'Retired' && (
              <div>
                <div className="text-[16px] text-[rgba(255,255,255,0.4)] mb-1.5 font-medium">Retirement Year</div>
                <input value={form.retirement_year} onChange={e => set('retirement_year', e.target.value)}
                       placeholder="e.g. 2024" type="number"
                       className="w-full rounded-[8px] px-3.5 py-2.5 text-[18px] text-[rgba(255,255,255,0.85)] placeholder-[rgba(255,255,255,0.2)] outline-none"
                       style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)' }} />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-[16px] text-[rgba(255,255,255,0.4)] mb-1.5 font-medium">Fake Boobs</div>
                <FormDropdown value={form.fake_boobs} onChange={v => set('fake_boobs', v)} options={YES_NO_OPTIONS} placeholder="Not Set" />
              </div>
              <div>
                <div className="text-[16px] text-[rgba(255,255,255,0.4)] mb-1.5 font-medium">Fake Ass</div>
                <FormDropdown value={form.fake_ass} onChange={v => set('fake_ass', v)} options={YES_NO_OPTIONS} placeholder="Not Set" />
              </div>
            </div>
          </div>

          {/* Right Column */}
          <div className="flex flex-col gap-4">
            <div>
              <div className="text-[16px] text-[rgba(255,255,255,0.4)] mb-1.5 font-medium">
                {form.creator_type === 'character' ? 'Age' : 'Date of Birth'}
              </div>
              <input
                value={form.date_of_birth}
                onChange={e => set('date_of_birth', e.target.value)}
                placeholder={form.creator_type === 'character' ? '17' : 'YYYY-MM or YYYY-MM-DD'}
                className="w-full rounded-[8px] px-3.5 py-2.5 text-[18px] text-[rgba(255,255,255,0.85)] placeholder-[rgba(255,255,255,0.2)] outline-none"
                style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)' }}
              />
            </div>

            {[
              { label: 'Height (cm)', key: 'height', placeholder: '165' },
              { label: 'Measurements', key: 'body_measurements', placeholder: '36-24-36' },
              { label: 'Eye Color', key: 'eye_color', placeholder: 'Blue' },
            ].map(f => (
              <div key={f.key}>
                <div className="text-[16px] text-[rgba(255,255,255,0.4)] mb-1.5 font-medium">{f.label}</div>
                <input value={form[f.key]} onChange={e => set(f.key, e.target.value)}
                       placeholder={f.placeholder}
                       className="w-full rounded-[8px] px-3.5 py-2.5 text-[18px] text-[rgba(255,255,255,0.85)] placeholder-[rgba(255,255,255,0.2)] outline-none"
                       style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)' }} />
              </div>
            ))}

            {form.creator_type === 'character' && (
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: 'Series / Game', key: 'series', placeholder: 'Series' },
                  { label: 'Origin', key: 'origin', placeholder: 'Origin' },
                ].map(f => (
                  <div key={f.key}>
                    <div className="text-[16px] text-[rgba(255,255,255,0.4)] mb-1.5 font-medium">{f.label}</div>
                    <input value={form[f.key]} onChange={e => set(f.key, e.target.value)}
                           placeholder={f.placeholder}
                           className="w-full rounded-[8px] px-3.5 py-2.5 text-[18px] text-[rgba(255,255,255,0.85)] placeholder-[rgba(255,255,255,0.2)] outline-none"
                           style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)' }} />
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              {form.creator_type !== 'character' && (
                <div>
                  <div className="text-[16px] text-[rgba(255,255,255,0.4)] mb-1.5 font-medium">Monthly Price ($)</div>
                  <input value={form.patreon_price} onChange={e => set('patreon_price', e.target.value)}
                         placeholder="10.00" type="number" step="0.01" min="0"
                         className="w-full rounded-[8px] px-3.5 py-2.5 text-[18px] text-[rgba(255,255,255,0.85)] placeholder-[rgba(255,255,255,0.2)] outline-none"
                         style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)' }} />
                </div>
              )}
              <div className={form.creator_type !== 'character' ? '' : 'col-span-2'}>
                <div className="text-[16px] text-[rgba(255,255,255,0.4)] mb-1.5 font-medium">Wiki URL</div>
                <input value={form.wiki_url} onChange={e => set('wiki_url', e.target.value)}
                       placeholder="https://..."
                       className="w-full rounded-[8px] px-3.5 py-2.5 text-[18px] text-[rgba(255,255,255,0.85)] placeholder-[rgba(255,255,255,0.2)] outline-none"
                       style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)' }} />
              </div>
            </div>
          </div>
        </div>

        {form.creator_type !== 'character' && (
          <div className="mt-4">
            <div className="text-[16px] text-[rgba(255,255,255,0.4)] mb-1.5 font-medium">Source URLs / Links (comma or newline separated)</div>
            <textarea value={form.platform_links} onChange={e => set('platform_links', e.target.value)}
                      placeholder="https://patreon.com/..., https://onlyfans.com/..." rows={2}
                      className="w-full rounded-[8px] px-3.5 py-2.5 text-[18px] text-[rgba(255,255,255,0.85)] placeholder-[rgba(255,255,255,0.2)] outline-none resize-none"
                      style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)' }} />
          </div>
        )}

        <div className="mt-4 mb-6">
          <div className="text-[16px] text-[rgba(255,255,255,0.4)] mb-1.5 font-medium">Description</div>
          <textarea value={form.description} onChange={e => set('description', e.target.value)}
                    placeholder="Description..." rows={3}
                    className="w-full rounded-[8px] px-3.5 py-2.5 text-[18px] text-[rgba(255,255,255,0.85)] placeholder-[rgba(255,255,255,0.2)] outline-none resize-none"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)' }} />
        </div>

        <div className="flex gap-4">
          <button onClick={onClose}
                  className="flex-1 py-3 rounded-[8px] text-[16px] cursor-pointer"
                  style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)', border: '0.5px solid rgba(255,255,255,0.08)' }}>Cancel</button>
          <button onClick={() => mutation.mutate()}
                  disabled={!form.name.trim() || mutation.isPending}
                  className="flex-1 py-3 rounded-[8px] text-[16px] font-medium cursor-pointer transition-all"
                  style={{ background: 'rgba(127,119,221,0.3)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.5)' }}>
            {mutation.isPending ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
// ── Main profile page ─────────────────────────────────────────────────────────
export default function CreatorProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const pageRef = useRef(null)

  const bumpAvatarBust = useVaultStore(s => s.bumpAvatarBust)
  const avatarBust = useVaultStore(s => s.avatarBust)
  const [avatarFailed, setAvatarFailed] = useState(false)
  const [rating, setRating] = useState(null)
  const [showAvatarModal, setShowAvatarModal] = useState(false)
  const [showAvatarZoom, setShowAvatarZoom]   = useState(false)
  const [aiTagging, setAiTagging]             = useState(false)  // quick-tag this creator
  const [showEditModal, setShowEditModal] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [valueRevealed, setValueRevealed] = useState(false)
  const [bannerImageId, setBannerImageId] = useState(null)
  const [bannerLocalUrl, setBannerLocalUrl] = useState(null)
  const [bannerY, setBannerY] = useState(20)
  const [bannerZoom, setBannerZoom] = useState(1)
  const [bannerMenuOpen, setBannerMenuOpen] = useState(false)
  const [scrollY, setScrollY] = useState(0)
  const [folderInput, setFolderInput] = useState('')
  const bannerFileRef = useRef(null)
  const bannerMenuRef = useRef(null)
  const bannerSaveTimer = useRef(null)

  // Find and attach to scrollable parent for parallax
  useEffect(() => {
    const el = pageRef.current
    if (!el) return
    let scrollEl = null
    let node = el.parentElement
    while (node && node !== document.body) {
      const s = window.getComputedStyle(node)
      if (s.overflowY === 'auto' || s.overflowY === 'scroll') { scrollEl = node; break }
      node = node.parentElement
    }
    const target = scrollEl || window
    const onScroll = () => setScrollY(scrollEl ? scrollEl.scrollTop : window.scrollY)
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => target.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const h = (e) => { if (bannerMenuRef.current && !bannerMenuRef.current.contains(e.target)) setBannerMenuOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const { data: creator, isError: creatorError } = useQuery({
    queryKey: ['creator', id],
    queryFn: () => creatorsApi.get(id).then(r => r.data),
  })

  useEffect(() => {
    if (creator && rating === null) setRating(creator.rating || 0)
  }, [creator])

  // Initialize banner from saved creator data (runs once when creator loads)
  useEffect(() => {
    if (!creator) return
    if (creator.banner_image_id) setBannerImageId(creator.banner_image_id)
    if (creator.banner_y != null) setBannerY(creator.banner_y)
    if (creator.banner_zoom != null) setBannerZoom(creator.banner_zoom)
    setFolderInput(creator.source_folder || '')
  }, [creator?.id])  // only on creator ID change, not every field update

  // Save banner settings to DB (debounced 600ms after last change)
  const saveBanner = useCallback((imageId, y, zoom) => {
    clearTimeout(bannerSaveTimer.current)
    bannerSaveTimer.current = setTimeout(() => {
      creatorsApi.update(id, { banner_image_id: imageId, banner_y: y, banner_zoom: zoom })
        .catch(() => {})
    }, 600)
  }, [id])

  const { data: galleries } = useQuery({
    queryKey: ['creator-galleries', id],
    queryFn: () => galleriesApi.list({ creator_id: id, sort_by: 'cum_count', limit: 50 }).then(r => r.data),
  })

  const { data: randomGalleries } = useQuery({
    queryKey: ['creator-random-galleries', id],
    queryFn: () => galleriesApi.list({ creator_id: id, sort_by: 'random', limit: 8 }).then(r => r.data),
  })

  const { data: recentGalleries } = useQuery({
    queryKey: ['creator-recent-galleries', id],
    queryFn: () => galleriesApi.list({ creator_id: id, sort_by: 'date_added', limit: 8 }).then(r => r.data),
  })

  const { data: topImages } = useQuery({
    queryKey: ['creator-top', id],
    queryFn: () => creatorsApi.topImages(id, 8).then(r => r.data),
  })

  const { data: creatorVideos } = useQuery({
    queryKey: ['creator-videos', id],
    queryFn: () => imagesApi.list({ creator_id: id, is_video: true, sort_by: 'random', limit: 8 }).then(r => r.data),
  })

  // Auto-set banner to first top image ONLY if creator has no saved banner
  useEffect(() => {
    if (topImages && topImages.length > 0 && bannerImageId === null && !creator?.banner_image_id) {
      setBannerImageId(topImages[0].id)
    }
  }, [topImages])

  const randomizeBanner = useCallback(async () => {
    try {
      const res = await creatorsApi.setBannerRandom(id)
      const newId = res.data.banner_image_id
      setBannerImageId(newId)
      setBannerLocalUrl(null)
      saveBanner(newId, bannerY, bannerZoom)
    } catch {
      toast.error('No images found to use as banner')
    }
  }, [id, bannerY, bannerZoom, saveBanner])

  const handleBannerFileUpload = useCallback(async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const localUrl = URL.createObjectURL(file)
    if (bannerLocalUrl) URL.revokeObjectURL(bannerLocalUrl)
    setBannerLocalUrl(localUrl)
    setBannerY(50)
    try {
      await creatorsApi.uploadBanner(id, file)
      qc.invalidateQueries({ queryKey: ['creator', id] })
    } catch {
      toast.error('Banner upload failed')
    }
  }, [id, bannerLocalUrl, qc])

  const favMutation = useMutation({
    mutationFn: () => creatorsApi.update(id, { is_favorite: !creator?.is_favorite }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['creator', id] }); qc.invalidateQueries({ queryKey: ['favorites'] }) }
  })
  const { data: profileData } = useQuery({
    queryKey: ['profile'],
    queryFn: () => gamiApi.profile().then(r => r.data),
    staleTime: 30000,
  })
  const heartsAvailable = profileData?.hearts ?? 0

  const giftMutation = useMutation({
    mutationFn: () => creatorsApi.giftHeart(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['creator', id] })
      qc.invalidateQueries({ queryKey: ['creators'] })
      qc.invalidateQueries({ queryKey: ['profile'] })
      toast.success('❤️ Heart gifted!')
    },
    onError: (e) => toast.error(e?.response?.data?.detail || 'No hearts available'),
  })
  const ratingMutation = useMutation({
    mutationFn: (r) => creatorsApi.update(id, { rating: r }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['creator', id] })
  })
  const wikiMutation = useMutation({
    mutationFn: () => creatorsApi.wikiImport(id),
    onSuccess: (r) => {
      if (r.data.success) { toast.success('Wiki data imported!'); qc.invalidateQueries({ queryKey: ['creator', id] }) }
      else toast.error(r.data.message || 'Wiki import failed')
    }
  })
  const deleteMutation = useMutation({
    mutationFn: () => creatorsApi.delete(id),
    onSuccess: () => {
      toast.success(`${creator.name} deleted`)
      qc.invalidateQueries({ queryKey: ['creators'] })
      navigate('/creators')
    },
    onError: () => toast.error('Failed to delete creator')
  })
  const folderMutation = useMutation({
    mutationFn: (path) => creatorsApi.assignFolder(id, path || null).then(r => r.data),
    onSuccess: (data, variables) => {
      if (variables) {
        toast.success(`${data.assigned_count} ${data.assigned_count === 1 ? 'gallery' : 'galleries'} assigned to ${creator?.name}`)
      } else {
        toast.success('Folder cleared')
      }
      qc.invalidateQueries({ queryKey: ['creator', id] })
      qc.invalidateQueries({ queryKey: ['creator-galleries', id] })
    },
    onError: () => toast.error('Failed to set source folder')
  })

  if (creatorError) return (
    <div className="p-8 flex flex-col gap-3">
      <div className="text-[rgba(255,255,255,0.5)]">Failed to load creator.</div>
      <button onClick={() => navigate('/creators')} className="text-[rgba(255,255,255,0.4)] text-sm underline cursor-pointer w-fit">← Back to Creators</button>
    </div>
  )
  if (!creator) return <div className="p-8 text-[rgba(255,255,255,0.3)]">Loading...</div>

  const tc = TYPE_COLORS[creator.creator_type] || TYPE_COLORS.custom
  const rc = RARITY_COLORS[creator.card_rarity] || RARITY_COLORS.common
  const initials = creator.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  // Parallax banner: 35% at top → 15% min (stays fixed there)
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const MAX_BANNER = Math.round(vh * 0.42)
  const MIN_BANNER = Math.round(vh * 0.22)
  const bannerHeight = Math.max(MIN_BANNER, MAX_BANNER - scrollY * 0.8)
  const bannerSrc = bannerLocalUrl
    || (bannerImageId ? `/api/images/${bannerImageId}/file` : null)
    || (creator.banner_path ? `/api/creators/${id}/banner` : null)

  // Top cum galleries and recent
  const topGalleries = (galleries ?? []).slice(0, 8)

  const handleRating = (r) => { setRating(r); ratingMutation.mutate(r) }
  const isCharacter = creator.creator_type === 'character'
  const age = calculateAge(creator.date_of_birth)
  const dobDisplay = creator.date_of_birth
    ? isCharacter
      ? creator.date_of_birth  // plain age number for characters
      : `${creator.date_of_birth}${age ? ` (Age ${age})` : ''}`
    : null

  return (
    <div ref={pageRef} className="flex flex-col">

      {/* ── Banner + hero combined — image bleeds through both ───────────── */}
      <div className="relative overflow-hidden flex-shrink-0" style={{ background: tc.bg }}>

        {/* Parallax image — fills entire section (banner nav + hero) */}
        {bannerSrc && (
          <img
            src={bannerSrc} alt=""
            className="absolute inset-0 w-full h-full object-cover"
            style={{
              transform: `translateY(${scrollY * 0.25}px) scale(${(1.15 * bannerZoom).toFixed(3)})`,
              transformOrigin: 'center top',
              objectPosition: `center ${bannerY}%`,
              willChange: 'transform',
            }}
            onError={e => { e.target.style.display = 'none' }}
          />
        )}

        {/* Gradient — photo stays vivid at top, fades to near-dark at bottom */}
        <div className="absolute inset-0 pointer-events-none"
             style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.18) 40%, rgba(14,14,14,0.7) 72%, rgba(14,14,14,0.96) 100%)' }} />

        {/* Hard fade to page background at the very bottom */}
        <div className="absolute bottom-0 left-0 right-0 pointer-events-none"
             style={{ height: 64, background: 'linear-gradient(to bottom, transparent, #0e0e0e)', zIndex: 1 }} />

        {/* Rarity accent line */}
        <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ background: rc, zIndex: 2 }} />

        {/* Banner nav area — takes up bannerHeight, nav controls pinned to top */}
        <div className="relative flex-shrink-0 transition-[height] duration-100" style={{ height: bannerHeight }}>
          <div className="absolute top-3 left-4 right-4 flex items-center justify-between z-10">
            <button onClick={() => navigate('/creators')}
                    className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-[7px] cursor-pointer"
                    style={{ color: 'rgba(255,255,255,0.8)', background: 'rgba(0,0,0,0.45)', border: '0.5px solid rgba(255,255,255,0.18)' }}>
              <ArrowLeft size={13} /> Creators
            </button>
            <div className="flex items-center gap-2">
              <button onClick={() => setConfirmDelete(true)}
                      className="w-8 h-8 rounded-full flex items-center justify-center cursor-pointer transition-colors"
                      style={{ color: 'rgba(255,255,255,0.7)', background: 'rgba(0,0,0,0.5)', border: '0.5px solid rgba(255,255,255,0.2)' }}
                      title="Delete creator">
                <Trash2 size={14} />
              </button>
            <div ref={bannerMenuRef} className="relative">
              <button onClick={() => setBannerMenuOpen(o => !o)}
                      className="w-8 h-8 rounded-full flex items-center justify-center cursor-pointer"
                      style={{ color: 'rgba(255,255,255,0.8)', background: 'rgba(0,0,0,0.5)', border: '0.5px solid rgba(255,255,255,0.2)' }}>
                <MoreHorizontal size={15} />
              </button>
              {bannerMenuOpen && (
                <div className="absolute top-10 right-0 rounded-[10px] w-52 z-20 overflow-hidden"
                     style={{ background: 'rgba(18,18,18,0.97)', border: '0.5px solid rgba(255,255,255,0.12)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
                  <button onClick={() => { randomizeBanner(); setBannerMenuOpen(false) }}
                          className="w-full flex items-center gap-2 px-3 py-2.5 text-[11px] cursor-pointer text-left hover:bg-[rgba(255,255,255,0.05)]"
                          style={{ color: 'rgba(255,255,255,0.75)' }}>
                    <Shuffle size={12} /> Randomize banner
                  </button>
                  <label className="w-full flex items-center gap-2 px-3 py-2.5 text-[11px] cursor-pointer hover:bg-[rgba(255,255,255,0.05)]"
                         style={{ color: 'rgba(255,255,255,0.75)', display: 'flex' }}>
                    <Upload size={12} /> Upload banner
                    <input ref={bannerFileRef} type="file" accept="image/*" className="hidden"
                           onChange={e => { handleBannerFileUpload(e); setBannerMenuOpen(false) }} />
                  </label>
                  {bannerSrc && (
                    <>
                      <div style={{ height: '0.5px', background: 'rgba(255,255,255,0.07)' }} />
                      <div className="px-3 py-2.5">
                        <div className="text-[9px] text-[rgba(255,255,255,0.35)] uppercase tracking-widest mb-1.5">Vertical position</div>
                        <input type="range" min={0} max={100} value={bannerY}
                               onChange={e => { const v = Number(e.target.value); setBannerY(v); saveBanner(bannerImageId, v, bannerZoom) }}
                               className="w-full h-1 cursor-pointer accent-[#7F77DD]" />
                      </div>
                      <div className="px-3 pb-3">
                        <div className="text-[9px] text-[rgba(255,255,255,0.35)] uppercase tracking-widest mb-1.5">Zoom</div>
                        <input type="range" min={1} max={2} step={0.05} value={bannerZoom}
                               onChange={e => { const v = Number(e.target.value); setBannerZoom(v); saveBanner(bannerImageId, bannerY, v) }}
                               className="w-full h-1 cursor-pointer accent-[#7F77DD]" />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            </div>{/* end outer flex wrapper with delete + ... */}
          </div>
        </div>

        {/* ── Profile hero — transparent, floats over the banner photo ─── */}
        <div className="relative px-6 pb-8 z-10">
        <div className="flex items-start gap-5">
          {/* Avatar — tall vertical portrait */}
          <div className="relative flex-shrink-0 z-10" style={{ marginTop: -300 }}>
            <div className="rounded-[20px] overflow-hidden flex items-center justify-center group/avatar cursor-zoom-in"
                 onClick={() => (!avatarFailed && creator.avatar_path) && setShowAvatarZoom(true)}
                 style={{ width: 300, height: 450, background: '#111', border: `3px solid ${rc}`, boxShadow: `0 0 60px ${rc}66` }}>
              {!avatarFailed && creator.avatar_path
                ? <img src={`/api/creators/${id}/avatar?v=${new Date(creator.updated_at || 0).getTime()}_${avatarBust}`} alt={creator.name}
                       className="w-full h-full object-cover transition-transform duration-300 group-hover/avatar:scale-105"
                       onError={() => setAvatarFailed(true)} />
                : <span className="font-semibold select-none" style={{ fontSize: 110, color: tc.text, background: tc.bg, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initials}</span>
              }
            </div>
            <button onClick={() => setShowAvatarModal(true)}
                    className="absolute -bottom-2 -right-2 w-10 h-10 rounded-full flex items-center justify-center cursor-pointer"
                    title="Set avatar"
                    style={{ background: '#1a1a1a', border: `1.5px solid ${rc}66`, color: 'rgba(255,255,255,0.6)' }}>
              <Camera size={15} />
            </button>
          </div>

          {/* Main Info Area */}
          <div className="flex-1 min-w-0 pt-2 flex flex-col justify-between">
            <div className="flex items-start justify-between gap-6">
              {/* Name & Tags */}
              <div className="flex flex-col">
                <div className="flex items-center gap-3 group/name">
                  <div className="text-[28px] font-semibold text-[rgba(255,255,255,0.95)]">
                    {creator.name}
                    {creator.title && (
                      <span className="ml-2 font-light text-[20px]" style={{ color: 'rgba(255,255,255,0.38)' }}>
                        — {creator.title}
                      </span>
                    )}
                  </div>
                  <button onClick={() => setShowEditModal(true)}
                          className="opacity-0 group-hover/name:opacity-100 transition-opacity p-1.5 rounded-full cursor-pointer text-[rgba(255,255,255,0.35)] hover:text-white hover:bg-[rgba(255,255,255,0.05)]"
                          title="Edit creator details">
                    <Pencil size={14} />
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className="text-[13px] px-3 py-0.5 rounded-full capitalize font-medium" style={{ background: tc.bg, color: tc.text }}>
                    {creator.creator_type}
                  </span>
                  <span className="text-[12px] px-3 py-0.5 rounded-full font-semibold"
                        style={{ background: `${rc}22`, color: rc }}>
                    {RARITY_LABELS[creator.card_rarity] ?? creator.card_rarity}
                  </span>
                  {creator.series && (
                    <span className="text-[12px] px-3 py-0.5 rounded-full"
                          style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.45)' }}>
                      {creator.series}
                    </span>
                  )}
                </div>
                
                {/* Links */}
                {creator.platform_links && creator.platform_links !== "{}" && (
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {Object.values(JSON.parse(creator.platform_links)).map((link, i) => {
                      let icon = <Globe size={11} />
                      let label = "Link"
                      if (link.includes('patreon')) { label = "Patreon" }
                      else if (link.includes('onlyfans')) { label = "OnlyFans" }
                      else if (link.includes('fansly')) { label = "Fansly" }
                      else if (link.includes('twitter') || link.includes('x.com')) { label = "Twitter" }
                      else if (link.includes('instagram')) { label = "Instagram" }
                      
                      return (
                        <a key={i} href={link} target="_blank" rel="noreferrer"
                           className="flex items-center gap-1.5 text-[12px] px-3 py-1 rounded-full hover:bg-[rgba(255,255,255,0.1)] transition-colors"
                           style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.6)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
                          {icon} {label}
                        </a>
                      )
                    })}
                  </div>
                )}

                <div className="mt-2">
                  <RatingInput value={rating ?? creator.rating ?? 0} onChange={handleRating} />
                </div>
                {!creator.bond_excluded && (
                  <div className="mt-2 flex flex-col gap-2">
                    <BondHearts
                      level={creator.bond_level ?? 0}
                      size="lg"
                      bondScore={creator.bond_score ?? 0}
                      showProgress
                    />
                    <button
                      onClick={() => giftMutation.mutate()}
                      disabled={giftMutation.isPending || heartsAvailable < 1}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '5px 12px', borderRadius: 8, fontSize: 14, fontWeight: 600,
                        cursor: heartsAvailable >= 1 ? 'pointer' : 'not-allowed',
                        background: heartsAvailable >= 1 ? 'rgba(255,45,117,0.18)' : 'rgba(255,255,255,0.04)',
                        border: heartsAvailable >= 1 ? '0.5px solid rgba(255,45,117,0.5)' : '0.5px solid rgba(255,255,255,0.07)',
                        color: heartsAvailable >= 1 ? '#FF2D75' : 'rgba(255,255,255,0.2)',
                        transition: 'all 0.15s',
                        alignSelf: 'flex-start',
                      }}
                    >
                      ❤️ Gift Heart
                      <span style={{ fontSize: 12, opacity: 0.6 }}>({heartsAvailable} available)</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Creator Description */}
              {creator.description && (
                <div className="flex-1 min-w-0 max-w-2xl text-[14px] text-white leading-relaxed line-clamp-5 mt-1 hidden md:block" 
                     style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
                  {creator.description}
                </div>
              )}
            </div>

            {/* Expanded Details Stats */}
            <div className="mt-6 flex flex-wrap gap-x-8 gap-y-4">
              {[
                ['Real Name', creator.real_name],
                ['Country', creator.country],
                ['Gender', creator.gender],
                [isCharacter ? 'Age' : 'Date of Birth', dobDisplay],
                ['Height', creator.height ? `${creator.height} cm` : null],
                ['Measurements', creator.body_measurements],
                ['Eye Color', creator.eye_color],
                ['Fake Boobs', creator.fake_boobs === true ? 'Yes' : creator.fake_boobs === false ? 'No' : null],
                ['Fake Ass', creator.fake_ass === true ? 'Yes' : creator.fake_ass === false ? 'No' : null],
                ['Tier Price', creator.patreon_price > 0 ? `$${creator.patreon_price.toFixed(2)}` : null],
                ...(creator.creator_type !== 'character' ? [
                  ['Status', creator.status],
                  ['Retirement Year', creator.status === 'Retired' ? creator.retirement_year : null],
                ] : []),
              ].filter(([, v]) => v !== null && v !== '').map(([k, v]) => (
                <div key={k}>
                  <div className="text-[11px] text-[rgba(255,255,255,0.4)] uppercase tracking-wider mb-0.5">{k}</div>
                  <div className="text-[18px] font-semibold text-[rgba(255,255,255,0.95)]">{v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-1.5 flex-shrink-0 pt-2 flex-wrap justify-end">
            {creator.creator_type === 'character' && (
              <button onClick={() => wikiMutation.mutate()} disabled={wikiMutation.isPending}
                      className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-full cursor-pointer"
                      style={{ background: 'rgba(29,158,117,0.15)', color: '#9FE1CB', border: '0.5px solid rgba(29,158,117,0.3)' }}>
                <Globe size={12} /> {wikiMutation.isPending ? 'Importing...' : 'Wiki import'}
              </button>
            )}
            <button
              disabled={aiTagging}
              onClick={async () => {
                setAiTagging(true)
                try {
                  await taggerApi.start({ scope: 'creator', creator_id: parseInt(id), threshold: 0.35, retag: false })
                  toast.success('AI tagging started for ' + creator.name)
                } catch (err) {
                  toast.error(err?.response?.data?.detail || 'Failed to start AI tagging')
                } finally {
                  setAiTagging(false)
                }
              }}
              className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-full cursor-pointer disabled:opacity-40"
              style={{ background: 'rgba(127,119,221,0.15)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.3)' }}>
              <Sparkles size={12} /> {aiTagging ? 'Starting…' : 'AI Tag'}
            </button>
            <button onClick={() => favMutation.mutate()}
                    className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-full cursor-pointer"
                    style={{ background: creator.is_favorite ? 'rgba(186,117,23,0.2)' : 'rgba(255,255,255,0.05)',
                             color: creator.is_favorite ? '#FAC775' : 'rgba(255,255,255,0.4)',
                             border: '0.5px solid rgba(255,255,255,0.1)' }}>
              <Star size={12} fill={creator.is_favorite ? '#FAC775' : 'none'} />
              {creator.is_favorite ? 'Favorited' : 'Favorite'}
            </button>
          </div>
        </div>
      </div>
      </div>{/* end combined banner+hero wrapper */}

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="p-5 flex flex-col gap-5">

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { emoji: '🖼️', label: 'Photos',    value: creator.image_count ?? 0 },
            { emoji: '🗂️', label: 'Galleries', value: creator.gallery_count ?? 0 },
            { emoji: '💦', label: 'Sessions',  value: creator.session_count ?? 0, color: '#D4537E' },
            { emoji: '⭐', label: 'Rating',    value: creator.rating > 0 ? `${creator.rating % 1 === 0 ? creator.rating.toFixed(0) : creator.rating} / 10` : '—' },
          ].map(s => (
            <div key={s.label} className="rounded-[10px] p-3" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <div className="text-[11px] mb-1">{s.emoji}</div>
              <div className="text-[20px] font-medium" style={{ color: s.color || 'rgba(255,255,255,0.9)' }}>{s.value}</div>
              <div className="text-[10px] text-[rgba(255,255,255,0.4)]">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Assign by Folder + Time Spent — two-column card */}
        <div className="grid gap-3" style={{ gridTemplateColumns: '1fr auto' }}>

          {/* Left: assign by folder */}
          <div className="rounded-[12px] p-4"
               style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider mb-3"
                 style={{ color: 'rgba(255,255,255,0.45)' }}>
              <FolderOpen size={12} /> Assign Galleries by Folder
            </div>
            <div className="flex items-center gap-2">
              <input
                value={folderInput}
                onChange={e => setFolderInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && folderInput.trim()) folderMutation.mutate(folderInput.trim()) }}
                placeholder={`e.g. D:\\Media\\${creator.name}`}
                className="flex-1 rounded-[8px] px-3.5 py-2.5 text-[16px] placeholder-[rgba(255,255,255,0.2)] outline-none font-mono"
                style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.85)' }}
              />
              <button
                onClick={() => folderMutation.mutate(folderInput.trim())}
                disabled={folderMutation.isPending || !folderInput.trim()}
                className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-[8px] cursor-pointer disabled:opacity-40 text-[15px] font-medium whitespace-nowrap"
                style={{ background: 'rgba(127,119,221,0.2)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.4)' }}>
                <FolderOpen size={14} /> {folderMutation.isPending ? 'Assigning…' : 'Assign Galleries'}
              </button>
              {creator.source_folder && (
                <button onClick={() => folderMutation.mutate(null)}
                        disabled={folderMutation.isPending}
                        title="Clear saved folder"
                        className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center cursor-pointer disabled:opacity-40"
                        style={{ background: 'rgba(212,83,126,0.1)', color: '#ED93B1', border: '0.5px solid rgba(212,83,126,0.25)' }}>
                  <X size={14} />
                </button>
              )}
            </div>
            {creator.source_folder && (
              <div className="mt-2 text-[12px] font-mono truncate" style={{ color: 'rgba(255,255,255,0.35)' }}>
                Saved: {creator.source_folder}
              </div>
            )}
          </div>

          {/* Right: total time spent */}
          <div className="rounded-[12px] p-4 flex flex-col justify-center items-center text-center"
               style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.08)', minWidth: 140 }}>
            <div className="text-[11px] font-medium uppercase tracking-wider mb-2"
                 style={{ color: 'rgba(255,255,255,0.45)' }}>Time Spent</div>
            {(() => {
              const secs = creator.total_view_seconds || 0
              if (secs === 0) return <div className="text-[22px] font-semibold" style={{ color: 'rgba(255,255,255,0.2)' }}>—</div>
              const h = Math.floor(secs / 3600)
              const m = Math.floor((secs % 3600) / 60)
              if (h > 0) return (
                <>
                  <div className="text-[28px] font-semibold leading-none" style={{ color: '#D4537E' }}>{h}<span className="text-[16px] ml-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>h</span></div>
                  {m > 0 && <div className="text-[16px] mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>{m}m</div>}
                </>
              )
              return <div className="text-[28px] font-semibold leading-none" style={{ color: '#D4537E' }}>{m}<span className="text-[16px] ml-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>m</span></div>
            })()}
            <div className="text-[11px] mt-2" style={{ color: 'rgba(255,255,255,0.2)' }}>across {creator.session_count} session{creator.session_count !== 1 ? 's' : ''}</div>
          </div>

        </div>

        {/* Collection Value & Completion */}
        {((creator.collection_value ?? 0) > 0 || (creator.completion_pct ?? 0) > 0) && (
          <div className="rounded-[12px] p-4 flex flex-col gap-3"
               style={{ background: 'rgba(29,158,117,0.07)', border: '0.5px solid rgba(29,158,117,0.2)' }}>
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <div className="text-[12px] uppercase tracking-wider text-[rgba(255,255,255,0.4)]">Collection Value</div>

                {/* Blurred until clicked */}
                <div
                  onClick={() => setValueRevealed(true)}
                  title={valueRevealed ? undefined : 'Click to reveal'}
                  style={{
                    cursor: valueRevealed ? 'default' : 'pointer',
                    filter: valueRevealed ? 'none' : 'blur(7px)',
                    transition: 'filter 0.35s ease',
                    userSelect: valueRevealed ? 'auto' : 'none',
                    borderRadius: 6,
                  }}>
                  <div className="text-[22px] font-semibold" style={{ color: '#1D9E75' }}>
                    ${(creator.collection_value ?? 0).toFixed(2)}
                  </div>
                  <div className="text-[12px] text-[rgba(255,255,255,0.4)]">
                    {creator.unique_months_total ?? 0} month{(creator.unique_months_total ?? 0) !== 1 ? 's' : ''} collected
                    {(creator.patreon_price ?? 0) > 0 && ` · $${creator.patreon_price.toFixed(2)}/mo`}
                    {(creator.one_time_value ?? 0) > 0 && ` · $${(creator.one_time_value ?? 0).toFixed(2)} one-time`}
                  </div>
                </div>
                {!valueRevealed && (
                  <div className="text-[9px] mt-0.5" style={{ color: 'rgba(29,158,117,0.5)' }}>🔒 click to reveal</div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                <div className="text-[12px] uppercase tracking-wider text-[rgba(255,255,255,0.4)]">All-Time Collection</div>
                <div className="text-[28px] font-semibold" style={{ color: (creator.completion_pct ?? 0) >= 100 ? '#BA7517' : '#1D9E75' }}>
                  {(creator.completion_pct ?? 0).toFixed(0)}%
                </div>
                <div className="text-[13px] text-[rgba(255,255,255,0.45)]">
                  {creator.months_covered_recent ?? 0} / {creator.total_months_expected || '?'} months
                </div>
              </div>
            </div>
            {/* Completion bar */}
            <div className="h-[6px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
              <div className="h-full rounded-full transition-all duration-700"
                   style={{
                     width: `${Math.min(100, creator.completion_pct ?? 0)}%`,
                     background: (creator.completion_pct ?? 0) >= 100
                       ? 'linear-gradient(90deg, #BA7517, #EF9F27)'
                       : 'linear-gradient(90deg, #1D9E75, #9FE1CB)',
                   }} />
            </div>
            {(creator.completion_pct ?? 0) >= 100 && (
              <div className="text-[11px] font-medium text-center py-1 rounded-[6px]"
                   style={{ background: 'rgba(186,117,23,0.15)', color: '#FAC775' }}>
                ✦ Complete Collection — every month since your first gallery!
              </div>
            )}
          </div>
        )}

        {/* ── 2-column: gallery sections left, top images right ──── */}
        <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 300px' }}>
          {/* Left column */}
          <div className="flex flex-col gap-4 min-w-0">

            {/* Most Viewed Galleries */}
            <GalleryScroll
              title="Most Viewed Galleries"
              icon={Droplets}
              galleries={topGalleries}
              onGalleryClick={(gid) => navigate(`/galleries/${gid}`)}
              onViewAll={() => navigate(`/galleries?creator_id=${id}`)}
            />

            {/* Recent Galleries */}
            <GalleryScroll
              title="Recent Galleries"
              icon={Images}
              galleries={recentGalleries}
              onGalleryClick={(gid) => navigate(`/galleries/${gid}`)}
            />

            {/* Random Videos */}
            {(creatorVideos ?? []).length > 0 && (
              <div className="vault-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[11px] font-medium text-[rgba(255,255,255,0.5)] uppercase tracking-wider flex items-center gap-1.5">
                    <Video size={11} /> Random Videos
                  </div>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                  {creatorVideos.map(vid => (
                    <div key={vid.id}
                         onClick={() => navigate(`/galleries/${vid.gallery_id}`)}
                         className="rounded-[10px] overflow-hidden cursor-pointer group relative flex-shrink-0"
                         style={{ width: 195, aspectRatio: '2/3', background: '#1a1a1a', border: '0.5px solid rgba(255,255,255,0.08)' }}>
                      <div className="w-full h-full flex items-center justify-center"
                           style={{ background: 'rgba(255,255,255,0.03)' }}>
                        <img src={`/api/images/${vid.id}/thumb`} alt={vid.filename}
                             className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                             onError={e => { e.target.style.display = 'none' }} />
                      </div>
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                           style={{ background: 'rgba(0,0,0,0.4)' }}>
                        <Play size={24} color="white" />
                      </div>
                      <div className="absolute inset-x-0 bottom-0 p-2 pt-6"
                           style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.88) 0%, transparent 100%)' }}>
                        <div className="text-[13px] text-white truncate leading-tight">{vid.filename}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Random Galleries */}
            <GalleryScroll
              title="Random Galleries"
              icon={Shuffle}
              galleries={randomGalleries}
              onGalleryClick={(gid) => navigate(`/galleries/${gid}`)}
            />

            {/* Lore */}
            {creator.lore && (
              <div className="vault-card p-4">
                <div className="text-[11px] font-medium text-[rgba(255,255,255,0.5)] mb-2 uppercase tracking-wider">Lore</div>
                <div className="text-[12px] text-[rgba(255,255,255,0.65)] leading-relaxed">{creator.lore}</div>
                {creator.wiki_source && (
                  <div className="text-[10px] mt-2 flex items-center gap-1" style={{ color: '#7F77DD' }}>
                    <Globe size={10} /> {creator.wiki_source}
                  </div>
                )}
              </div>
            )}

            {/* Character info */}
            {creator.creator_type === 'character' && (
              <div className="vault-card p-4">
                <div className="text-[11px] font-medium text-[rgba(255,255,255,0.5)] uppercase tracking-wider mb-2">Character Info</div>
                {[
                  ['Origin',    creator.origin],
                  ['Series',    creator.series],
                  ['Developer', creator.developer],
                  ['Year',      creator.release_year],
                  ['Type',      creator.character_type],
                  ['Voice',     creator.voice_actor],
                ].filter(([, v]) => v).map(([k, v]) => (
                  <div key={k} className="flex justify-between py-1 border-b border-[rgba(255,255,255,0.05)] last:border-0">
                    <span className="text-[10px] text-[rgba(255,255,255,0.3)]">{k}</span>
                    <span className="text-[10px] text-[rgba(255,255,255,0.65)] text-right ml-2">{v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right column — Top Images (sticky) */}
          {(topImages ?? []).length > 0 && (
            <div className="vault-card p-4" style={{ alignSelf: 'start', position: 'sticky', top: 12 }}>
              <div className="text-[11px] font-medium text-[rgba(255,255,255,0.5)] uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Droplets size={11} /> Top Images
              </div>
              <div className="grid grid-cols-2 gap-2">
                {topImages.map((img, i) => (
                  <div key={img.id}
                       onClick={() => navigate(`/galleries/${img.gallery_id}`)}
                       className="rounded-[8px] overflow-hidden cursor-pointer group relative"
                       style={{ aspectRatio: '1', background: 'rgba(255,255,255,0.05)' }}>
                    <img src={`/api/images/${img.id}/thumb`} alt=""
                         className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                         onError={e => { e.target.style.display = 'none' }} />
                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-1.5 py-1.5"
                         style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)' }}>
                      <span className="text-[9px] text-[rgba(255,255,255,0.4)]">#{i+1}</span>
                      <span className="text-[10px] flex items-center gap-0.5 font-medium" style={{ color: '#D4537E' }}>
                        <Droplets size={8} />{img.cum_count}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showAvatarModal && (
        <AvatarModal
          creatorId={parseInt(id)}
          onClose={() => setShowAvatarModal(false)}
          onSuccess={() => { setShowAvatarModal(false); setAvatarFailed(false); bumpAvatarBust() }}
        />
      )}
      {showEditModal && <EditCreatorModal creator={creator} onClose={() => setShowEditModal(false)} />}

      {/* Avatar zoom lightbox */}
      {showAvatarZoom && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(12px)', animation: 'fadeIn 0.18s ease' }}
          onClick={() => setShowAvatarZoom(false)}
        >
          <div
            style={{ animation: 'zoomIn 0.22s cubic-bezier(0.34,1.56,0.64,1)' }}
            onClick={e => e.stopPropagation()}
          >
            <img
              src={`/api/creators/${id}/avatar?v=${new Date(creator.updated_at || 0).getTime()}_${avatarBust}`}
              alt={creator.name}
              className="rounded-[24px] shadow-2xl"
              style={{ maxHeight: '85vh', maxWidth: '85vw', objectFit: 'contain', border: `3px solid ${rc}`, boxShadow: `0 0 80px ${rc}55` }}
            />
            <div className="text-center mt-3 text-[14px] font-semibold" style={{ color: 'rgba(255,255,255,0.7)' }}>
              {creator.name}
            </div>
          </div>
          <style>{`
            @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
            @keyframes zoomIn { from { transform: scale(0.6); opacity: 0 } to { transform: scale(1); opacity: 1 } }
          `}</style>
        </div>
      )}

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.75)' }}>
          <div className="rounded-[16px] p-7 w-[420px] text-center shadow-2xl"
               style={{ background: '#1a1a1a', border: '0.5px solid rgba(255,255,255,0.12)' }}>
            <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
                 style={{ background: 'rgba(212,83,126,0.15)', border: '1px solid rgba(212,83,126,0.35)' }}>
              <Trash2 size={22} style={{ color: '#ED93B1' }} />
            </div>
            <div className="text-[17px] font-semibold text-white mb-2">Delete {creator.name}?</div>
            <div className="text-[13px] mb-6" style={{ color: 'rgba(255,255,255,0.45)', lineHeight: 1.55 }}>
              This will permanently remove this creator and all their data from The Vault. This action is irreversible.
            </div>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(false)}
                      className="flex-1 py-2.5 rounded-[10px] text-[13px] cursor-pointer"
                      style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
                Cancel
              </button>
              <button onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}
                      className="flex-1 py-2.5 rounded-[10px] text-[13px] font-medium cursor-pointer"
                      style={{ background: 'rgba(212,83,126,0.25)', color: '#ED93B1', border: '0.5px solid rgba(212,83,126,0.45)' }}>
                {deleteMutation.isPending ? 'Deleting...' : 'Yes, delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
