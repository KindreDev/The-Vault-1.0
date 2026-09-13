export const COUNTRIES = [
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda", "Argentina", "Armenia", 
  "Australia", "Austria", "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", 
  "Belgium", "Belize", "Benin", "Bhutan", "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", 
  "Brunei", "Bulgaria", "Burkina Faso", "Burundi", "Cabo Verde", "Cambodia", "Cameroon", "Canada", 
  "Central African Republic", "Chad", "Chile", "China", "Colombia", "Comoros", "Congo, Democratic Republic of the", 
  "Congo, Republic of the", "Costa Rica", "Côte d'Ivoire", "Croatia", "Cuba", "Cyprus", "Czechia (Czech Republic)", 
  "Denmark", "Djibouti", "Dominica", "Dominican Republic", "East Timor (Timor-Leste)", "Ecuador", "Egypt", 
  "El Salvador", "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini (Swaziland)", "Ethiopia", "Fiji", 
  "Finland", "France", "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada", 
  "Guatemala", "Guinea", "Guinea-Bissau", "Guyana", "Haiti", "Holy See (Vatican City)", "Honduras", 
  "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy", 
  "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kiribati", "Korea, North", "Korea, South", 
  "Kuwait", "Kyrgyzstan", "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein", 
  "Lithuania", "Luxembourg", "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali", "Malta", 
  "Marshall Islands", "Mauritania", "Mauritius", "Mexico", "Micronesia", "Moldova", "Monaco", "Mongolia", 
  "Montenegro", "Morocco", "Mozambique", "Myanmar (Burma)", "Namibia", "Nauru", "Nepal", "Netherlands", 
  "New Zealand", "Nicaragua", "Niger", "Nigeria", "North Macedonia", "Norway", "Oman", "Pakistan", 
  "Palau", "Palestine", "Panama", "Papua New Guinea", "Paraguay", "Peru", "Philippines", "Poland", 
  "Portugal", "Qatar", "Romania", "Russia", "Rwanda", "Saint Kitts and Nevis", "Saint Lucia", 
  "Saint Vincent and the Grenadines", "Samoa", "San Marino", "São Tomé and Príncipe", "Saudi Arabia", 
  "Senegal", "Serbia", "Seychelles", "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "Solomon Islands", 
  "Somalia", "South Africa", "South Sudan", "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden", 
  "Switzerland", "Syria", "Taiwan", "Tajikistan", "Tanzania", "Thailand", "Togo", "Tonga", 
  "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan", "Tuvalu", "Uganda", "Ukraine", 
  "United Arab Emirates", "United Kingdom", "United States", "Uruguay", "Uzbekistan", "Vanuatu", 
  "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe"
];

