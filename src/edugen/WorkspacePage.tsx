import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { ArrowLeft, BookOpen, ChartNoAxesCombined, ClipboardList, Database, Gauge, Settings, ShieldCheck, Sparkles } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { isSupabaseConfigured, supabase } from '../auth/supabase'
import { useCurrency } from '../localization/CurrencyContext'
import { countries, currencies } from '../data/countries'
import { categoryLabels, creativeCategories, type CreativeCategory } from './intent'
import {
  loadAssets,
  loadAssetsForReview,
  loadAssetReviewHistory,
  loadMemberships,
  loadProfilePreferences,
  loadRequests,
  saveProfilePreferences,
  approveSchoolAsset,
  rejectSchoolAsset,
  type EducationalAsset,
  type AssetReviewHistoryEntry,
  type ImageRequest,
  type Membership,
} from './repository'

export type WorkspacePageName = 'dashboard' | 'history' | 'library' | 'analytics' | 'budgets' | 'settings'
type BudgetEntry = { id: string; school_id: string; amount: number; currency: string; entry_type: string; recorded_at: string }

const pageInfo: Record<WorkspacePageName, { title: string; description: string }> = {
  dashboard: { title: 'Overview', description: 'See your recent image requests and school activity.' },
  history: { title: 'Request history', description: 'Review image requests and their current status.' },
  library: { title: 'Shared image library', description: 'Find approved images that your school can reuse.' },
  analytics: { title: 'Costs and savings', description: 'Compare recorded costs and resource use.' },
  budgets: { title: 'School budgets', description: 'Check monthly spending and budget limits.' },
  settings: { title: 'Settings', description: 'Set your display currency and image defaults.' },
}

const demoRequests: ImageRequest[] = [
  { id: 'demo-1', prompt: 'Mango outline for a young children’s colouring sheet', subject: '', grade: '', category: 'educational', target_audience: 'Young children: ages 6–8', intent: 'colouring_worksheet', quality_tier: 'draft-rapid', language: 'en', style: 'Line art', state: 'reused', method: 'Shared library', reused_asset_id: 'asset-1', output_asset_id: null, quality_state: 'not_checked', provider_charge: null, provider_currency: null, baseline_estimate: null, optimized_estimate: null, savings_estimate: null, savings_percentage: null, calculation_method: null, estimate_currency: null, pricing_source_url: null, pricing_effective_from: null, school_id: 'demo-school', cost_source: 'demo', created_at: '2026-10-08T10:00:00Z' },
  { id: 'demo-2', prompt: 'Parts of a plant study card', subject: '', grade: '', category: 'educational', target_audience: 'Older children: ages 9–12', intent: 'flashcard', quality_tier: 'precision-lite', language: 'en', style: 'Simple labels', state: 'draft', method: null, reused_asset_id: null, output_asset_id: null, quality_state: null, provider_charge: null, provider_currency: null, baseline_estimate: null, optimized_estimate: null, savings_estimate: null, savings_percentage: null, calculation_method: null, estimate_currency: null, pricing_source_url: null, pricing_effective_from: null, school_id: 'demo-school', cost_source: 'demo', created_at: '2026-10-09T10:00:00Z' },
  { id: 'demo-3', prompt: 'Water cycle classroom poster', subject: '', grade: '', category: 'educational', target_audience: 'Older children: ages 9–12', intent: 'educational_poster', quality_tier: 'studio-pro', language: 'en', style: 'Flat colours', state: 'failed', method: null, reused_asset_id: null, output_asset_id: null, quality_state: 'failed', provider_charge: null, provider_currency: null, baseline_estimate: null, optimized_estimate: null, savings_estimate: null, savings_percentage: null, calculation_method: null, estimate_currency: null, pricing_source_url: null, pricing_effective_from: null, school_id: 'demo-school', cost_source: 'demo', created_at: '2026-10-10T10:00:00Z' },
]

const demoAssets: EducationalAsset[] = [
  { id: 'asset-1', title: 'Mango outline', description: 'A simple black-and-white outline for a colouring sheet.', subject: 'Science', intent: 'colouring_worksheet', grade: '2', category: 'educational', target_audience: 'Young children: ages 6–8', language: 'en', tags: ['fruit', 'plants'], kind: 'svg', review_state: 'approved', source_url: null, storage_path: null, preview_url: null, licence: 'Demo sample; not for publication', attribution: 'EduGen sample library', created_at: '2026-10-01T10:00:00Z' },
  { id: 'asset-2', title: 'Parts of a plant', description: 'A simple study card for plant parts.', subject: 'Science', intent: 'flashcard', grade: '4', category: 'educational', target_audience: 'Older children: ages 9–12', language: 'en', tags: ['plant', 'biology'], kind: 'template', review_state: 'approved', source_url: null, storage_path: null, preview_url: null, licence: 'Demo sample; not for publication', attribution: 'EduGen sample library', created_at: '2026-10-02T10:00:00Z' },
  { id: 'asset-3', title: 'Water cycle', description: 'A labelled water cycle diagram.', subject: 'Science', intent: 'science_diagram', grade: '5', category: 'educational', target_audience: 'Older children: ages 9–12', language: 'en', tags: ['water', 'cycle'], kind: 'existing', review_state: 'approved', source_url: null, storage_path: null, preview_url: null, licence: 'Demo sample; not for publication', attribution: 'EduGen sample library', created_at: '2026-10-03T10:00:00Z' },
]

