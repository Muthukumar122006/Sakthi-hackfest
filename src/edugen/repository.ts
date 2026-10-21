import type { User } from '@supabase/supabase-js'
import { supabase } from '../auth/supabase'
import type { CreativeCategory, EducationalIntent } from './intent'

export type EducationalAsset = {
  id: string
  title: string
  description: string
  subject: string
  intent: EducationalIntent
  grade: string
  category: CreativeCategory
  target_audience: string
  language: string
  tags: string[]
  kind: 'existing' | 'template' | 'svg' | 'generated'
  review_state: 'pending' | 'approved' | 'rejected'
  source_url: string | null
  storage_path: string | null
  file_size_bytes?: number | null
  review_note?: string
  reviewed_by?: string | null
  reviewed_at?: string | null
  preview_url: string | null
  licence: string | null
  attribution: string | null
  created_at: string
}

export type AssetReviewHistoryEntry = {
  id: string
  asset_id: string
  reviewer_id: string
  new_state: 'approved' | 'rejected'
  note: string
  created_at: string
  asset_title: string
}

export type ImageRequest = {
  id: string
  prompt: string
  subject: string
  grade: string
  category: CreativeCategory
  target_audience: string
  intent: EducationalIntent
  quality_tier: 'studio-pro' | 'precision-lite' | 'draft-rapid'
  language: string
  style: string
  state: 'draft' | 'queued' | 'generated' | 'reused' | 'failed' | 'uncertain'
  method: string | null
  reused_asset_id: string | null
  output_asset_id: string | null
  quality_state: 'passed' | 'failed' | 'not_checked' | null
  provider_charge: number | null
  provider_currency: string | null
  baseline_estimate: number | null
  optimized_estimate: number | null
  savings_estimate: number | null
  savings_percentage: number | null
  calculation_method: string | null
  estimate_currency: string | null
  pricing_source_url: string | null
  pricing_effective_from: string | null
  school_id: string | null
  cost_source: 'actual' | 'estimated' | 'projected' | 'demo' | 'unknown'
  created_at: string
}

export type Membership = {
  school_id: string
  role: 'teacher' | 'admin'
  school: {
    id: string
    name: string
    district: string
    monthly_budget: number
    warning_threshold: number
    budget_currency: string
  } | null
}

export type UserProfile = {
  country_iso: string | null
  phone_country_iso: string | null
  phone_calling_code: string | null
  preferred_currency: string | null
  currency_overridden: boolean
  preferred_language: string | null
  default_category: CreativeCategory | null
  default_audience: string | null
  default_style: string | null
}

export type ProviderPrice = {
  provider: string
  quality_tier: 'studio-pro' | 'precision-lite' | 'draft-rapid'
  model: string
  image_size: string
  cost_per_image: number
  currency: string
  pricing_unit: 'per_image'
  active: true
  applicable: true
  source_url: string
  effective_from: string
}

export type QualityRecommendation = {
  tier: 'studio-pro' | 'precision-lite' | 'draft-rapid'
  reason: string
  provider: string
  model: string | null
  estimated_cost: number | null
  currency: string | null
  pricing_unit: 'per_image'
  price_source_url: string | null
  price_effective_from: string | null
  requested_image_size: string | null
  pricing_status: 'available' | 'unavailable'
  limitations: string[]
}

export type ImageGenerationResult = {
  request_id: string
  image_url: string
  asset_id: string
  state: 'generated' | 'reused'
  provider?: string
  pricing_unit?: 'per_image'
  estimated_provider_cost?: number
  provider_currency?: string
  price_source_url?: string
  baseline_estimate?: number
  optimized_estimate?: number
  savings_estimate?: number | null
  savings_percentage?: number | null
  estimate_currency?: string
  calculation_method?: string
  pricing_source_url?: string
  cost_source?: 'estimated' | 'projected'
  price_effective_from?: string
  method?: string
  image_size?: string | null
  image_file_size_bytes?: number | null
  quality_tier?: 'studio-pro' | 'precision-lite' | 'draft-rapid'
  request_duration_ms?: number
  message: string
}

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured. Add the public project URL and publishable key to .env.local.')
  return supabase
}

export async function loadAssets(search = ''): Promise<EducationalAsset[]> {
  const client = requireClient()
  const { data, error } = await client
    .from('educational_assets')
    .select('id,title,description,subject,intent,grade,category,target_audience,language,tags,kind,review_state,storage_path,file_size_bytes,source_url,licence,attribution,created_at')
    .eq('review_state', 'approved')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw error
  const needle = search.trim().toLocaleLowerCase()
  const assets = await attachAssetPreviews((data ?? []) as EducationalAsset[], client)
  return assets.filter((asset) => {
    if (!needle) return true
    return [asset.title, asset.description, asset.subject, asset.grade, ...asset.tags]
      .some((value) => value.toLocaleLowerCase().includes(needle))
  })
}

