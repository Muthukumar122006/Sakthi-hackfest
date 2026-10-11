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
  preview_url: string | null
  licence: string | null
  attribution: string | null
  created_at: string
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
  state: 'draft' | 'queued' | 'generated' | 'reused' | 'failed'
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
  quality_tier: 'studio-pro' | 'precision-lite' | 'draft-rapid'
  model: string
  image_size: string
  cost_per_image: number
  currency: string
  source_url: string
  effective_from: string
}

export type ImageGenerationResult = {
  request_id: string
  image_url: string
  asset_id: string
  state: 'generated' | 'reused'
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

export async function loadAssetsForReview(schoolId: string): Promise<EducationalAsset[]> {
  const client = requireClient()
  const { data, error } = await client
    .from('educational_assets')
    .select('id,title,description,subject,intent,grade,category,target_audience,language,tags,kind,review_state,storage_path,file_size_bytes,source_url,licence,attribution,created_at')
    .eq('school_id', schoolId)
    .eq('review_state', 'pending')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw error
  return attachAssetPreviews((data ?? []) as EducationalAsset[], client)
}

export async function approveSchoolAsset(assetId: string) {
  const client = requireClient()
  const { error } = await client
    .from('educational_assets')
    .update({ review_state: 'approved' })
    .eq('id', assetId)
  if (error) throw error
}

export async function loadProviderPrices(): Promise<ProviderPrice[]> {
  const client = requireClient()
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await client
    .from('provider_pricing')
    .select('quality_tier,model,image_size,cost_per_image,currency,source_url,effective_from')
    .eq('active', true)
    .eq('provider', 'openai')
    .eq('currency', 'USD')
    .lte('effective_from', today)
    .order('effective_from', { ascending: false })
  if (error) throw error
  const current = new Map<string, ProviderPrice>()
  for (const item of (data ?? []) as ProviderPrice[]) {
    if (!current.has(item.quality_tier)) current.set(item.quality_tier, item)
  }
  return [...current.values()]
}

export async function loadRequests(): Promise<ImageRequest[]> {
  const client = requireClient()
  const { data, error } = await client
    .from('image_requests')
    .select('id,prompt,subject,grade,category,target_audience,intent,quality_tier,language,style,state,method,reused_asset_id,output_asset_id,quality_state,provider_charge,provider_currency,baseline_estimate,optimized_estimate,savings_estimate,savings_percentage,calculation_method,estimate_currency,pricing_source_url,pricing_effective_from,exchange_rate,exchange_rate_date,school_id,cost_source,created_at')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw error
  return (data ?? []) as ImageRequest[]
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
  if (error) {
    if (error.context instanceof Response) {
      let body: unknown
      try {
        body = await error.context.json()
      } catch {
        throw new Error(`Image service returned HTTP ${error.context.status}.`)
      }
      if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') {
        throw new Error(body.error)
      }
    }
    throw error
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
      typeof data.baseline_estimate !== 'number'
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