const demoMemberships: Membership[] = [
  { school_id: 'demo-school', role: 'admin', school: { id: 'demo-school', name: 'Sample School', district: 'Sample District', monthly_budget: 100, warning_threshold: 80, budget_currency: 'USD' } },
]

const intentOptionsForAssets = [
  ['colouring_worksheet', 'Colouring sheet'],
  ['flashcard', 'Study card'],
  ['textbook_illustration', 'Book picture'],
  ['science_diagram', 'Science diagram'],
  ['educational_poster', 'Poster'],
  ['general_illustration', 'Other picture'],
]

function displayIntent(intent: string) {
  return intent.replace(/_/g, ' ')
}

function displayStatus(status: string) {
  return status.replace(/_/g, ' ')
}

export function WorkspacePage({ page }: { page: WorkspacePageName }) {
  const { user } = useAuth()
  const { countryIso, currency, currencyOverridden, setCountryIso, setCurrency, resetCurrency } = useCurrency()
  const [requests, setRequests] = useState<ImageRequest[]>([])
  const [assets, setAssets] = useState<EducationalAsset[]>([])
  const [reviewAssets, setReviewAssets] = useState<EducationalAsset[]>([])
  const [reviewHistory, setReviewHistory] = useState<AssetReviewHistoryEntry[]>([])
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [budgetEntries, setBudgetEntries] = useState<BudgetEntry[]>([])
  const [search, setSearch] = useState('')
  const [assetIntentFilter, setAssetIntentFilter] = useState('')
  const [assetCategoryFilter, setAssetCategoryFilter] = useState('')
  const [assetAudienceFilter, setAssetAudienceFilter] = useState('')
  const [assetLanguageFilter, setAssetLanguageFilter] = useState('')
  const [loading, setLoading] = useState(isSupabaseConfigured && Boolean(user))
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [language, setLanguage] = useState('en')
  const [defaultCategory, setDefaultCategory] = useState<CreativeCategory>('educational')
  const [defaultAudience, setDefaultAudience] = useState('All ages')
  const [style, setStyle] = useState('')
  const [budget, setBudget] = useState('')

  const demoMode = !isSupabaseConfigured || !user
  const activeMembership = memberships[0]
  const isSchoolAdmin = activeMembership?.role === 'admin'
  const school = activeMembership?.school ?? null

  useEffect(() => {
    if (demoMode) {
      setRequests(demoRequests)
      setAssets(demoAssets)
      setMemberships(demoMemberships)
      setBudgetEntries([
        { id: 'demo-entry-1', school_id: 'demo-school', amount: 14.5, currency: 'USD', entry_type: 'estimated', recorded_at: '2026-10-05T10:00:00Z' },
        { id: 'demo-entry-2', school_id: 'demo-school', amount: 8.25, currency: 'USD', entry_type: 'baseline', recorded_at: '2026-10-05T10:00:00Z' },
      ])
      setLoading(false)
      setError(null)
      return
    }

    let active = true
    setLoading(true)
    setError(null)
    const client = supabase
    if (!client) {
      setLoading(false)
      return
    }

    const tasks: PromiseLike<unknown>[] = [
      loadMemberships().then((items) => { if (active) setMemberships(items) }),
    ]
    if (page === 'history' || page === 'dashboard' || page === 'analytics') {
      tasks.push(loadRequests().then((items) => { if (active) setRequests(items) }))
    }
    if (page === 'library') {
      tasks.push(loadAssets(search).then((items) => { if (active) setAssets(items) }))
    }
    if (page === 'settings') {
      tasks.push(loadProfilePreferences(user).then((profile) => {
        if (!active || !profile) return
        if (profile.phone_country_iso) setCountryIso(profile.phone_country_iso)
        else if (profile.country_iso) setCountryIso(profile.country_iso)
        if (profile.preferred_currency) setCurrency(profile.preferred_currency)
        if (!profile.currency_overridden && (profile.phone_country_iso || profile.country_iso)) {
          const country = countries.find((item) => item.iso === (profile.phone_country_iso ?? profile.country_iso))
          if (country) setCurrency(country.currency)
        }
        setLanguage(profile.preferred_language ?? 'en')
        setDefaultCategory(profile.default_category ?? 'educational')
        setDefaultAudience(profile.default_audience ?? 'All ages')
        setStyle(profile.default_style ?? '')
      }))
    }
    if (page === 'budgets' || page === 'analytics') {
      tasks.push(client.from('school_budget_entries')
        .select('id,school_id,amount,currency,entry_type,recorded_at')
        .order('recorded_at', { ascending: false })
        .limit(500)
        .then(({ data, error: queryError }) => {
          if (queryError) throw queryError
          if (active) setBudgetEntries((data ?? []) as BudgetEntry[])
        }))
    }
    void Promise.all(tasks).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load this page.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [demoMode, page, search, setCountryIso, setCurrency, user])

  const reviewSchoolIds = memberships.filter((membership) => membership.role === 'admin').map((membership) => membership.school_id)
  useEffect(() => {
    if (demoMode || page !== 'library' || (reviewSchoolIds.length === 0 && !user)) {
      setReviewAssets([])
      setReviewHistory([])
      return
    }
    let active = true
    const reviewQueues = [
      ...reviewSchoolIds.map((schoolId) => loadAssetsForReview(schoolId)),
      ...(user ? [loadAssetsForReview(null)] : []),
    ]
    void Promise.all([
      Promise.all(reviewQueues),
      user ? loadAssetReviewHistory() : Promise.resolve([] as AssetReviewHistoryEntry[]),
    ]).then(([queues, history]) => {
      if (active) {
        setReviewAssets([...new Map(queues.flat().map((asset) => [asset.id, asset])).values()])
        setReviewHistory(history)
      }
    }).catch((reviewError: unknown) => {
      if (active) setError(reviewError instanceof Error ? reviewError.message : 'Could not load images for review.')
    })
    return () => { active = false }
  }, [demoMode, page, reviewSchoolIds.join(','), user])

  const visibleRequests = useMemo(() => requests, [requests])
  const visibleAssets = useMemo(() => assets.filter((asset) =>
    (!assetIntentFilter || asset.intent === assetIntentFilter)
    && (!assetCategoryFilter || asset.category === assetCategoryFilter)
    && (!assetAudienceFilter || asset.target_audience === assetAudienceFilter)
    && (!assetLanguageFilter || asset.language === assetLanguageFilter),
  ), [assetAudienceFilter, assetCategoryFilter, assetIntentFilter, assetLanguageFilter, assets])
  const schoolBudgetEntries = budgetEntries.filter((entry) => entry.school_id === school?.id)
  const currentMonth = new Date().toISOString().slice(0, 7)
  const spendThisMonth = schoolBudgetEntries
    .filter((entry) => entry.entry_type !== 'baseline'
      && entry.currency === school?.budget_currency
      && entry.recorded_at.slice(0, 7) === currentMonth)
    .reduce((total, entry) => total + Number(entry.amount), 0)
  const formatMoney = (amount: number, moneyCurrency = currency) => new Intl.NumberFormat('en', {
    style: 'currency', currency: moneyCurrency, maximumFractionDigits: 2,
  }).format(amount)

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setNotice(null)
    setError(null)
    if (!user) {
      setNotice('Sign in and connect Supabase to save these settings to your account. Your country and currency are saved in this browser.')
      return
    }
    try {
      await saveProfilePreferences(user, {
        country_iso: countryIso,
        phone_country_iso: (user.user_metadata.edugenPhoneCountryIso as string | undefined) ?? countryIso,
        phone_calling_code: (user.user_metadata.edugenCallingCode as string | undefined) ?? null,
        preferred_currency: currency,
        currency_overridden: currencyOverridden,
        preferred_language: language,
        default_category: defaultCategory,
        default_audience: defaultAudience,
        default_style: style,
      })
      setNotice('Your settings were saved.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save your settings.')
    }
  }

  const updateSchoolBudget = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setNotice(null)
    setError(null)
    if (!school || !isSchoolAdmin || !supabase) {
      setError('Only a signed-in school admin can change this budget.')
      return
    }
    const amount = Number(budget)
    if (!Number.isFinite(amount) || amount < 0) {
      setError('Enter a budget of zero or more.')
      return
    }
    const { error: updateError } = await supabase
      .from('schools')
      .update({ monthly_budget: amount })
      .eq('id', school.id)
    if (updateError) {
      setError(updateError.message)
      return
    }
    setMemberships((current) => current.map((membership) => (
      membership.school_id === school.id && membership.school
        ? { ...membership, school: { ...membership.school, monthly_budget: amount } }
        : membership
    )))
    setNotice('The school budget was updated.')
  }

  const reviewAsset = async (asset: EducationalAsset, decision: 'approved' | 'rejected', note: string) => {
    setNotice(null)
    setError(null)
    try {
      if (decision === 'approved') await approveSchoolAsset(asset.id, note)
      else await rejectSchoolAsset(asset.id, note)
      setReviewAssets((current) => current.filter((item) => item.id !== asset.id))
      if (decision === 'approved') {
        setAssets((current) => [{ ...asset, review_state: 'approved' }, ...current.filter((item) => item.id !== asset.id)])
        setNotice('The image is approved and can now be reused in its permitted scope.')
      } else {
        setAssets((current) => current.filter((item) => item.id !== asset.id))
        setNotice('The image was rejected and will not be available for reuse.')
      }
      setReviewHistory(await loadAssetReviewHistory())
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : `Could not ${decision === 'approved' ? 'approve' : 'reject'} this image.`)
    }
  }

  const info = pageInfo[page]

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark"><BookOpen size={18} /></div>
          <div><p className="eyebrow">For learning</p><h1>EduGen Smart</h1></div>
        </div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          <NavLink className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'} to="/dashboard"><span className="nav-dot" />Overview</NavLink>
          <NavLink className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'} to="/generate"><span className="nav-dot" />Create image</NavLink>
          <NavLink className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'} to="/history"><span className="nav-dot" />Request history</NavLink>
          <NavLink className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'} to="/library"><span className="nav-dot" />Image library</NavLink>
          <NavLink className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'} to="/analytics"><span className="nav-dot" />Costs and savings</NavLink>
          <NavLink className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'} to="/budgets"><span className="nav-dot" />School budgets</NavLink>
          <NavLink className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'} to="/settings"><span className="nav-dot" />Settings</NavLink>
        </nav>
        <div className="sidebar-panel">
          <div className="panel-header"><p className="eyebrow">Account</p><ShieldCheck size={16} /></div>
          <p className="muted">{user?.email ?? 'Guest demo mode'}</p>
          <Link className="workspace-back" to="/generate"><ArrowLeft size={14} /> Image planner</Link>
        </div>
      </aside>

      <main className="content">
        <header className="topbar">
          <div><p className="eyebrow">EduGen Smart</p><h2>{info.title}</h2><p className="page-intro">{info.description}</p></div>
          <div className="topbar-brand"><Sparkles size={17} aria-hidden="true" /><strong>EduGen Smart</strong></div>
          <Link className="ghost-button topbar-actions" to="/generate">Create image</Link>
        </header>

        {demoMode && (
          <div className="demo-banner" role="note">
            <span className="demo-banner-dot" />
            <strong>DEMO DATA</strong>
            <span>These sample records are not real school activity or provider costs.</span>
          </div>
        )}
        {error && <div className="workspace-alert" role="alert">{error}</div>}
        {notice && <div className="workspace-notice" role="status">{notice}</div>}
        {loading ? <p className="workspace-loading" role="status">Loading your school data…</p> : (
          <WorkspaceContent
            page={page}
            requests={visibleRequests}
            assets={visibleAssets}
            reviewAssets={reviewAssets}
            reviewHistory={reviewHistory}
            memberships={memberships}
            schoolBudgetEntries={schoolBudgetEntries}
            spendThisMonth={spendThisMonth}
            school={school}
            isSchoolAdmin={isSchoolAdmin}
            search={search}
            setSearch={setSearch}
            assetIntentFilter={assetIntentFilter}
            setAssetIntentFilter={setAssetIntentFilter}
            assetCategoryFilter={assetCategoryFilter}
            setAssetCategoryFilter={setAssetCategoryFilter}
            assetAudienceFilter={assetAudienceFilter}
            setAssetAudienceFilter={setAssetAudienceFilter}
            assetLanguageFilter={assetLanguageFilter}
            setAssetLanguageFilter={setAssetLanguageFilter}
            formatMoney={formatMoney}
            countryIso={countryIso}
            currency={currency}
            currencyOverridden={currencyOverridden}
            setCurrency={setCurrency}
            resetCurrency={resetCurrency}
            language={language}
            setLanguage={setLanguage}
            defaultCategory={defaultCategory}
            setDefaultCategory={setDefaultCategory}
            defaultAudience={defaultAudience}
            setDefaultAudience={setDefaultAudience}
            style={style}
            setStyle={setStyle}
            budget={budget}
            setBudget={setBudget}
            onSaveSettings={saveSettings}
            onUpdateBudget={updateSchoolBudget}
            onReviewAsset={reviewAsset}
            userEmail={user?.email ?? null}
          />
        )}
      </main>
    </div>
  )
}

