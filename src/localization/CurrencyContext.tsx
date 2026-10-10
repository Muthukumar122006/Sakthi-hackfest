import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { countries, suggestCountryFromLocale } from '../data/countries'
import { useAuth } from '../auth/AuthContext'

const storageKey = 'edugen-smart-preferences'
const defaultCountry = typeof navigator === 'undefined'
  ? countries[0]
  : suggestCountryFromLocale(navigator.language)

type SavedPreferences = { countryIso?: string; currency?: string; currencyOverridden?: boolean }
type CurrencyContextValue = {
  countryIso: string
  currency: string
  currencyOverridden: boolean
  locale: string
  rate: number | null
  rateDate: string | null
  rateLoading: boolean
  rateError: string | null
  saveError: string | null
  formatAmount: (usdAmount: number) => string
  setCountryIso: (iso: string) => void
  setCurrency: (currency: string) => void
  resetCurrency: () => void
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null)

function readSavedPreferences(): SavedPreferences {
  try {
    const saved = window.localStorage.getItem(storageKey)
    return saved ? JSON.parse(saved) as SavedPreferences : {}
  } catch {
    return {}
  }
}

const initialPreferences = readSavedPreferences()
const initialCountry = countries.find((country) => country.iso === initialPreferences.countryIso) ?? defaultCountry
const initialCurrencyOverridden = initialPreferences.currencyOverridden
  ?? Boolean(initialPreferences.currency && initialPreferences.currency !== initialCountry.currency)

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth()
  const [countryIso, setCountryIso] = useState(initialCountry.iso)
  const [currency, setCurrency] = useState(initialPreferences.currency ?? initialCountry.currency)
  const [currencyOverridden, setCurrencyOverridden] = useState(initialCurrencyOverridden)
  const [rate, setRate] = useState<number | null>(currency === 'USD' ? 1 : null)
  const [rateDate, setRateDate] = useState<string | null>(null)
  const [rateLoading, setRateLoading] = useState(false)
  const [rateError, setRateError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const selectedCountry = countries.find((country) => country.iso === countryIso) ?? defaultCountry
  const locale = selectedCountry.locale

  useEffect(() => {
    if (authLoading || !user) return
    const metadata = user.user_metadata as {
      edugenCountry?: string
      edugenCurrency?: string
      edugenCurrencyOverridden?: boolean
    }
    const savedCountry = countries.find((country) => country.iso === metadata.edugenCountry)
    if (savedCountry) setCountryIso(savedCountry.iso)
    if (typeof metadata.edugenCurrency === 'string') setCurrency(metadata.edugenCurrency)
    if (typeof metadata.edugenCurrencyOverridden === 'boolean') setCurrencyOverridden(metadata.edugenCurrencyOverridden)
    else if (savedCountry && typeof metadata.edugenCurrency === 'string') {
      setCurrencyOverridden(metadata.edugenCurrency !== savedCountry.currency)
    }
  }, [authLoading, user])

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ countryIso, currency, currencyOverridden }))
    } catch {
      setSaveError('Could not save preferences in this browser. Check storage permissions.')
    }
  }, [countryIso, currency, currencyOverridden])

  useEffect(() => {
    if (authLoading || !user) return
    let active = true
    setSaveError(null)
    void import('../auth/supabase').then(({ supabase }) => {
      if (!supabase) return
      return supabase.auth.updateUser({
        data: { edugenCountry: countryIso, edugenCurrency: currency, edugenCurrencyOverridden: currencyOverridden },
      })
    }).then((result) => {
      if (!active || !result?.error) return
      setSaveError(`Account preference could not be saved: ${result.error.message}`)
    }).catch((error: unknown) => {
      if (active) setSaveError(error instanceof Error ? error.message : 'Account preference could not be saved.')
    })
    return () => { active = false }
  }, [authLoading, countryIso, currency, currencyOverridden, user])

  useEffect(() => {
    if (currency === 'USD') {
      setRate(1)
      setRateDate(null)
      setRateError(null)
      return
    }

    const controller = new AbortController()
    setRate(null)
    setRateDate(null)
    setRateLoading(true)
    setRateError(null)
    void fetch(`https://api.frankfurter.dev/v1/latest?base=USD&symbols=${encodeURIComponent(currency)}`, {
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Exchange-rate service returned ${response.status}.`)
      const result: { date?: string; rates?: Record<string, number> } = await response.json()
      const value = result.rates?.[currency]
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || !result.date) {
        throw new Error(`No USD to ${currency} exchange rate is available.`)
      }
      setRate(value)
      setRateDate(result.date)
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      setRateError(error instanceof Error ? error.message : 'Exchange rate is unavailable.')
    }).finally(() => {
      if (!controller.signal.aborted) setRateLoading(false)
    })
    return () => controller.abort()
  }, [currency])

  const formatAmount = useCallback((usdAmount: number) => {
    const canConvert = currency === 'USD' || rate !== null
    const amount = currency === 'USD' ? usdAmount : canConvert ? usdAmount * (rate ?? 1) : usdAmount
    const currencyToDisplay = canConvert ? currency : 'USD'
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyToDisplay,
      maximumFractionDigits: currencyToDisplay === 'JPY' ? 0 : 2,
    }).format(amount)
  }, [currency, locale, rate])

  const setCountry = useCallback((iso: string) => {
    const nextCountry = countries.find((country) => country.iso === iso)
    if (!nextCountry) return
    setCountryIso(nextCountry.iso)
    if (!currencyOverridden) setCurrency(nextCountry.currency)
  }, [currencyOverridden])
  const changeCurrency = useCallback((nextCurrency: string) => {
    if (nextCurrency !== 'USD' && !countries.some((country) => country.currency === nextCurrency)) return
    setCurrency(nextCurrency)
    setCurrencyOverridden(nextCurrency !== selectedCountry.currency)
  }, [selectedCountry.currency])
  const resetCurrency = useCallback(() => {
    setCurrency(selectedCountry.currency)
    setCurrencyOverridden(false)
  }, [selectedCountry.currency])

  const value = useMemo<CurrencyContextValue>(() => ({
    countryIso,
    currency,
    currencyOverridden,
    locale,
    rate,
    rateDate,
    rateLoading,
    rateError,
    saveError,
    formatAmount,
    setCountryIso: setCountry,
    setCurrency: changeCurrency,
    resetCurrency,
  }), [changeCurrency, countryIso, currency, currencyOverridden, formatAmount, locale, rate, rateDate, rateError, rateLoading, resetCurrency, saveError, setCountry])

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
}

export function useCurrency() {
  const value = useContext(CurrencyContext)
  if (!value) throw new Error('useCurrency must be used within CurrencyProvider.')
  return value
}
