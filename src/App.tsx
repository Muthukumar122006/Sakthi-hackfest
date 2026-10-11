import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, NavLink, Route, Routes } from 'react-router-dom'
import {
  ArrowDownRight,
  Check,
  Image as ImageIcon,
  Leaf,
  LoaderCircle,
  Plus,
  Sparkles,
  Zap,
} from 'lucide-react'
import { currencies } from './data/countries'
import { useAuth } from './auth/AuthContext'
import { AuthPage, PasswordResetPage } from './auth/AuthPage'
import { useCurrency } from './localization/CurrencyContext'
import {
  categoryLabels,
  categorySuggestions,
  creativeCategories,
  intentOptions,
  recommendQuality,
  suggestedTier,
  classifyIntent,
  type CreativeCategory,
  type EducationalIntent,
} from './edugen/intent'
import { WorkspacePage } from './edugen/WorkspacePage'
import {
  generateImage,
  loadMemberships,
  loadProfilePreferences,
  loadProviderPrices,
  type Membership,
  type ImageGenerationResult,
  type ProviderPrice,
} from './edugen/repository'
import { isSupabaseConfigured, supabaseConfigurationError } from './auth/supabase'

type TierId = 'studio-pro' | 'precision-lite' | 'draft-rapid'
type PreviewStatus = 'ready' | 'generating' | 'generated' | 'reused' | 'error'