// ISO 3166-1 alpha-2 codes used by flag-icons. Keep this alongside the
// canonical country list so every selectable country renders a flag, rather
// than maintaining a partial per-page lookup table.
const COUNTRY_ISO = {
  Afghanistan: 'af', Albania: 'al', Algeria: 'dz', Andorra: 'ad', Angola: 'ao',
  'Antigua and Barbuda': 'ag', Argentina: 'ar', Armenia: 'am', Australia: 'au', Austria: 'at',
  Azerbaijan: 'az', Bahamas: 'bs', Bahrain: 'bh', Bangladesh: 'bd', Barbados: 'bb', Belarus: 'by',
  Belgium: 'be', Belize: 'bz', Benin: 'bj', Bhutan: 'bt', Bolivia: 'bo',
  'Bosnia and Herzegovina': 'ba', Botswana: 'bw', Brazil: 'br', Brunei: 'bn', Bulgaria: 'bg',
  'Burkina Faso': 'bf', Burundi: 'bi', 'Cabo Verde': 'cv', Cambodia: 'kh', Cameroon: 'cm',
  Canada: 'ca', 'Central African Republic': 'cf', Chad: 'td', Chile: 'cl', China: 'cn', Colombia: 'co',
  Comoros: 'km', 'Congo, Democratic Republic of the': 'cd', 'Congo, Republic of the': 'cg',
  'Costa Rica': 'cr', 'Côte d’Ivoire': 'ci', 'Cote d\'Ivoire': 'ci', Croatia: 'hr', Cuba: 'cu',
  Cyprus: 'cy', 'Czechia (Czech Republic)': 'cz', Denmark: 'dk', Djibouti: 'dj', Dominica: 'dm',
  'Dominican Republic': 'do', 'East Timor (Timor-Leste)': 'tl', Ecuador: 'ec', Egypt: 'eg',
  'El Salvador': 'sv', 'Equatorial Guinea': 'gq', Eritrea: 'er', Estonia: 'ee',
  'Eswatini (Swaziland)': 'sz', Ethiopia: 'et', Fiji: 'fj', Finland: 'fi', France: 'fr', Gabon: 'ga',
  Gambia: 'gm', Georgia: 'ge', Germany: 'de', Ghana: 'gh', Greece: 'gr', Grenada: 'gd',
  Guatemala: 'gt', Guinea: 'gn', 'Guinea-Bissau': 'gw', Guyana: 'gy', Haiti: 'ht',
  'Holy See (Vatican City)': 'va', Honduras: 'hn', Hungary: 'hu', Iceland: 'is', India: 'in',
  Indonesia: 'id', Iran: 'ir', Iraq: 'iq', Ireland: 'ie', Israel: 'il', Italy: 'it', Jamaica: 'jm',
  Japan: 'jp', Jordan: 'jo', Kazakhstan: 'kz', Kenya: 'ke', Kiribati: 'ki', 'Korea, North': 'kp',
  'Korea, South': 'kr', Kuwait: 'kw', Kyrgyzstan: 'kg', Laos: 'la', Latvia: 'lv', Lebanon: 'lb',
  Lesotho: 'ls', Liberia: 'lr', Libya: 'ly', Liechtenstein: 'li', Lithuania: 'lt', Luxembourg: 'lu',
  Madagascar: 'mg', Malawi: 'mw', Malaysia: 'my', Maldives: 'mv', Mali: 'ml', Malta: 'mt',
  'Marshall Islands': 'mh', Mauritania: 'mr', Mauritius: 'mu', Mexico: 'mx', Micronesia: 'fm',
  Moldova: 'md', Monaco: 'mc', Mongolia: 'mn', Montenegro: 'me', Morocco: 'ma', Mozambique: 'mz',
  'Myanmar (Burma)': 'mm', Namibia: 'na', Nauru: 'nr', Nepal: 'np', Netherlands: 'nl',
  'New Zealand': 'nz', Nicaragua: 'ni', Niger: 'ne', Nigeria: 'ng', 'North Macedonia': 'mk', Norway: 'no',
  Oman: 'om', Pakistan: 'pk', Palau: 'pw', Palestine: 'ps', Panama: 'pa',
  'Papua New Guinea': 'pg', Paraguay: 'py', Peru: 'pe', Philippines: 'ph', Poland: 'pl', Portugal: 'pt',
  Qatar: 'qa', Romania: 'ro', Russia: 'ru', Rwanda: 'rw', 'Saint Kitts and Nevis': 'kn',
  'Saint Lucia': 'lc', 'Saint Vincent and the Grenadines': 'vc', Samoa: 'ws', 'San Marino': 'sm',
  'São Tomé and Príncipe': 'st', 'Sao Tome and Principe': 'st', 'Saudi Arabia': 'sa', Senegal: 'sn',
  Serbia: 'rs', Seychelles: 'sc', 'Sierra Leone': 'sl', Singapore: 'sg', Slovakia: 'sk', Slovenia: 'si',
  'Solomon Islands': 'sb', Somalia: 'so', 'South Africa': 'za', 'South Sudan': 'ss', Spain: 'es',
  'Sri Lanka': 'lk', Sudan: 'sd', Suriname: 'sr', Sweden: 'se', Switzerland: 'ch', Syria: 'sy',
  Taiwan: 'tw', Tajikistan: 'tj', Tanzania: 'tz', Thailand: 'th', Togo: 'tg', Tonga: 'to',
  'Trinidad and Tobago': 'tt', Tunisia: 'tn', Turkey: 'tr', Turkmenistan: 'tm', Tuvalu: 'tv',
  Uganda: 'ug', Ukraine: 'ua', 'United Arab Emirates': 'ae', 'United Kingdom': 'gb', 'United States': 'us',
  Uruguay: 'uy', Uzbekistan: 'uz', Vanuatu: 'vu', Venezuela: 've', Vietnam: 'vn', Yemen: 'ye',
  Zambia: 'zm', Zimbabwe: 'zw', USA: 'us', UK: 'gb', 'South Korea': 'kr', 'North Korea': 'kp', Czechia: 'cz',
}

const normalizeCountryKey = value => String(value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const NORMALIZED_COUNTRY_ISO = Object.fromEntries(
  Object.entries(COUNTRY_ISO).map(([name, code]) => [normalizeCountryKey(name).toLowerCase(), code])
)

/** Return a flag-icons ISO code for any country value stored by the app. */
export function countryIso(country) {
  const value = String(country || '').trim()
  if (!value) return null
  if (/^[A-Za-z]{2}$/.test(value)) return value.toLowerCase()
  return NORMALIZED_COUNTRY_ISO[normalizeCountryKey(value).toLowerCase()] || null
}