async function attachAssetPreviews(assets: EducationalAsset[], client: ReturnType<typeof requireClient>) {
  return Promise.all(assets.map(async (asset) => {
    if (!asset.storage_path) return { ...asset, preview_url: asset.source_url }
    const { data: signed, error: signedError } = await client.storage
      .from('educational-images')
      .createSignedUrl(asset.storage_path, 300)
    if (signedError) throw signedError
    return { ...asset, preview_url: signed.signedUrl }
  }))
}

export async function loadAssetsForReview(schoolId: string | null): Promise<EducationalAsset[]> {
  const client = requireClient()
  let query = client
    .from('educational_assets')
    .select('id,title,description,subject,intent,grade,category,target_audience,language,tags,kind,review_state,storage_path,file_size_bytes,source_url,licence,attribution,created_at')
    .eq('review_state', 'pending')
    .order('created_at', { ascending: false })
    .limit(100)
  if (schoolId) {
    query = query.eq('school_id', schoolId)
  } else {
    const { data: authData, error: authError } = await client.auth.getUser()
    if (authError) throw authError
    if (!authData.user) return []
    query = query.is('school_id', null).eq('created_by', authData.user.id)
  }
  const { data, error } = await query
  if (error) throw error
  return attachAssetPreviews((data ?? []) as EducationalAsset[], client)
}

export async function reviewEducationalAsset(assetId: string, decision: 'approved' | 'rejected', note: string) {
  const client = requireClient()
  const { error } = await client.rpc('review_educational_asset', {
    target_asset_id: assetId,
    target_decision: decision,
    target_note: note,
  })
  if (error) throw error
}

export async function approveSchoolAsset(assetId: string, note = '') {
  return reviewEducationalAsset(assetId, 'approved', note)
}

export async function rejectSchoolAsset(assetId: string, note: string) {
  return reviewEducationalAsset(assetId, 'rejected', note)
}

export async function loadAssetReviewHistory(): Promise<AssetReviewHistoryEntry[]> {
  const client = requireClient()
  const { data: events, error } = await client
    .from('asset_review_events')
    .select('id,asset_id,reviewer_id,new_state,note,created_at')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw error
  if (!events?.length) return []

  const { data: assets, error: assetError } = await client
    .from('educational_assets')
    .select('id,title')
    .in('id', events.map((event) => event.asset_id))
  if (assetError) throw assetError
  const titles = new Map((assets ?? []).map((asset) => [asset.id, asset.title]))
  return events.map((event) => ({
    ...event,
    asset_title: titles.get(event.asset_id) ?? 'Image no longer available',
  })) as AssetReviewHistoryEntry[]
}

export async function loadProviderPrices(): Promise<ProviderPrice[]> {
  const client = requireClient()
  const { data, error } = await client.functions.invoke('planner-services', { body: { action: 'prices' } })
  if (error) throw await readFunctionError(error, 'Could not load current provider settings.')
  if (typeof data !== 'object' || data === null || data.success !== true || !Array.isArray(data.prices)) {
    throw new Error('The planner service returned an invalid pricing response.')
  }
  const validPrices = data.prices.filter((item: unknown): item is ProviderPrice => {
    if (typeof item !== 'object' || item === null) return false
    const price = item as Record<string, unknown>
    return (price.quality_tier === 'studio-pro' || price.quality_tier === 'precision-lite' || price.quality_tier === 'draft-rapid')
      && typeof price.provider === 'string'
      && typeof price.model === 'string'
      && typeof price.image_size === 'string'
      && typeof price.cost_per_image === 'number'
      && Number.isFinite(price.cost_per_image)
      && price.cost_per_image >= 0
      && price.currency === 'USD'
      && price.pricing_unit === 'per_image'
      && price.active === true
      && price.applicable === true
      && typeof price.source_url === 'string'
      && price.source_url.startsWith('https://')
      && typeof price.effective_from === 'string'
  })
  if (validPrices.length !== data.prices.length) throw new Error('The planner service returned invalid provider pricing.')
  const current = new Map<string, ProviderPrice>()
  for (const item of validPrices) {
    if (!current.has(item.quality_tier)) current.set(item.quality_tier, item)
  }
  return [...current.values()]
}

async function readFunctionError(error: unknown, fallback: string): Promise<Error> {
  if (typeof error === 'object' && error !== null && 'context' in error && error.context instanceof Response) {
    try {
      const body: unknown = await error.context.json()
      if (typeof body === 'object' && body !== null && 'error' in body) {
        const detail = body.error
        if (typeof detail === 'object' && detail !== null && 'message' in detail && typeof detail.message === 'string') {
          return new Error(detail.message)
        }
        if (typeof detail === 'string') return new Error(detail)
      }
    } catch {
      return new Error(`${fallback} (HTTP ${error.context.status})`)
    }
  }
  return error instanceof Error ? error : new Error(fallback)
}

