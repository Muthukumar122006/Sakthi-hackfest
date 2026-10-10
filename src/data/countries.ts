import type { CountryCode } from 'libphonenumber-js'

export type Country = {
  iso: CountryCode
  name: string
  flag: string
  callingCode: string
  currency: string
  locale: string
}

export const countries: Country[] = [
  { iso: 'IN', name: 'India', flag: '🇮🇳', callingCode: '+91', currency: 'INR', locale: 'en-IN' },
  { iso: 'US', name: 'United States', flag: '🇺🇸', callingCode: '+1', currency: 'USD', locale: 'en-US' },
  { iso: 'GB', name: 'United Kingdom', flag: '🇬🇧', callingCode: '+44', currency: 'GBP', locale: 'en-GB' },
  { iso: 'DE', name: 'Germany', flag: '🇩🇪', callingCode: '+49', currency: 'EUR', locale: 'de-DE' },
  { iso: 'FR', name: 'France', flag: '🇫🇷', callingCode: '+33', currency: 'EUR', locale: 'fr-FR' },
  { iso: 'JP', name: 'Japan', flag: '🇯🇵', callingCode: '+81', currency: 'JPY', locale: 'ja-JP' },
  { iso: 'CA', name: 'Canada', flag: '🇨🇦', callingCode: '+1', currency: 'CAD', locale: 'en-CA' },
  { iso: 'AU', name: 'Australia', flag: '🇦🇺', callingCode: '+61', currency: 'AUD', locale: 'en-AU' },
  { iso: 'SG', name: 'Singapore', flag: '🇸🇬', callingCode: '+65', currency: 'SGD', locale: 'en-SG' },
  { iso: 'AE', name: 'United Arab Emirates', flag: '🇦🇪', callingCode: '+971', currency: 'AED', locale: 'en-AE' },
]

export const currencies = [...new Set(countries.map((country) => country.currency))]

export function suggestCountryFromLocale(locale?: string): Country {
  const localeCountry = locale?.split('-')[1]?.toUpperCase()
  return countries.find((country) => country.iso === localeCountry) ?? countries[0]
}
