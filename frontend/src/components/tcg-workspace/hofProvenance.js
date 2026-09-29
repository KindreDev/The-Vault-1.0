export function formatHofAwardDescription(provenance, t) {
  if (!provenance || !provenance.recipient_name) return null
  const period = provenance.period_label || provenance.board_label
  const categories = {
    creator: 'Creator',
    photo: 'Photo',
    video: 'Video',
    gallery: 'Gallery',
    media: 'Media',
  }
  const category = t(categories[provenance.recipient_type] || 'Media')
  return t('Awarded to {name} for winning the {category} Hall of Fame, {period}.', {
    name: provenance.recipient_name, category, period,
  })
}