export async function checkPlannerHealth(): Promise<{ status: 'available'; checked_at: string; provider_status: 'not_checked' }> {
  const client = requireClient()
  const { data, error } = await client.functions.invoke('planner-services', { body: { action: 'health' } })
  if (error) throw await readFunctionError(error, 'The planner service is unavailable.')
  if (typeof data !== 'object' || data === null || data.success !== true
    || data.status !== 'available' || data.provider_status !== 'not_checked'
    || typeof data.checked_at !== 'string' || Number.isNaN(Date.parse(data.checked_at))) {
    throw new Error('The planner service returned an invalid health response.')
  }
  return {
    status: 'available',
    checked_at: data.checked_at,
    provider_status: 'not_checked',
  }
}

export async function recommendQualityFromBackend(input: {
  prompt: string
  category: CreativeCategory
  intent: EducationalIntent
  targetAudience: string
  targetBudget: number | null
  budgetCurrency: string
  selectedTier?: 'studio-pro' | 'precision-lite' | 'draft-rapid'
}): Promise<QualityRecommendation> {
  const client = requireClient()
  const { data, error } = await client.functions.invoke('planner-services', {
    body: {
      action: 'recommendation',
      prompt: input.prompt,
      category: input.category,
      intent: input.intent,
      target_audience: input.targetAudience,
      target_budget: input.targetBudget,
      budget_currency: input.budgetCurrency,
      selected_quality_tier: input.selectedTier,
    },
  })
  if (error) throw await readFunctionError(error, 'Could not get a quality recommendation.')
  if (typeof data !== 'object' || data === null || data.success !== true
    || typeof data.recommendation !== 'object' || data.recommendation === null) {
    throw new Error('The planner service returned an invalid quality recommendation.')
  }
  const recommendation = data.recommendation as Record<string, unknown>
  if ((recommendation.tier !== 'studio-pro' && recommendation.tier !== 'precision-lite' && recommendation.tier !== 'draft-rapid')
    || typeof recommendation.reason !== 'string'
    || typeof recommendation.provider !== 'string'
    || (recommendation.model !== null && typeof recommendation.model !== 'string')
    || (recommendation.estimated_cost !== null && (typeof recommendation.estimated_cost !== 'number' || !Number.isFinite(recommendation.estimated_cost)))
    || (recommendation.currency !== null && typeof recommendation.currency !== 'string')
    || recommendation.pricing_unit !== 'per_image'
    || (recommendation.price_source_url !== null && typeof recommendation.price_source_url !== 'string')
    || (recommendation.price_effective_from !== null && typeof recommendation.price_effective_from !== 'string')
    || (recommendation.requested_image_size !== null && typeof recommendation.requested_image_size !== 'string')
    || (recommendation.pricing_status !== 'available' && recommendation.pricing_status !== 'unavailable')
    || !Array.isArray(recommendation.limitations)
    || !recommendation.limitations.every((item: unknown) => typeof item === 'string')) {
    throw new Error('The planner service returned invalid recommendation details.')
  }
  return recommendation as QualityRecommendation
}

export async function loadRequests(page = 1, pageSize = 100): Promise<ImageRequest[]> {
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100
    || !Number.isSafeInteger(page * pageSize)) {
    throw new Error('Choose a valid history page and a page size from 1 to 100.')
  }
  const client = requireClient()
  const { data, error } = await client
    .from('image_requests')
    .select('id,prompt,subject,grade,category,target_audience,intent,quality_tier,language,style,state,method,reused_asset_id,output_asset_id,quality_state,provider_charge,provider_currency,baseline_estimate,optimized_estimate,savings_estimate,savings_percentage,calculation_method,estimate_currency,pricing_source_url,pricing_effective_from,exchange_rate,exchange_rate_date,school_id,cost_source,created_at')
    .order('created_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1)
  if (error) throw error
  return (data ?? []) as ImageRequest[]
}

export async function loadRequest(requestId: string): Promise<ImageRequest | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new Error('Choose a valid image request.')
  }
  const client = requireClient()
  const { data, error } = await client
    .from('image_requests')
    .select('id,prompt,subject,grade,category,target_audience,intent,quality_tier,language,style,state,method,reused_asset_id,output_asset_id,quality_state,provider_charge,provider_currency,baseline_estimate,optimized_estimate,savings_estimate,savings_percentage,calculation_method,estimate_currency,pricing_source_url,pricing_effective_from,exchange_rate,exchange_rate_date,school_id,cost_source,created_at')
    .eq('id', requestId)
    .maybeSingle()
  if (error) throw error
  return data as ImageRequest | null
}