type WorkspaceContentProps = {
  page: WorkspacePageName
  requests: ImageRequest[]
  assets: EducationalAsset[]
  reviewAssets: EducationalAsset[]
  reviewHistory: AssetReviewHistoryEntry[]
  memberships: Membership[]
  schoolBudgetEntries: BudgetEntry[]
  spendThisMonth: number
  school: Membership['school']
  isSchoolAdmin: boolean
  search: string
  setSearch: (value: string) => void
  assetIntentFilter: string
  setAssetIntentFilter: (value: string) => void
  assetCategoryFilter: string
  setAssetCategoryFilter: (value: string) => void
  assetAudienceFilter: string
  setAssetAudienceFilter: (value: string) => void
  assetLanguageFilter: string
  setAssetLanguageFilter: (value: string) => void
  formatMoney: (amount: number, currency?: string) => string
  countryIso: string
  currency: string
  currencyOverridden: boolean
  setCurrency: (value: string) => void
  resetCurrency: () => void
  language: string
  setLanguage: (value: string) => void
  defaultCategory: CreativeCategory
  setDefaultCategory: (value: CreativeCategory) => void
  defaultAudience: string
  setDefaultAudience: (value: string) => void
  style: string
  setStyle: (value: string) => void
  budget: string
  setBudget: (value: string) => void
  onSaveSettings: (event: FormEvent<HTMLFormElement>) => void
  onUpdateBudget: (event: FormEvent<HTMLFormElement>) => void
  onReviewAsset: (asset: EducationalAsset, decision: 'approved' | 'rejected', note: string) => void
  userEmail: string | null
}