type Tier = {
  id: TierId
  name: string
  quality: string
  time: string
  cost: number
  description: string
}
const tiers: Tier[] = [
  {
    id: 'studio-pro',
    name: 'High Quality',
    quality: 'Most detail',
    time: 'Not available',
    cost: 4.5,
    description: 'Choose this for detail-heavy prompts when the configured model supports it.',
  },
  {
    id: 'precision-lite',
    name: 'Balanced',
    quality: 'Good detail',
    time: 'Not available',
    cost: 2.25,
    description: 'A middle choice for everyday images.',
  },
  {
    id: 'draft-rapid',
    name: 'Budget',
    quality: 'Basic',
    time: 'Not available',
    cost: 1.1,
    description: 'A lower-price choice for simple images.',
  },
]

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/generate" replace />} />
      <Route path="/login" element={<AuthPage />} />
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/reset-password" element={<PasswordResetPage />} />
      <Route path="/dashboard" element={<WorkspacePage page="dashboard" />} />
      <Route path="/history" element={<WorkspacePage page="history" />} />
      <Route path="/library" element={<WorkspacePage page="library" />} />
      <Route path="/analytics" element={<WorkspacePage page="analytics" />} />
      <Route path="/budgets" element={<WorkspacePage page="budgets" />} />
      <Route path="/settings" element={<WorkspacePage page="settings" />} />
      <Route path="/generate" element={<PlannerPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function PlannerPage() {
  const [purpose, setPurpose] = useState<EducationalIntent>('general_illustration')
  const [classificationChanged, setClassificationChanged] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [customPurpose, setCustomPurpose] = useState('')
  const [category, setCategory] = useState<CreativeCategory>('educational')
  const [customCategory, setCustomCategory] = useState('')
  const [targetAudience, setTargetAudience] = useState('All ages')
  const [customAgeStart, setCustomAgeStart] = useState('')
  const [customAgeEnd, setCustomAgeEnd] = useState('')
  const [language, setLanguage] = useState('en')
  const [style, setStyle] = useState('simple illustration')
  const [targetBudget, setTargetBudget] = useState('')
  const [requestMessage, setRequestMessage] = useState<string | null>(null)
  const [generation, setGeneration] = useState<ImageGenerationResult | null>(null)
  const [generatedImageDimensions, setGeneratedImageDimensions] = useState<{ width: number; height: number } | null>(null)
  const [generatedImageLoadFailed, setGeneratedImageLoadFailed] = useState(false)
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [providerPrices, setProviderPrices] = useState<ProviderPrice[]>([])
  const [schoolId, setSchoolId] = useState('')
  const [priceError, setPriceError] = useState<string | null>(null)
  const [selectedTierId, setSelectedTierId] = useState<TierId>('precision-lite')
  const [qualityManuallySelected, setQualityManuallySelected] = useState(false)
  const requestInFlight = useRef(false)
  const idempotencyAttempt = useRef<{ signature: string; key: string } | null>(null)
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>('ready')
  const [accountError, setAccountError] = useState<string | null>(null)
  const { user, loading: authLoading, error: authError, signOut } = useAuth()
  const {
    currency,
    currencyOverridden,
    rateDate,
    rateError,
    rateLoading,
    saveError,
    formatAmount,
    setCurrency,
    resetCurrency,
  } = useCurrency()

  useEffect(() => {
    if (authLoading) return
    if (!user || !isSupabaseConfigured) {
      setMemberships([])
      setSchoolId('')
      return
    }
    let active = true
    void Promise.all([loadMemberships(), loadProviderPrices(), loadProfilePreferences(user)]).then(([items, prices, profile]) => {
      if (!active) return
      setMemberships(items)
      setSchoolId((current) => current || items[0]?.school_id || '')
      setProviderPrices(prices)
      if (profile) {
        setCategory(profile.default_category ?? 'educational')
        setTargetAudience(profile.default_audience ?? 'All ages')
        setLanguage(profile.preferred_language ?? 'en')
        setStyle(profile.default_style ?? 'simple illustration')
      }
    }).catch((loadError: unknown) => {
      if (active) setPriceError(loadError instanceof Error ? loadError.message : 'Could not load current provider settings.')
    })
    return () => { active = false }
  }, [authLoading, user])

  const audienceValue = targetAudience === 'Custom age range'
    ? `Custom ages ${customAgeStart}-${customAgeEnd}`
    : targetAudience
  const recommendation = recommendQuality({
    prompt: `${prompt} ${customPurpose} ${customCategory}`,
    category,
    intent: purpose,
    targetAudience: audienceValue,
  })
  const recommendedTier = user && isSupabaseConfigured && !providerPrices.some((price) => price.quality_tier === recommendation.tier)
    ? [...providerPrices].sort((left, right) => Number(left.cost_per_image) - Number(right.cost_per_image))[0]?.quality_tier ?? recommendation.tier
    : recommendation.tier
  useEffect(() => {
    if (!qualityManuallySelected) setSelectedTierId(recommendedTier)
  }, [qualityManuallySelected, recommendedTier])
  const selectedTier = tiers.find((tier) => tier.id === selectedTierId) ?? tiers[1]
  const studioPro = tiers[0]
  const priceFor = (tierId: TierId) => {
    if (!user || !isSupabaseConfigured) return tiers.find((tier) => tier.id === tierId)?.cost ?? null
    const price = providerPrices.find((item) => item.quality_tier === tierId && item.currency === 'USD')
    return price ? Number(price.cost_per_image) : null
  }
  const selectedPrice = priceFor(selectedTier.id)
  const baselinePrice = priceFor(studioPro.id)
  const selectedProviderPrice = providerPrices.find((item) => item.quality_tier === selectedTierId)
  const savings = selectedPrice !== null && baselinePrice !== null ? baselinePrice - selectedPrice : null
  const savingsPercentage = savings !== null && baselinePrice ? Math.round((savings / baselinePrice) * 100) : null
  const priceText = (price: number | null) => price === null ? 'Price not set' : formatAmount(price)
  const purposeLabel = intentOptions.find((option) => option.value === purpose)?.label ?? 'Other picture'
  const addPromptSuggestion = (suggestion: string) => {
    setPrompt((current) => {
      if (current.toLocaleLowerCase().includes(suggestion.toLocaleLowerCase())) return current
      return current.trim() ? `${current.trim()} — ${suggestion}` : suggestion
    })
    setGeneration(null)
    setGeneratedImageDimensions(null)
    setGeneratedImageLoadFailed(false)
    setPreviewStatus('ready')
    setRequestMessage(null)
  }
  const handlePurposeChange = (nextPurpose: EducationalIntent) => {
    setPurpose(nextPurpose)
    setClassificationChanged(true)
    if (!qualityManuallySelected) setSelectedTierId(suggestedTier(nextPurpose))
    setPreviewStatus('ready')
    setRequestMessage(null)
    setGeneration(null)
    setGeneratedImageDimensions(null)
    setGeneratedImageLoadFailed(false)
  }

  const handlePromptChange = (value: string) => {
    setPrompt(value)
    setGeneration(null)
    setGeneratedImageDimensions(null)
    setGeneratedImageLoadFailed(false)
    setPreviewStatus('ready')
    setRequestMessage(null)
    if (classificationChanged) return
    const detected = classifyIntent(value)
    setPurpose(detected)
    if (!qualityManuallySelected) setSelectedTierId(suggestedTier(detected))
  }

  const handleNewProject = () => {
    idempotencyAttempt.current = null
    setPrompt('')
    setCustomPurpose('')
    setCategory('educational')
    setCustomCategory('')
    setTargetAudience('All ages')
    setCustomAgeStart('')
    setCustomAgeEnd('')
    setLanguage('en')
    setStyle('simple illustration')
    setTargetBudget('')
    setPurpose('general_illustration')
    setClassificationChanged(false)
    setSelectedTierId(suggestedTier('flashcard'))
    setQualityManuallySelected(false)
    setPreviewStatus('ready')
    setRequestMessage(null)
    setGeneration(null)
  }

  const handleSaveRequest = async () => {
    if (requestInFlight.current) return
    setGeneration(null)
    setRequestMessage(null)
    if (!prompt.trim()) {
      setPreviewStatus('error')
      setRequestMessage('Write a short description first.')
      return
    }
    if (targetAudience === 'Custom age range'
      && (!/^\d{1,3}$/.test(customAgeStart)
        || !/^\d{1,3}$/.test(customAgeEnd)
        || Number(customAgeStart) > Number(customAgeEnd)
        || Number(customAgeEnd) > 120)) {
      setPreviewStatus('error')
      setRequestMessage('Enter a valid custom age range, with the first age no greater than the second.')
      return
    }
    if (!user || !isSupabaseConfigured) {
      setPreviewStatus('error')
      setRequestMessage('Sign in and connect Supabase to save a request. Image generation is not set up.')
      return
    }
    if (selectedPrice === null) {
      setPreviewStatus('error')
      setRequestMessage('This quality has no current provider price and is not available. Ask an admin to configure it.')
      return
    }
    if (baselinePrice === null) {
      setPreviewStatus('error')
      setRequestMessage('A current High Quality baseline price is required before image generation.')
      return
    }
    const generationInput = {
      prompt: customPurpose.trim()
        ? `${prompt.trim()}\n\nExtra wish: ${customPurpose.trim()}`
        : prompt.trim(),
      category,
      custom_category: category === 'custom' ? customCategory.trim() : '',
      target_audience: audienceValue,
      intent: purpose,
      language,
      style,
      quality_tier: selectedTierId,
      school_id: schoolId || null,
      target_budget: targetBudget ? Number(targetBudget) : null,
      target_budget_currency: currency,
      display_currency: currency,
    }
    const signature = JSON.stringify(generationInput)
    if (idempotencyAttempt.current?.signature !== signature) {
      idempotencyAttempt.current = { signature, key: crypto.randomUUID() }
    }
    requestInFlight.current = true
    setPreviewStatus('generating')
    setGeneratedImageDimensions(null)
    setGeneratedImageLoadFailed(false)
    const requestStartedAt = performance.now()
    try {
      const result = await generateImage({
        ...generationInput,
        idempotency_key: idempotencyAttempt.current.key,
      })
      idempotencyAttempt.current = null
      setGeneration({
        ...result,
        request_duration_ms: Math.round(performance.now() - requestStartedAt),
      })
      setPreviewStatus(result.state)
      setRequestMessage(result.message)
    } catch (requestError) {
      setPreviewStatus('error')
      setRequestMessage(requestError instanceof Error ? requestError.message : 'Could not save this request.')
    } finally {
      requestInFlight.current = false
    }
  }

  const handleSignOut = async () => {
    setAccountError(null)
    try {
      await signOut()
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : 'Unable to sign out.')
    }
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">
            <ImageIcon size={18} />
          </div>
          <div className="brand-copy">
            <p className="eyebrow">For learning</p>
            <h1>EduGen Smart</h1>
          </div>
        </div>
        <div className="category-suggestions" aria-label={`${categoryLabels[category]} ideas`}>
          <span className="mini-label">Ideas you can add to your prompt</span>
          <div className="chip-grid">
            {categorySuggestions[category].map((suggestion) => (
              <button className="chip" type="button" key={suggestion} onClick={() => addPromptSuggestion(suggestion)}>
                {suggestion}
              </button>
            ))}
          </div>
        </div>
        {category === 'custom' && (
          <label className="custom-purpose-field" htmlFor="custom-category">
            Describe your category
            <input id="custom-category" className="custom-purpose-input" value={customCategory} onChange={(event) => setCustomCategory(event.target.value)} maxLength={100} placeholder="For example, ocean adventure" />
          </label>
        )}

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
          <div className="panel-header">
            <p className="eyebrow">The idea</p>
            <div className="badge badge-soft">Demo</div>
          </div>
          <h3>Choose what you need</h3>
          <p className="muted">Pick a quality. Prices are examples only.</p>
          <div className="preference-fields">
            <label htmlFor="currency-preference">Currency
              <select id="currency-preference" value={currency} onChange={(event) => setCurrency(event.target.value)}>
                {currencies.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          </div>
          {currencyOverridden && <button className="currency-reset-link" type="button" onClick={resetCurrency}>Use country currency</button>}
          {rateLoading && <p className="preference-status" role="status">Updating exchange rate…</p>}
          {rateDate && <p className="preference-status">Exchange rate date: {rateDate}</p>}
          {rateError && <p className="preference-error" role="alert">{rateError} Estimates are shown in USD until a rate is available.</p>}
          {saveError && <p className="preference-error" role="alert">{saveError}</p>}
        </div>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Image planner</p>
            <h2>Plan your image</h2>
            <p className="page-intro">Tell us what you need. We will suggest a suitable image style.</p>
          </div>
          <div className="topbar-brand"><Sparkles size={17} aria-hidden="true" /><strong>EduGen Smart</strong></div>
          <div className="topbar-actions">
            {authLoading ? (
              <span className="account-status" role="status">Checking account…</span>
            ) : user ? (
              <>
                <span className="account-status">{user.email ?? 'Signed in'}</span>
                <button className="ghost-button" type="button" onClick={() => void handleSignOut()}>
                  Sign out
                </button>
              </>
            ) : (
              <Link className="ghost-button" to="/login">Sign in / create account</Link>
            )}
            <button className="ghost-button" type="button" onClick={handleNewProject}>
              <Plus size={16} />
              New project
            </button>
          </div>
        </header>

        {(supabaseConfigurationError || authError || accountError) && (
          <div className="inline-error" role="alert">{supabaseConfigurationError ?? authError ?? accountError}</div>
        )}

        <div className="demo-banner" role="note">
          <span className="demo-banner-dot" />
          <strong>{user ? 'SUPABASE IMAGE SERVICE' : 'DEMO MODE'}</strong>
          <span>Generation needs a configured provider and source-linked prices. Demo prices are examples only.</span>
        </div>
        {priceError && <div className="inline-error" role="alert">{priceError}</div>}

        <section className="workspace-grid" id="create">
          <div className="workflow-column">
            <section className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Step 1</p>
                  <h3>Describe your image</h3>
                </div>
                <span className="status-pill">Prompt</span>
              </div>
              <label className="visually-hidden" htmlFor="image-prompt">Image description</label>
              <textarea
                id="image-prompt"
                value={prompt}
                onChange={(event) => handlePromptChange(event.target.value)}
                placeholder="What picture do you want?"
                rows={4}
              />
              <div className="workflow-fields">
                <label htmlFor="image-category">Category
                  <select id="image-category" value={category} onChange={(event) => {
                    setCategory(event.target.value as CreativeCategory)
                    setGeneration(null)
                    setPreviewStatus('ready')
                  }}>
                    {creativeCategories.map((item) => <option value={item} key={item}>{categoryLabels[item]}</option>)}
                  </select>
                </label>
                <label htmlFor="image-audience">Target audience
                  <select id="image-audience" value={targetAudience} onChange={(event) => setTargetAudience(event.target.value)}>
                    <option>Early childhood: ages 3–5</option>
                    <option>Young children: ages 6–8</option>
                    <option>Older children: ages 9–12</option>
                    <option>Teenagers: ages 13–17</option>
                    <option>Young adults: ages 18–24</option>
                    <option>Adults: ages 25–59</option>
                    <option>Older adults: ages 60+</option>
                    <option>All ages</option>
                    <option>Custom age range</option>
                  </select>
                </label>
                {targetAudience === 'Custom age range' && (
                  <div className="custom-age-fields">
                    <label htmlFor="custom-age-start">From age<input id="custom-age-start" type="number" min="0" max="120" value={customAgeStart} onChange={(event) => setCustomAgeStart(event.target.value)} /></label>
                    <label htmlFor="custom-age-end">To age<input id="custom-age-end" type="number" min="0" max="120" value={customAgeEnd} onChange={(event) => setCustomAgeEnd(event.target.value)} /></label>
                  </div>
                )}
                <label htmlFor="image-language">Language
                  <select id="image-language" value={language} onChange={(event) => setLanguage(event.target.value)}>
                    <option value="en">English</option><option value="hi">Hindi</option><option value="ta">Tamil</option>
                  </select>
                </label>
                <label htmlFor="image-style">Picture style
                  <select id="image-style" value={style} onChange={(event) => setStyle(event.target.value)}>
                    <option value="simple illustration">Simple picture</option>
                    <option value="black and white line art">Black and white</option>
                    <option value="labelled diagram">Labelled diagram</option>
                    <option value="flat colours">Flat colours</option>
                  </select>
                </label>
                <label htmlFor="target-budget">Max budget ({currency})
                  <input id="target-budget" type="number" min="0" step="0.01" value={targetBudget} onChange={(event) => setTargetBudget(event.target.value)} placeholder="Optional" />
                </label>
                {memberships.length > 0 && (
                  <label htmlFor="request-school">School
                    <select id="request-school" value={schoolId} onChange={(event) => setSchoolId(event.target.value)}>
                      <option value="">Personal request</option>
                      {memberships.map((membership) => (
                        <option value={membership.school_id} key={membership.school_id}>
                          {membership.school?.name ?? 'School'}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <p className="field-hint">This is a rule-based suggestion. You can change it below.</p>
            </section>

            <section className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Step 2</p>
                  <h3>What do you need?</h3>
                </div>
              </div>
              <p className="classification-note">Suggested use: <strong>{intentOptions.find((option) => option.value === classifyIntent(prompt))?.label ?? purposeLabel}</strong></p>
              <div className="chip-grid purpose-grid" role="group" aria-label="Image purpose">
                {intentOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={['chip', option.value === purpose ? 'selected' : ''].join(' ')}
                    aria-pressed={option.value === purpose}
                    onClick={() => handlePurposeChange(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {purpose === 'general_illustration' && (
                <label className="custom-purpose-field" htmlFor="custom-purpose">
                  What else do you need? (optional)
                  <input
                    id="custom-purpose"
                    className="custom-purpose-input"
                    value={customPurpose}
                    onChange={(event) => {
                      setCustomPurpose(event.target.value)
                      setGeneration(null)
                      setPreviewStatus('ready')
                      setRequestMessage(null)
                    }}
                    maxLength={500}
                    placeholder="Write your wish here"
                  />
                </label>
              )}
            </section>

            <section className="panel" id="tiers">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Step 3</p>
                  <h3>Pick image quality</h3>
                </div>
                <span className="status-pill">{user && isSupabaseConfigured ? 'PRICE LIST' : 'EXAMPLE PRICES'}</span>
              </div>
              <div className="recommendation-note">
                <Sparkles size={16} />
                <p><strong>Suggested: {tiers.find((tier) => tier.id === recommendedTier)?.name}</strong> — {recommendation.explanation}
                  {recommendedTier !== recommendation.tier && ' The preferred option is not configured, so this is the lowest-priced supported choice.'}
                  {qualityManuallySelected && selectedTierId !== recommendedTier && (
                    <button type="button" className="use-recommendation-button" onClick={() => {
                      setSelectedTierId(recommendedTier)
                      setQualityManuallySelected(false)
                    }}>Use AI recommendation</button>
                  )}
                </p>
              </div>
              <div className="model-list">
                {tiers.map((tier) => {
                  const isSelected = tier.id === selectedTierId
                  const isRecommended = tier.id === recommendedTier
                  const configuredPrice = providerPrices.find((item) => item.quality_tier === tier.id)
                  return (
                    <button
                      key={tier.id}
                      type="button"
                      className={['model-card', isSelected ? 'selected' : ''].join(' ')}
                      aria-pressed={isSelected}
                      disabled={Boolean(user && isSupabaseConfigured && !configuredPrice)}
                      title={user && isSupabaseConfigured && !configuredPrice ? 'This quality is not configured in the current provider price list.' : undefined}
                      onClick={() => {
                        if (user && isSupabaseConfigured && !configuredPrice) return
                        setSelectedTierId(tier.id)
                        setQualityManuallySelected(true)
                        setPreviewStatus('ready')
                      }}
                    >
                      <span className="model-card-select" aria-hidden="true">
                        {isSelected ? <Check size={14} /> : null}
                      </span>
                      <div className="model-card-content">
                        <div className="model-topline">
                          <div>
                            <strong>{tier.name}</strong>
                            <span>{tier.quality}</span>
                          </div>
                          {isRecommended && <span className="badge badge-primary">Recommended</span>}
                          {user && isSupabaseConfigured && !configuredPrice && <span className="badge">Not configured</span>}
                        </div>
                        <p className="tier-description">{tier.description}</p>
                        <div className="tier-meta">
                          <span>Provider time: Unavailable</span>
                          <span>Size: {configuredPrice?.image_size ?? 'Not set'}</span>
                          <span className="tier-cost">Estimated cost per image: {priceText(priceFor(tier.id))}{user && isSupabaseConfigured ? '' : ' example'}</span>
                        </div>
                        {configuredPrice && <p className="tier-description">Model: {configuredPrice.model} · Price date: {configuredPrice.effective_from}</p>}
                      </div>
                    </button>
                  )
                })}
              </div>
              {selectedProviderPrice && (
                <p className="comparison-footnote">
                  Price source for {selectedTier.name}:{' '}
                  <a href={selectedProviderPrice.source_url} target="_blank" rel="noreferrer">
                    View configured provider pricing
                  </a>
                </p>
              )}
            </section>
          </div>

          <aside className="preview-column">
            <section className="panel estimate-panel" id="estimates" aria-live="polite">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Price estimate</p>
                  <h3>Your estimate</h3>
                </div>
                <span className="estimate-stamp">{user && isSupabaseConfigured ? 'PRICE LIST' : 'EXAMPLE PRICES'}</span>
              </div>
              <div className="estimate-selected">
                <span className="estimate-icon"><Zap size={17} /></span>
                <div>
                  <span className="mini-label">Selected option</span>
                  <strong>{selectedTier.name}</strong>
                </div>
              </div>
              <div className="estimate-metrics">
                <div className="estimate-metric">
                  <span className="mini-label">{user && isSupabaseConfigured ? 'Provider price estimate' : 'Example price'}</span>
                  <strong>{priceText(selectedPrice)}</strong>
                </div>
                <div className="estimate-metric">
                  <span className="mini-label">Resource use</span>
                  <strong>Not measured</strong>
                </div>
                <div className="estimate-metric">
                  <span className="mini-label">Generation time</span>
                  <strong>{selectedTier.time}</strong>
                </div>
                <div className="estimate-metric baseline-metric">
                  <span className="mini-label">High Quality baseline</span>
                  <strong>{priceText(baselinePrice)}</strong>
                </div>
              </div>
              <div className="savings-box">
                <div className="savings-icon"><Leaf size={18} /></div>
                <div>
                  <span className="mini-label">{savings !== null && savings < 0 ? 'Extra cost vs High Quality' : 'Estimated savings'}</span>
                  <strong>{savings === null ? 'Not available' : `${formatAmount(Math.abs(savings))}${savingsPercentage === null ? '' : ` (${Math.abs(savingsPercentage)}%)`}`}</strong>
                </div>
                <ArrowDownRight size={18} className="savings-arrow" />
              </div>
              <div className="energy-disclaimer">
                <span className="energy-indicator" />
                <p><strong>Energy use is not measured.</strong> Provider runtime is not currently reported.</p>
              </div>
              {user && isSupabaseConfigured && providerPrices.find((item) => item.quality_tier === selectedTier.id) && (
                <p className="price-source-note">
                  Example estimate uses a published provider price dated {providerPrices.find((item) => item.quality_tier === selectedTier.id)?.effective_from}.
                  {' '}<a href={providerPrices.find((item) => item.quality_tier === selectedTier.id)?.source_url} target="_blank" rel="noreferrer">View price source</a>.
                  {' '}Your final bill may differ.
                </p>
              )}
            </section>

            <section className="panel preview-panel">
              <div className="preview-topline">
                <div>
                  <p className="eyebrow">Step 4</p>
                  <h3>Image preview</h3>
                </div>
                <span className={['status-pill', previewStatus === 'generated' || previewStatus === 'reused' ? 'success' : ''].join(' ')}>
                  {previewStatus === 'generating' ? 'Working…' : previewStatus === 'generated' ? 'Image ready' : previewStatus === 'reused' ? 'Reused image' : previewStatus === 'error' ? 'Not completed' : 'Example'}
                </span>
              </div>
              <div className="preview-stage">
                {generation ? (
                  <img
                    key={generation.asset_id}
                    className="preview-generated-image"
                    src={generation.image_url}
                    alt="Generated educational image. Review it before use."
                    onLoad={(event) => {
                      const { naturalWidth, naturalHeight } = event.currentTarget
                      if (naturalWidth > 0 && naturalHeight > 0) {
                        setGeneratedImageDimensions({ width: naturalWidth, height: naturalHeight })
                      } else {
                        setGeneratedImageLoadFailed(true)
                      }
                    }}
                    onError={() => setGeneratedImageLoadFailed(true)}
                  />
                ) : <div className="preview-illustration" aria-hidden="true">
                  <div className="illustration-sun" />
                  <div className="illustration-cloud" />
                  <div className="illustration-water" />
                  <div className="illustration-land" />
                  <div className="illustration-label" />
                  <div className="illustration-arrow" />
                </div>}
                {previewStatus === 'generating' && (
                  <div className="preview-loading">
                    <LoaderCircle size={22} className="spin-icon" />
                    <strong>Checking your request…</strong>
                  </div>
                )}
              </div>
              <div className="preview-disclosure">
                <span className="preview-demo-label">{generation ? (generation.state === 'reused' ? 'REUSED IMAGE' : 'GENERATED IMAGE') : 'SAMPLE IMAGE'}</span>
                <span>{generation ? generation.message : 'This sample is not an AI-generated image.'}</span>
              </div>
              {generation && (
                <div className="generated-details">
                  <span>Method: {generation.state === 'reused' ? 'Approved library match' : generation.method ?? 'Provider method not returned'}</span>
                  {generation.request_duration_ms !== undefined && (
                    <span>Total request time: {(generation.request_duration_ms / 1000).toFixed(1)} seconds from request start until the service response is processed; includes network and provider wait, excludes image loading.</span>
                  )}
                  <span>
                    Requested image size: {generation.image_size
                      ? generation.image_size
                      : generation.state === 'reused'
                        ? 'Not applicable; a saved image was reused.'
                        : 'Unavailable; it was not recorded for this request.'}
                  </span>
                  <span>
                    Image file size: {generation.image_file_size_bytes === undefined || generation.image_file_size_bytes === null
                      ? 'Unavailable; this stored image has no recorded byte-size metadata.'
                      : `${formatImageFileSize(generation.image_file_size_bytes)} (${generation.image_file_size_bytes.toLocaleString('en-US')} bytes)`}
                  </span>
                  {generatedImageDimensions && (
                    <span>Image dimensions: {generatedImageDimensions.width} × {generatedImageDimensions.height} pixels</span>
                  )}
                  {!generatedImageDimensions && generatedImageLoadFailed && (
                    <span>Image dimensions: Unavailable — the image could not be loaded to read its pixel dimensions.</span>
                  )}
                  {!generatedImageDimensions && !generatedImageLoadFailed && (
                    <span>Image dimensions: Loading from the saved image…</span>
                  )}
                  <span>
                    Selected quality: {tiers.find((tier) => tier.id === generation.quality_tier)?.name ?? 'Not recorded'} (relative quality tier).
                  </span>
                  <span>
                    Provider generation time: {generation.state === 'reused'
                      ? 'Not applicable; the image was reused.'
                      : 'Unavailable — the provider does not expose a verifiable generation-duration measurement.'}
                  </span>
                  <span>Compute/energy usage: Unavailable — not exposed by the provider.</span>
                  <span>
                    {generation.state === 'reused' ? 'Avoided image-generation estimate per image' : 'Selected image estimate per image'}:{' '}
                    {generation.optimized_estimate === undefined
                      ? 'Not available'
                      : `${formatCurrencyAmount(generation.optimized_estimate, generation.estimate_currency ?? generation.provider_currency ?? 'USD')} (estimate, not a bill)`}
                  </span>
                  <span>
                    High Quality baseline:{' '}
                    {generation.baseline_estimate === undefined
                      ? 'Not available'
                      : formatCurrencyAmount(generation.baseline_estimate, generation.estimate_currency ?? generation.provider_currency ?? 'USD')}
                  </span>
                  <span>
                    {generation.savings_estimate !== null && generation.savings_estimate !== undefined && generation.savings_estimate < 0
                      ? 'Extra cost vs High Quality: '
                      : 'Estimated savings: '}
                    {generation.savings_estimate === undefined || generation.savings_estimate === null
                      ? 'Not available'
                      : `${formatCurrencyAmount(Math.abs(generation.savings_estimate), generation.estimate_currency ?? generation.provider_currency ?? 'USD')}${generation.savings_percentage === null || generation.savings_percentage === undefined ? '' : ` (${Math.abs(generation.savings_percentage).toFixed(1)}%)`}`}
                  </span>
                  {generation.calculation_method && <span>Calculation: {generation.calculation_method}</span>}
                  {generation.cost_source && <span>Cost type: {generation.cost_source}; actual provider billing was not returned.</span>}
                  {generation.price_effective_from && <span>Price date: {generation.price_effective_from}</span>}
                  {generation.price_source_url && <a href={generation.price_source_url} target="_blank" rel="noreferrer">View provider price source</a>}
                  {generation.state === 'reused' && <span>Other storage and service costs are not included in this avoided-generation estimate.</span>}
                  {generation.state === 'generated' && <span>Image content needs teacher review.</span>}
                  <a href={generation.image_url} target="_blank" rel="noreferrer">Open or download image</a>
                </div>
              )}
              {requestMessage && (
                <p className={previewStatus === 'error' ? 'workspace-alert' : 'preview-success'} role={previewStatus === 'error' ? 'alert' : 'status'}>
                  {(previewStatus === 'generated' || previewStatus === 'reused') && <Check size={15} />} {requestMessage}
                </p>
              )}
              <button
                className="primary-button preview-button"
                type="button"
                onClick={() => void handleSaveRequest()}
                disabled={previewStatus === 'generating'}
              >
                {previewStatus === 'generating' ? <LoaderCircle size={16} className="spin-icon" /> : <Sparkles size={16} />}
                {previewStatus === 'generating' ? 'Working…' : generation ? 'Make another image' : 'Create image'}
              </button>
            </section>
          </aside>
        </section>

        <section className="panel comparison-panel" id="comparison">
          <div className="section-heading">
            <div>
              <p className="eyebrow">The trade-off</p>
              <h3>{selectedTier.name} compared with High Quality</h3>
            </div>
            <span className="status-pill">Illustrative comparison</span>
          </div>
          <div className="comparison-grid">
            <div className="comparison-tier current-tier">
              <span className="mini-label">Selected option</span>
              <strong>{selectedTier.name}</strong>
              <span>Estimated cost per image: {priceText(selectedPrice)}{user && isSupabaseConfigured ? '' : ' example'} · {providerPrices.find((item) => item.quality_tier === selectedTier.id)?.image_size ?? 'Size not set'}</span>
            </div>
            <div className="comparison-difference">
              <span className="mini-label">Potential difference</span>
              <strong>{savings === null ? 'Not available' : `${formatAmount(Math.abs(savings))} ${savings < 0 ? 'more' : 'less'}`}</strong>
              <span>{savingsPercentage === null ? 'Savings unavailable' : `${Math.abs(savingsPercentage)}% ${savingsPercentage < 0 ? 'extra cost' : 'estimated savings'}`}</span>
            </div>
            <div className="comparison-tier">
              <span className="mini-label">Highest quality</span>
              <strong>High Quality</strong>
              <span>Estimated cost per image: {priceText(baselinePrice)}{user && isSupabaseConfigured ? '' : ' example'} · High Quality</span>
            </div>
          </div>
          <p className="comparison-footnote">
            {user && isSupabaseConfigured
              ? 'Prices are configured estimates, not actual bills. Check the provider source and effective date on each quality option.'
              : 'Prices are simulated examples, not current provider prices. Resource levels are not energy measurements.'}
          </p>
        </section>

        <footer className="app-footer">EduGen Smart · Energy use is not measured. Review images before classroom use.</footer>
      </main>
    </div>
  )
}

function formatCurrencyAmount(amount: number, currencyCode: string) {
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency: currencyCode,
    maximumFractionDigits: 6,
  }).format(amount)
}

function formatImageFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
}

export default App