export async function loadMemberships(): Promise<Membership[]> {
  const client = requireClient()
  const { data, error } = await client
    .from('school_memberships')
    .select('school_id,role,school:schools(id,name,district,monthly_budget,warning_threshold,budget_currency)')
  if (error) throw error
  return (data ?? []).map((membership) => ({
    ...membership,
    school: Array.isArray(membership.school) ? membership.school[0] ?? null : membership.school,
  })) as Membership[]
}

export async function loadProfilePreferences(user: User): Promise<UserProfile | null> {
  const client = requireClient()
  const { data, error } = await client
    .from('profiles')
    .select('country_iso,phone_country_iso,phone_calling_code,preferred_currency,currency_overridden,preferred_language,default_category,default_audience,default_style')
    .eq('id', user.id)
    .maybeSingle()
  if (error) throw error
  return data as UserProfile | null
}

export async function saveProfilePreferences(
  user: User,
  preferences: {
    country_iso: string
    phone_country_iso: string | null
    phone_calling_code: string | null
    preferred_currency: string
    currency_overridden: boolean
    preferred_language: string
    default_category: CreativeCategory
    default_audience: string
    default_style: string
  },
) {
  const client = requireClient()
  const { error } = await client.from('profiles').upsert({ id: user.id, ...preferences })
  if (error) throw error
}

export async function generateImage(input: {
  idempotency_key: string
  prompt: string
  category: CreativeCategory
  custom_category: string
  target_audience: string
  intent: EducationalIntent
  language: string
  style: string
  quality_tier: 'studio-pro' | 'precision-lite' | 'draft-rapid'
  school_id: string | null
  target_budget: number | null
  target_budget_currency: string
  display_currency: string
}): Promise<ImageGenerationResult> {
  const client = requireClient()
  const { data, error } = await client.functions.invoke('generate-image', { body: input })
  if (error) throw await readFunctionError(error, 'The image service could not complete your request.')
  if (typeof data === 'object' && data !== null && data.state === 'uncertain') {
    const message = typeof data.message === 'string'
      ? data.message
      : 'The provider outcome is uncertain. Do not submit another generation until this request is reconciled.'
    throw new Error(`${message}${typeof data.request_id === 'string' ? ` Request ID: ${data.request_id}.` : ''}`)
  }
  if (typeof data === 'object' && data !== null && data.state === 'queued') {
    throw new Error(`This image request is still processing. Retry with the same request key; do not start a new generation.${typeof data.request_id === 'string' ? ` Request ID: ${data.request_id}.` : ''}`)
  }
  const estimateIsValid = (amount: unknown): amount is number | null =>
    amount === null || (typeof amount === 'number' && Number.isFinite(amount) && amount >= 0)
  const savingsIsValid = (amount: unknown): amount is number | null =>
    amount === null || (typeof amount === 'number' && Number.isFinite(amount))
  const fileSizeIsValid = (amount: unknown): amount is number | null | undefined =>
    amount === undefined || amount === null || (typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0)
  const imageSizeIsValid = (size: unknown): size is string | null | undefined =>
    size === undefined || size === null || typeof size === 'string'
  const qualityTierIsValid = (tier: unknown): tier is ImageGenerationResult['quality_tier'] =>
    tier === undefined || tier === 'studio-pro' || tier === 'precision-lite' || tier === 'draft-rapid'
  if (typeof data !== 'object' || data === null
    || typeof data.request_id !== 'string'
    || typeof data.image_url !== 'string'
    || typeof data.asset_id !== 'string'
    || (data.state !== 'generated' && data.state !== 'reused')
    || typeof data.message !== 'string'
    || !estimateIsValid(data.baseline_estimate)
    || !estimateIsValid(data.optimized_estimate)
    || !savingsIsValid(data.savings_estimate)
    || (data.state === 'generated' && (
      typeof data.provider !== 'string'
      || data.pricing_unit !== 'per_image'
      || typeof data.baseline_estimate !== 'number'
      || typeof data.optimized_estimate !== 'number'
      || typeof data.savings_estimate !== 'number'
      || typeof data.estimate_currency !== 'string'
      || typeof data.calculation_method !== 'string'
      || typeof data.method !== 'string'
      || typeof data.price_source_url !== 'string'
    ))
    || (data.savings_percentage !== null && data.savings_percentage !== undefined
      && (typeof data.savings_percentage !== 'number' || !Number.isFinite(data.savings_percentage)))
    || (data.cost_source !== 'estimated' && data.cost_source !== 'projected')) {
    throw new Error('The image service returned an incomplete response.')
  }
  return {
    ...data,
    image_file_size_bytes: fileSizeIsValid(data.image_file_size_bytes) ? data.image_file_size_bytes ?? null : null,
    image_size: imageSizeIsValid(data.image_size) ? data.image_size ?? null : null,
    quality_tier: qualityTierIsValid(data.quality_tier) ? data.quality_tier : undefined,
  } as ImageGenerationResult
}