function WorkspaceContent(props: WorkspaceContentProps) {
  const {
    page, requests, assets, reviewAssets, reviewHistory, memberships, schoolBudgetEntries, spendThisMonth, school, isSchoolAdmin,
    search, setSearch, assetIntentFilter, setAssetIntentFilter, assetCategoryFilter, setAssetCategoryFilter,
    assetAudienceFilter, setAssetAudienceFilter,
    assetLanguageFilter, setAssetLanguageFilter, formatMoney, countryIso, currency, currencyOverridden, setCurrency, resetCurrency,
    language, setLanguage, defaultCategory, setDefaultCategory, defaultAudience, setDefaultAudience, style, setStyle, budget, setBudget,
    onSaveSettings, onUpdateBudget, onReviewAsset, userEmail,
  } = props
  const [analyticsMonth, setAnalyticsMonth] = useState('')
  const [analyticsSchool, setAnalyticsSchool] = useState('')
  const [analyticsIntent, setAnalyticsIntent] = useState('')
  const [analyticsMethod, setAnalyticsMethod] = useState('')
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})
  const analyticsRequests = requests.filter((request) =>
    (!analyticsMonth || request.created_at.slice(0, 7) === analyticsMonth)
    && (!analyticsSchool || request.school_id === analyticsSchool)
    && (!analyticsIntent || request.intent === analyticsIntent)
    && (!analyticsMethod || request.method === analyticsMethod),
  )
  const actualCost = analyticsRequests.reduce((sum, request) => sum + (request.cost_source === 'actual' ? request.provider_charge ?? 0 : 0), 0)
  const reusedCount = analyticsRequests.filter((request) => request.state === 'reused').length
  const failedCount = analyticsRequests.filter((request) => request.quality_state === 'failed').length
  const comparableRequests = analyticsRequests.filter((request) =>
    (request.state === 'generated' || request.state === 'reused')
    && request.baseline_estimate !== null
    && request.optimized_estimate !== null
    && request.estimate_currency !== null)
  const baselineSpend = comparableRequests.reduce((sum, request) => sum + Number(request.baseline_estimate), 0)
  const optimizedSpend = comparableRequests.reduce((sum, request) => sum + Number(request.optimized_estimate), 0)
  const projectedDifference = baselineSpend - optimizedSpend
  const projectedDifferencePercent = baselineSpend > 0 ? Math.round(projectedDifference / baselineSpend * 100) : 0

  if (page === 'settings') return (
    <section className="panel workspace-panel">
      <div className="section-heading"><div><p className="eyebrow">Your defaults</p><h3>Image and account settings</h3></div><Settings size={18} /></div>
      <form className="workspace-form" onSubmit={(event) => void onSaveSettings(event)}>
        <p className="field-hint">Phone country: {countries.find((item) => item.iso === countryIso)?.name ?? 'Not set'}. This is a preference, not proof of residence.</p>
        {currencyOverridden && <button type="button" className="ghost-button reset-currency-button" onClick={resetCurrency}>Use the country’s usual currency</button>}
        <label htmlFor="settings-currency">Display currency
          <select id="settings-currency" value={currency} onChange={(event) => setCurrency(event.target.value)}>
            {currencies.map((item) => <option value={item} key={item}>{item}</option>)}
          </select>
        </label>
        <label htmlFor="settings-language">Image language
          <select id="settings-language" value={language} onChange={(event) => setLanguage(event.target.value)}>
            <option value="en">English</option><option value="hi">Hindi</option><option value="ta">Tamil</option>
          </select>
        </label>
        <label htmlFor="settings-category">Default category
          <select id="settings-category" value={defaultCategory} onChange={(event) => setDefaultCategory(event.target.value as CreativeCategory)}>
            {creativeCategories.map((item) => <option value={item} key={item}>{categoryLabels[item]}</option>)}
          </select>
        </label>
        <label htmlFor="settings-audience">Default target audience
          <select id="settings-audience" value={defaultAudience} onChange={(event) => setDefaultAudience(event.target.value)}>
            <option>Early childhood: ages 3–5</option><option>Young children: ages 6–8</option>
            <option>Older children: ages 9–12</option><option>Teenagers: ages 13–17</option>
            <option>Young adults: ages 18–24</option><option>Adults: ages 25–59</option>
            <option>Older adults: ages 60+</option><option>All ages</option>
          </select>
        </label>
        <label htmlFor="settings-style">Default picture style
          <input id="settings-style" value={style} onChange={(event) => setStyle(event.target.value)} placeholder="For example, simple line art" />
        </label>
        <p className="field-hint">Your default currency comes from the country selected for phone sign-in. You can choose another display currency here.</p>
        <button type="submit" className="primary-button">Save settings</button>
      </form>
      <div className="workspace-subsection"><strong>Sign-in</strong><p>{userEmail ?? 'Guest access is active.'}</p><Link className="ghost-button" to="/login">{userEmail ? 'Account settings' : 'Sign in or create account'}</Link></div>
    </section>
  )

  if (page === 'library') return (
    <section className="panel workspace-panel">
      <div className="section-heading"><div><p className="eyebrow">Approved resources</p><h3>Find an image to reuse</h3></div><Database size={18} /></div>
      <label className="workspace-search" htmlFor="asset-search">Search by title, category or tag
        <input id="asset-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Try plants or water" />
      </label>
      <div className="asset-filters">
        <label htmlFor="asset-intent-filter">Purpose<select id="asset-intent-filter" value={assetIntentFilter} onChange={(event) => setAssetIntentFilter(event.target.value)}>
          <option value="">All purposes</option>{intentOptionsForAssets.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label htmlFor="asset-category-filter">Category<select id="asset-category-filter" value={assetCategoryFilter} onChange={(event) => setAssetCategoryFilter(event.target.value)}>
          <option value="">All categories</option>{creativeCategories.map((value) => <option key={value} value={value}>{categoryLabels[value]}</option>)}
        </select></label>
        <label htmlFor="asset-audience-filter">Target audience<select id="asset-audience-filter" value={assetAudienceFilter} onChange={(event) => setAssetAudienceFilter(event.target.value)}>
          <option value="">All audiences</option>{[...new Set(assets.map((asset) => asset.target_audience).filter(Boolean))].map((value) => <option key={value} value={value}>{value}</option>)}
        </select></label>
        <label htmlFor="asset-language-filter">Language<select id="asset-language-filter" value={assetLanguageFilter} onChange={(event) => setAssetLanguageFilter(event.target.value)}>
          <option value="">All languages</option>{[...new Set(assets.map((asset) => asset.language).filter(Boolean))].map((value) => <option key={value} value={value}>{value}</option>)}
        </select></label>
      </div>
      {assets.length === 0 ? <EmptyState text="No approved images match this search yet." /> : (
        <div className="asset-grid">{assets.map((asset) => (
          <article className="asset-card" key={asset.id}>
            <span className="asset-kind">{asset.kind}</span><h4>{asset.title}</h4>
            {asset.preview_url && <img className="asset-preview" src={asset.preview_url} alt={asset.title} loading="lazy" />}
            <p>{asset.description}</p><dl><div><dt>Category</dt><dd>{categoryLabels[asset.category]}</dd></div><div><dt>Audience</dt><dd>{asset.target_audience}</dd></div><div><dt>Use</dt><dd>{displayIntent(asset.intent)}</dd></div></dl>
            <p className="asset-licence">{asset.licence ?? 'Licence details not provided'}{asset.attribution ? ` · ${asset.attribution}` : ''}</p>
            {asset.source_url && <a href={asset.source_url} target="_blank" rel="noreferrer">Open image</a>}
          </article>
        ))}</div>
      )}
      {reviewAssets.length > 0 && <section className="asset-review-section">
        <h3>Images waiting for review</h3>
        <p className="field-hint">File checks confirm basic format and size only; they do not verify educational accuracy, safety, or suitability.</p>
        <div className="asset-grid">{reviewAssets.map((asset) => <article className="asset-card" key={asset.id}>
          <span className="asset-kind">Needs review</span><h4>{asset.title}</h4>
          {asset.preview_url && <img className="asset-preview" src={asset.preview_url} alt={asset.title} />}
          <p>{asset.description}</p><p className="asset-licence">Review image, content and sharing rights before approving.</p>
          <label htmlFor={`review-note-${asset.id}`}>Review note (required when rejecting)
            <textarea
              id={`review-note-${asset.id}`}
              maxLength={1000}
              value={reviewNotes[asset.id] ?? ''}
              onChange={(event) => setReviewNotes((current) => ({ ...current, [asset.id]: event.target.value }))}
              placeholder="Add feedback or explain the decision"
            />
          </label>
          <button className="primary-button" type="button" onClick={() => onReviewAsset(asset, 'approved', reviewNotes[asset.id] ?? '')}>Approve for permitted reuse</button>
          <button
            className="ghost-button"
            type="button"
            disabled={!(reviewNotes[asset.id] ?? '').trim()}
            onClick={() => onReviewAsset(asset, 'rejected', reviewNotes[asset.id] ?? '')}
          >Reject with feedback</button>
        </article>)}</div>
      </section>}
      {reviewHistory.length > 0 && <section className="asset-review-section">
        <h3>Recent image-review decisions</h3>
        <div className="table-wrap"><table><thead><tr><th>Image</th><th>Decision</th><th>Reviewer ID</th><th>Note</th><th>Date</th></tr></thead><tbody>
          {reviewHistory.map((event) => <tr key={event.id}>
            <td>{event.asset_title}</td>
            <td>{event.new_state}</td>
            <td>{event.reviewer_id}</td>
            <td>{event.note || 'No note recorded'}</td>
            <td>{new Date(event.created_at).toLocaleString()}</td>
          </tr>)}
        </tbody></table></div>
      </section>}
    </section>
  )

  if (page === 'history') return (
    <section className="panel workspace-panel">
      <div className="section-heading"><div><p className="eyebrow">Your requests</p><h3>Recent image activity</h3></div><ClipboardList size={18} /></div>
      {requests.length === 0 ? <EmptyState text="Your saved image requests will appear here." /> : (
        <div className="table-wrap"><table><thead><tr><th>Prompt</th><th>Category</th><th>Target audience</th><th>Purpose</th><th>Quality</th><th>Status</th><th>Cost type</th><th>Date</th></tr></thead><tbody>
          {requests.map((request) => <tr key={request.id}><td>{request.prompt}</td><td>{categoryLabels[request.category]}</td><td>{request.target_audience}</td><td>{displayIntent(request.intent)}</td><td>{request.quality_tier}</td><td><span className={`request-state state-${request.state}`}>{displayStatus(request.state)}{request.state === 'uncertain' ? ' — do not resubmit; administrator review required' : ''}</span></td><td>{request.cost_source}</td><td>{new Date(request.created_at).toLocaleDateString()}</td></tr>)}
        </tbody></table></div>
      )}
    </section>
  )

  if (page === 'analytics') return (
    <>
      <div className="metric-grid">
        <Metric label="Requests" value={String(analyticsRequests.length)} />
        <Metric label="Reused images" value={String(reusedCount)} />
        <Metric label="Recorded real cost" value={formatMoney(actualCost)} />
        <Metric label="Quality checks failed" value={String(failedCount)} />
        <Metric label="Comparable requests" value={String(comparableRequests.length)} />
        <Metric label="Baseline estimate (USD)" value={formatMoney(baselineSpend, 'USD')} />
        <Metric label="Optimized estimate (USD)" value={formatMoney(optimizedSpend, 'USD')} />
        <Metric
          label={`${projectedDifference < 0 ? 'Projected extra cost' : 'Projected savings'} (${Math.abs(projectedDifferencePercent)}%)`}
          value={formatMoney(Math.abs(projectedDifference), 'USD')}
        />
      </div>
      <section className="panel workspace-panel">
        <div className="section-heading"><div><p className="eyebrow">Cost details</p><h3>Recorded costs by request</h3></div><ChartNoAxesCombined size={18} /></div>
        <div className="analytics-filters">
          <label htmlFor="analytics-month">Month<input id="analytics-month" type="month" value={analyticsMonth} onChange={(event) => setAnalyticsMonth(event.target.value)} /></label>
          <label htmlFor="analytics-school">School<select id="analytics-school" value={analyticsSchool} onChange={(event) => setAnalyticsSchool(event.target.value)}>
            <option value="">All schools</option>{memberships.map((membership) => <option key={membership.school_id} value={membership.school_id}>{membership.school?.name ?? 'School'}</option>)}
          </select></label>
          <label htmlFor="analytics-intent">Purpose<select id="analytics-intent" value={analyticsIntent} onChange={(event) => setAnalyticsIntent(event.target.value)}>
            <option value="">All purposes</option>{intentOptionsForAssets.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label htmlFor="analytics-method">Method<select id="analytics-method" value={analyticsMethod} onChange={(event) => setAnalyticsMethod(event.target.value)}>
            <option value="">All methods</option>{[...new Set(requests.map((request) => request.method).filter((method): method is string => Boolean(method)))].map((method) => <option value={method} key={method}>{method}</option>)}
          </select></label>
        </div>
        <p className="field-hint">Only provider charges recorded as actual are included in the real-cost total. Demo records and unpriced requests are not counted as real charges.</p>
        {analyticsRequests.length === 0 ? <EmptyState text="No requests match these filters." /> : (
            <div className="table-wrap"><table><thead><tr><th>Request</th><th>Type</th><th>Provider cost</th><th>High Quality baseline</th><th>Selected estimate</th><th>Estimated difference</th><th>Method</th></tr></thead><tbody>
              {analyticsRequests.map((request) => <tr key={request.id}><td>{request.prompt}</td><td>{request.cost_source}</td><td>{request.cost_source === 'actual' && request.provider_charge !== null ? formatMoney(request.provider_charge, request.provider_currency ?? currency) : 'Not recorded'}</td><td>{request.baseline_estimate === null ? 'Not available' : formatMoney(Number(request.baseline_estimate), request.estimate_currency ?? 'USD')}</td><td>{request.optimized_estimate === null ? 'Not available' : formatMoney(Number(request.optimized_estimate), request.estimate_currency ?? 'USD')}</td><td>{request.savings_estimate === null ? 'Not available' : `${request.savings_estimate < 0 ? 'Extra cost: ' : 'Savings: '}${formatMoney(Math.abs(Number(request.savings_estimate)), request.estimate_currency ?? 'USD')}${request.savings_percentage === null ? '' : ` (${Math.abs(Number(request.savings_percentage)).toFixed(1)}%)`}`}</td><td>{request.method ?? '—'}{request.calculation_method && <details><summary>How this was calculated</summary><p>{request.calculation_method}</p>{request.pricing_effective_from && <p>Price date: {request.pricing_effective_from}</p>}{request.pricing_source_url && <a href={request.pricing_source_url} target="_blank" rel="noreferrer">Price source</a>}</details>}</td></tr>)}
          </tbody></table></div>
        )}
      </section>
      <section className="panel workspace-panel"><h3>Requests by purpose</h3><div className="intent-bars">{intentOptionsForAnalytics(analyticsRequests).map(([label, count]) => <div className="intent-bar-row" key={label}><span>{label}</span><strong>{count}</strong><div className="intent-bar"><span style={{ width: `${analyticsRequests.length ? Math.max(8, count / analyticsRequests.length * 100) : 0}%` }} /></div></div>)}</div></section>
    </>
  )

  if (page === 'budgets') return (
    <>
      <section className="panel workspace-panel">
        <div className="section-heading"><div><p className="eyebrow">Monthly budget</p><h3>{school?.name ?? 'No school selected'}</h3></div><Gauge size={18} /></div>
        {!school ? <EmptyState text="Ask your school admin to add you to a school." /> : <>
          <div className="metric-grid">
            <Metric label="Monthly limit" value={formatMoney(Number(school.monthly_budget), school.budget_currency)} />
            <Metric label="Recorded spend" value={formatMoney(spendThisMonth, school.budget_currency)} />
            <Metric label="Budget used" value={`${school.monthly_budget ? Math.min(100, Math.round(spendThisMonth / Number(school.monthly_budget) * 100)) : 0}%`} />
          </div>
          <div className="budget-meter"><span style={{ width: `${school.monthly_budget ? Math.min(100, spendThisMonth / Number(school.monthly_budget) * 100) : 0}%` }} /></div>
          <p className="field-hint">Alert at {school.warning_threshold}% · Usage limits are enforced only for signed-in school requests with server policies configured.</p>
          {school.monthly_budget > 0 && spendThisMonth / Number(school.monthly_budget) * 100 >= school.warning_threshold
            && <div className="workspace-alert" role="status">This school is near or above its monthly budget warning level.</div>}
        </>}
      </section>
      {isSchoolAdmin && school && <section className="panel workspace-panel">
        <h3>Admin: change monthly limit</h3>
        <form className="workspace-inline-form" onSubmit={(event) => void onUpdateBudget(event)}>
          <label htmlFor="monthly-budget">Budget ({school.budget_currency})<input id="monthly-budget" type="number" min="0" step="0.01" value={budget} onChange={(event) => setBudget(event.target.value)} /></label>
          <button className="primary-button" type="submit">Save budget</button>
        </form>
      </section>}
      <section className="panel workspace-panel"><h3>Budget records</h3>
        {schoolBudgetEntries.length === 0 ? <EmptyState text="There are no budget records yet." /> : (
          <div className="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Currency</th></tr></thead><tbody>
            {schoolBudgetEntries.map((entry) => <tr key={entry.id}><td>{new Date(entry.recorded_at).toLocaleDateString()}</td><td>{entry.entry_type}</td><td>{formatMoney(Number(entry.amount), entry.currency)}</td><td>{entry.currency}</td></tr>)}
          </tbody></table></div>
        )}
      </section>
    </>
  )

  return (
    <>
      <div className="metric-grid">
        <Metric label="Image requests" value={String(requests.length)} />
        <Metric label="Reused from library" value={String(reusedCount)} />
        <Metric label="School budgets" value={String(memberships.length)} />
        <Metric label="Real provider costs" value={formatMoney(actualCost)} />
      </div>
      <section className="panel workspace-panel">
        <div className="section-heading"><div><p className="eyebrow">Latest requests</p><h3>What your school is working on</h3></div><ClipboardList size={18} /></div>
        {requests.length === 0 ? <EmptyState text="No image requests have been saved yet." /> : (
          <div className="table-wrap"><table><thead><tr><th>Request</th><th>Use</th><th>Status</th></tr></thead><tbody>
            {requests.slice(0, 5).map((request) => <tr key={request.id}><td>{request.prompt}</td><td>{displayIntent(request.intent)}</td><td>{displayStatus(request.state)}</td></tr>)}
          </tbody></table></div>
        )}
      </section>
      <div className="workspace-shortcuts">
        <Link to="/library" className="panel shortcut-card"><Database size={18} /><strong>Find a reusable image</strong><span>Look for an approved resource before making a new one.</span></Link>
        <Link to="/analytics" className="panel shortcut-card"><ChartNoAxesCombined size={18} /><strong>View costs</strong><span>See which charges are real and which are only examples.</span></Link>
        <Link to="/budgets" className="panel shortcut-card"><Gauge size={18} /><strong>Check budgets</strong><span>Review your school's monthly limit.</span></Link>
      </div>
    </>
  )
}

const intentOptionsForAnalytics = (requests: ImageRequest[]) => {
  const counts = requests.reduce<Record<string, number>>((result, request) => {
    result[request.intent] = (result[request.intent] ?? 0) + 1
    return result
  }, {})
  return Object.entries(counts).map(([intent, count]) => [displayIntent(intent), count] as [string, number])
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="workspace-metric"><span>{label}</span><strong>{value}</strong></div>
}

function EmptyState({ text }: { text: string }) {
  return <div className="workspace-empty"><BookOpen size={20} /><p>{text}</p></div>
}
