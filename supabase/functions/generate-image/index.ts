import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  buildGenerationPrompt,
  createRequestFingerprint,
  hasValidPng,
  isBase64Payload,
  providerOutcomeIsUncertain,
  supportsGptImage2Config,
} from '../_shared/image-helpers.mjs'

const appOrigin = Deno.env.get('APP_ORIGIN')?.trim() || 'http://127.0.0.1:5173'
const parsedAppOrigin = new URL(appOrigin)
const isLocalAppOrigin = parsedAppOrigin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsedAppOrigin.hostname)
if (parsedAppOrigin.origin !== appOrigin || (parsedAppOrigin.protocol !== 'https:' && !isLocalAppOrigin)) {
  throw new Error('APP_ORIGIN must be an HTTPS origin, except for localhost development.')
}
const corsHeaders = {
  'Access-Control-Allow-Origin': appOrigin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
}
const maximumRequestBytes = 32768
const maximumImageBytes = 10485760
const maximumBase64ImageLength = Math.ceil(maximumImageBytes / 3) * 4

type CreativeCategory =
  | 'fun'
  | 'motivational'
  | 'bold'
  | 'educational'
  | 'minimal'
  | 'inspirational'
  | 'cute'
  | 'professional'
  | 'creative'
  | 'custom'

type Intent =
  | 'colouring_worksheet'
  | 'flashcard'
  | 'textbook_illustration'
  | 'science_diagram'
  | 'educational_poster'
  | 'general_illustration'

type QualityTier = 'draft-rapid' | 'precision-lite' | 'studio-pro'

type GenerateRequest = {
  idempotency_key: string
  prompt: string
  category: CreativeCategory
  custom_category: string
  target_audience: string
  intent: Intent
  language: string
  style: string
  quality_tier: QualityTier
  school_id?: string | null
  target_budget?: number | null
  target_budget_currency?: string | null
  display_currency: string
}

const intents = new Set<Intent>([
  'colouring_worksheet', 'flashcard', 'textbook_illustration',
  'science_diagram', 'educational_poster', 'general_illustration',
])
const tiers = new Set<QualityTier>(['draft-rapid', 'precision-lite', 'studio-pro'])
const categories = new Set<CreativeCategory>([
  'fun', 'motivational', 'bold', 'educational', 'minimal',
  'inspirational', 'cute', 'professional', 'creative', 'custom',
])
const audiences = new Set([
  'Early childhood: ages 3–5',
  'Young children: ages 6–8',
  'Older children: ages 9–12',
  'Teenagers: ages 13–17',
  'Young adults: ages 18–24',
  'Adults: ages 25–59',
  'Older adults: ages 60+',
  'All ages',
])

function json(status: number, body: Record<string, unknown>) {
  const errorMessage = typeof body.error === 'string' ? body.error : null
  const payload = errorMessage
    ? {
      success: false,
      error: {
        code: status === 400 ? 'VALIDATION_ERROR'
          : status === 401 ? 'AUTHENTICATION_REQUIRED'
          : status === 403 ? 'FORBIDDEN'
          : status === 404 ? 'NOT_FOUND'
          : status === 409 ? 'CONFLICT'
          : status === 413 ? 'PAYLOAD_TOO_LARGE'
          : status === 429 ? 'RATE_LIMITED'
          : status === 502 ? 'PROVIDER_ERROR'
          : status >= 500 ? 'SERVICE_ERROR'
          : 'REQUEST_ERROR',
        message: errorMessage,
      },
    }
    : { success: true, ...body }
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readBoundedJson(request: Request): Promise<
  { body: unknown; errorStatus?: never } | { body?: never; errorStatus: 400 | 413 }
> {
  const contentLength = request.headers.get('Content-Length')
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maximumRequestBytes)) {
    return { errorStatus: 413 }
  }
  if (!request.body) return { errorStatus: 400 }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maximumRequestBytes) {
        await reader.cancel()
        return { errorStatus: 413 }
      }
      chunks.push(value)
    }

    const bytes = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return { body: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown }
  } catch {
    return { errorStatus: 400 }
  } finally {
    reader.releaseLock()
  }
}

async function readBoundedResponseJson(response: Response, maximumBytes: number): Promise<unknown | null> {
  if (!response.body) return null
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maximumBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }
}

function sha256(bytes: Uint8Array) {
  const digestInput = new Uint8Array(bytes.byteLength)
  digestInput.set(bytes)
  return crypto.subtle.digest('SHA-256', digestInput.buffer).then((hash) =>
    [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join(''),
  )
}

function requestFingerprint(request: GenerateRequest) {
  const exactRequest = [
    request.prompt.trim().replace(/\s+/g, ' ').toLowerCase(),
    request.category,
    request.custom_category.trim().toLowerCase(),
    request.target_audience.trim().toLowerCase(),
    request.intent,
    request.language.trim().toLowerCase(),
    request.style.trim().toLowerCase(),
    request.quality_tier,
  ].join('\n')
  return sha256(new TextEncoder().encode(exactRequest))
}

function idempotencyFingerprint(
  request: GenerateRequest,
  schoolId: string | null,
  providerMethod: string | null,
  imageSize: string | null,
) {
  return createRequestFingerprint(request, schoolId, providerMethod, imageSize)
}

async function getUsdRate(currency: string) {
  if (currency === 'USD') return { rate: 1, date: null as string | null, sourceUrl: null as string | null }
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Choose a valid currency code.')
  const sourceUrl = `https://api.frankfurter.dev/v1/latest?base=USD&symbols=${currency}`
  const response = await fetch(sourceUrl, {
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`Could not get the USD to ${currency} exchange rate.`)
  const result = await response.json() as { date?: string; rates?: Record<string, number> }
  const rate = result.rates?.[currency]
  if (!result.date || typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    throw new Error(`No USD to ${currency} exchange rate is available.`)
  }
  return { rate, date: result.date, sourceUrl }
}

function validateRequest(value: unknown): GenerateRequest | null {
  if (!isRecord(value)) return null
  if (typeof value.idempotency_key !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.idempotency_key)) return null
  if (typeof value.prompt !== 'string' || value.prompt.trim().length < 3 || value.prompt.length > 4000) return null
  if (typeof value.category !== 'string' || !categories.has(value.category as CreativeCategory)) return null
  if (typeof value.custom_category !== 'string' || value.custom_category.length > 100) return null
  if (value.category === 'custom' && !value.custom_category.trim()) return null
  if (typeof value.target_audience !== 'string'
    || (!audiences.has(value.target_audience)
      && !/^Custom ages \d{1,3}-\d{1,3}$/.test(value.target_audience))) return null
  const customAgeRange = value.target_audience.match(/^Custom ages (\d+)-(\d+)$/)
  if (customAgeRange && (Number(customAgeRange[1]) > Number(customAgeRange[2]) || Number(customAgeRange[2]) > 120)) return null
  if (typeof value.intent !== 'string' || !intents.has(value.intent as Intent)) return null
  if (typeof value.language !== 'string' || !/^[a-z]{2,3}(-[A-Z]{2})?$/.test(value.language)) return null
  if (typeof value.style !== 'string' || value.style.length > 160) return null
  if (typeof value.quality_tier !== 'string' || !tiers.has(value.quality_tier as QualityTier)) return null
  if (value.school_id !== undefined && value.school_id !== null
    && (typeof value.school_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.school_id))) return null
  if (value.target_budget !== undefined && value.target_budget !== null
    && (typeof value.target_budget !== 'number' || !Number.isFinite(value.target_budget) || value.target_budget < 0)) return null
  if (value.target_budget_currency !== undefined && value.target_budget_currency !== null
    && (typeof value.target_budget_currency !== 'string' || !/^[A-Z]{3}$/.test(value.target_budget_currency))) return null
  if (typeof value.display_currency !== 'string' || !/^[A-Z]{3}$/.test(value.display_currency)) return null
  return value as GenerateRequest
}

Deno.serve(async (request) => {
  const requestOrigin = request.headers.get('Origin')
  if (requestOrigin && requestOrigin !== appOrigin) {
    return new Response(JSON.stringify({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Origin not allowed.' },
    }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', 'Vary': 'Origin' },
    })
  }
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json(405, { error: 'Use POST to create an image.' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const openAiKey = Deno.env.get('OPENAI_API_KEY')
  if (!supabaseUrl || !anonKey || !serviceKey) return json(503, { error: 'The Supabase function is not configured.' })
  if (!openAiKey) return json(503, { error: 'Image generation is not configured. Set the server-side OPENAI_API_KEY secret.' })

  const authorization = request.headers.get('Authorization')
  if (!authorization) return json(401, { error: 'Sign in before making an image.' })
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: authData, error: authError } = await userClient.auth.getUser()
  if (authError || !authData.user) return json(401, { error: 'Your session is no longer valid. Sign in again.' })

  const parsedBody = await readBoundedJson(request)
  if (parsedBody.errorStatus === 413) return json(413, { error: 'The request body is too large.' })
  if (parsedBody.errorStatus === 400) return json(400, { error: 'The request body must be valid JSON.' })
  const body = parsedBody.body
  const input = validateRequest(body)
  if (!input) return json(400, { error: 'Check the image description, class, language, style, purpose and budget fields.' })
  const fullPrompt = buildGenerationPrompt(input)

  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const schoolId = input.school_id ?? null
  let school: { id: string; monthly_budget: number; budget_currency: string } | null = null
  if (schoolId) {
    const { data: membership, error: membershipError } = await service
      .from('school_memberships')
      .select('school:schools(id,monthly_budget,budget_currency)')
      .eq('school_id', schoolId)
      .eq('user_id', authData.user.id)
      .maybeSingle()
    if (membershipError) return json(500, { error: 'Could not check school access.' })
    if (!membership) return json(403, { error: 'You are not a member of this school.' })
    const relatedSchool = membership.school
    school = Array.isArray(relatedSchool) ? relatedSchool[0] ?? null : relatedSchool
    if (!school) return json(404, { error: 'The selected school was not found.' })
  }

  const { data: priorRequest, error: priorRequestError } = await service.from('image_requests')
    .select('id,state,output_asset_id,reused_asset_id,method,quality_tier,requested_image_size,request_fingerprint,baseline_estimate,optimized_estimate,savings_estimate,savings_percentage,estimate_currency,calculation_method,pricing_source_url,pricing_effective_from,cost_source')
    .eq('user_id', authData.user.id)
    .eq('idempotency_key', input.idempotency_key)
    .maybeSingle()
  if (priorRequestError) return json(500, { error: 'Could not check for a duplicate image request.' })
  if (priorRequest) {
    const retryFingerprint = await idempotencyFingerprint(
      input,
      schoolId,
      priorRequest.method,
      priorRequest.requested_image_size,
    )
    if (!priorRequest.request_fingerprint || priorRequest.request_fingerprint !== retryFingerprint) {
      return json(409, { error: 'This request key was already used for different or unverifiable input. Start a new request with a new key.' })
    }
    if (priorRequest.state === 'uncertain') {
      return json(202, {
        request_id: priorRequest.id,
        state: 'uncertain',
        message: 'The provider may have completed this request, but its result could not be confirmed. Do not resubmit it; an administrator must reconcile the request.',
      })
    }
    if (priorRequest.state === 'queued') {
      return json(202, {
        request_id: priorRequest.id,
        state: 'queued',
        message: 'This image request is still being processed. Wait, then retry with the same request key; do not start a new generation.',
      })
    }
    if (priorRequest.state !== 'generated' && priorRequest.state !== 'reused') {
      return json(409, { error: 'This request already failed. Start a new request to try again.' })
    }
    const assetId = priorRequest.output_asset_id ?? priorRequest.reused_asset_id
    if (!assetId) return json(500, { error: 'The previous request has no saved image. An administrator must review it.' })
    const { data: priorAsset, error: priorAssetError } = await service.from('educational_assets')
      .select('storage_path,kind,file_size_bytes')
      .eq('id', assetId)
      .maybeSingle()
    if (priorAssetError || !priorAsset?.storage_path) {
      return json(500, { error: 'The saved image for this request could not be found.' })
    }
    const { data: priorSignedFile, error: priorSignedFileError } = await service.storage
      .from('educational-images')
      .createSignedUrl(priorAsset.storage_path, 300)
    if (priorSignedFileError) return json(500, { error: 'The saved image could not be opened.' })
    return json(200, {
      request_id: priorRequest.id,
      image_url: priorSignedFile.signedUrl,
      asset_id: assetId,
      state: priorRequest.state,
      method: priorRequest.method,
      quality_tier: priorRequest.quality_tier,
      image_size: priorRequest.requested_image_size,
      image_file_size_bytes: priorAsset.file_size_bytes === null ? null : Number(priorAsset.file_size_bytes),
      baseline_estimate: priorRequest.baseline_estimate,
      optimized_estimate: priorRequest.optimized_estimate,
      savings_estimate: priorRequest.savings_estimate,
      savings_percentage: priorRequest.savings_percentage,
      estimate_currency: priorRequest.estimate_currency,
      calculation_method: priorRequest.calculation_method,
      price_source_url: priorRequest.pricing_source_url,
      price_effective_from: priorRequest.pricing_effective_from,
      cost_source: priorRequest.cost_source,
      message: 'Returned the image from your earlier successful request. No new image was generated.',
    })
  }

  const today = new Date().toISOString().slice(0, 10)
  const { data: baselinePrice, error: baselinePriceError } = await service.from('provider_pricing')
    .select('cost_per_image,source_url,effective_from')
    .eq('provider', Deno.env.get('IMAGE_PROVIDER') ?? 'openai')
    .eq('quality_tier', 'studio-pro')
    .eq('currency', 'USD')
    .eq('active', true)
    .lte('effective_from', today)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (baselinePriceError) return json(500, { error: 'Could not load the configured Studio Pro baseline price.' })
  if (baselinePrice && (
    baselinePrice.currency !== 'USD'
    || !Number.isFinite(Number(baselinePrice.cost_per_image))
    || Number(baselinePrice.cost_per_image) < 0
    || typeof baselinePrice.source_url !== 'string'
    || !baselinePrice.source_url.startsWith('https://')
    || typeof baselinePrice.effective_from !== 'string'
  )) {
    return json(503, { error: 'The active Studio Pro baseline price is incomplete or invalid. Ask an administrator to review it.' })
  }

  const fingerprint = await requestFingerprint(input)
  let assetQuery = service.from('educational_assets')
    .select('id,title,storage_path,school_id,kind,file_size_bytes')
    .eq('review_state', 'approved')
    .eq('source_prompt_hash', fingerprint)
    .eq('category', input.category)
    .eq('target_audience', input.target_audience)
    .eq('intent', input.intent)
    .eq('quality_tier', input.quality_tier)
    .eq('language', input.language)
  assetQuery = schoolId
    ? assetQuery.or(`visibility.eq.shared,and(visibility.eq.school,school_id.eq.${schoolId})`)
    : assetQuery.or(`visibility.eq.shared,and(visibility.eq.private,created_by.eq.${authData.user.id})`)
  const { data: cachedAsset, error: cacheError } = await assetQuery.limit(1).maybeSingle()
  if (cacheError) return json(500, { error: 'Could not check approved reusable images.' })

  if (cachedAsset?.storage_path) {
    const { data: signedFile, error: signedFileError } = await service.storage
      .from('educational-images')
      .createSignedUrl(cachedAsset.storage_path, 300)
    if (signedFileError) return json(500, { error: 'The reusable image could not be opened.' })
    const reuseMethod = 'Exact approved library match'
    const reuseFingerprint = await idempotencyFingerprint(input, schoolId, reuseMethod, null)
    const { data: savedRequest, error: saveError } = await service.from('image_requests')
      .insert({
        user_id: authData.user.id,
        idempotency_key: input.idempotency_key,
        request_fingerprint: reuseFingerprint,
        source_prompt_hash: fingerprint,
        school_id: schoolId,
        prompt: input.prompt,
        category: input.category,
        target_audience: input.target_audience,
        subject: '',
        grade: '',
        intent: input.intent,
        quality_tier: input.quality_tier,
        language: input.language,
        style: input.style,
        display_currency: input.display_currency,
        state: 'reused',
        requested_image_size: null,
        method: reuseMethod,
        reused_asset_id: cachedAsset.id,
        provider_currency: 'USD',
        baseline_estimate: baselinePrice ? Number(baselinePrice.cost_per_image) : null,
        optimized_estimate: 0,
        savings_estimate: baselinePrice ? Number(baselinePrice.cost_per_image) : null,
        savings_percentage: baselinePrice && Number(baselinePrice.cost_per_image) > 0 ? 100 : null,
        calculation_method: 'Studio Pro published USD estimate minus avoided image-generation API call; other hosting or service costs are not included.',
        pricing_effective_from: today,
        pricing_source_url: baselinePrice?.source_url ?? null,
        baseline_pricing_effective_from: baselinePrice?.effective_from ?? null,
        baseline_pricing_source_url: baselinePrice?.source_url ?? null,
        estimate_currency: 'USD',
        exchange_rate: input.display_currency === 'USD' ? 1 : null,
        cost_source: 'estimated',
      })
      .select('id,state,reused_asset_id')
      .single()
    if (saveError) {
      // A concurrent retry may have inserted this idempotency key after the
      // initial lookup. Treat that as an in-progress request; a retry will
      // return its saved result without creating another request.
      if (saveError.code === '23505') {
        return json(409, { error: 'This request was submitted concurrently. Retry with the same request key to retrieve its result.' })
      }
      return json(500, { error: 'The request matched an image, but the reuse record could not be saved.' })
    }
    return json(200, {
      request: savedRequest,
      kind: cachedAsset.kind,
      request_id: savedRequest.id,
      asset_id: cachedAsset.id,
      image_url: signedFile.signedUrl,
      state: 'reused',
      image_size: null,
      image_file_size_bytes: cachedAsset.file_size_bytes === null ? null : Number(cachedAsset.file_size_bytes),
      message: 'An exact, approved image was reused. No image was generated.',
      cost_source: 'estimated',
      estimated_generation_cost_avoided: baselinePrice ? Number(baselinePrice.cost_per_image) : null,
      baseline_estimate: baselinePrice ? Number(baselinePrice.cost_per_image) : null,
      optimized_estimate: 0,
      savings_estimate: baselinePrice ? Number(baselinePrice.cost_per_image) : null,
      savings_percentage: baselinePrice && Number(baselinePrice.cost_per_image) > 0 ? 100 : null,
      estimate_currency: 'USD',
      calculation_method: 'Studio Pro published USD estimate minus avoided image-generation API call; other hosting or service costs are not included.',
      provider_currency: 'USD',
      price_source_url: baselinePrice?.source_url ?? null,
      price_effective_from: baselinePrice?.effective_from ?? null,
    })
  }

  const provider = Deno.env.get('IMAGE_PROVIDER') ?? 'openai'
  if (provider !== 'openai') return json(503, { error: 'The configured image provider is not supported by this function.' })
  const { data: selectedPrice, error: selectedPriceError } = await service.from('provider_pricing')
    .select('provider,model,quality_tier,image_size,currency,cost_per_image,source_url,effective_from')
    .eq('provider', provider)
    .eq('quality_tier', input.quality_tier)
    .eq('currency', 'USD')
    .eq('active', true)
    .lte('effective_from', today)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (selectedPriceError) return json(500, { error: 'Could not load the configured provider price.' })
  if (!selectedPrice) return json(503, { error: 'No current, source-linked provider price is configured for this quality. An admin must add one before generation.' })
  if (selectedPrice.provider !== provider
    || selectedPrice.currency !== 'USD'
    || selectedPrice.quality_tier !== input.quality_tier
    || !Number.isFinite(Number(selectedPrice.cost_per_image))
    || Number(selectedPrice.cost_per_image) < 0
    || typeof selectedPrice.model !== 'string'
    || typeof selectedPrice.image_size !== 'string'
    || typeof selectedPrice.source_url !== 'string'
    || !selectedPrice.source_url.startsWith('https://')
    || typeof selectedPrice.effective_from !== 'string') {
    return json(503, { error: 'The active provider pricing configuration is incomplete or inconsistent. Ask an administrator to review it.' })
  }
  const providerQuality = input.quality_tier === 'studio-pro'
    ? 'high'
    : input.quality_tier === 'precision-lite' ? 'medium' : 'low'
  if (!supportsGptImage2Config(selectedPrice.model, selectedPrice.image_size, providerQuality)) {
    return json(503, { error: 'The configured model, image size, or quality is not supported by the GPT Image 2 generation endpoint.' })
  }

  if (!baselinePrice) return json(503, { error: 'Add a current Studio Pro baseline price before generation so savings can be compared fairly.' })

  let budgetRate = 1
  let budgetRateDate: string | null = null
  let budgetRateSourceUrl: string | null = null
  let targetBudgetRate = 1
  let targetBudgetRateDate: string | null = null
  let targetBudgetRateSourceUrl: string | null = null
  const displayRate = input.display_currency === 'USD' ? 1 : null
  let budgetCurrency = school?.budget_currency ?? 'USD'
  try {
    if (school) {
      const budgetExchange = await getUsdRate(budgetCurrency)
      budgetRate = budgetExchange.rate
      budgetRateDate = budgetExchange.date
      budgetRateSourceUrl = budgetExchange.sourceUrl
    }
    if (input.target_budget !== undefined && input.target_budget !== null) {
      const requestBudgetCurrency = input.target_budget_currency ?? 'USD'
      const targetExchange = await getUsdRate(requestBudgetCurrency)
      targetBudgetRate = targetExchange.rate
      targetBudgetRateDate = targetExchange.date
      targetBudgetRateSourceUrl = targetExchange.sourceUrl
      if (Number(selectedPrice.cost_per_image) * targetBudgetRate > input.target_budget) {
        return json(409, { error: 'This option costs more than your maximum budget. Choose a lower-cost quality level.' })
      }
    }
  } catch (budgetError) {
    return json(503, { error: budgetError instanceof Error ? budgetError.message : 'Could not check the budget safely.' })
  }

  const providerMethod = `${selectedPrice.provider}/${selectedPrice.model}`
  const requestFingerprint = await idempotencyFingerprint(
    input,
    schoolId,
    providerMethod,
    selectedPrice.image_size,
  )
  const { data: queuedRequest, error: insertError } = await service.from('image_requests')
    .insert({
      user_id: authData.user.id,
      school_id: schoolId,
      request_fingerprint: requestFingerprint,
      source_prompt_hash: fingerprint,
      provider_prompt: fullPrompt,
      prompt: input.prompt,
      subject: '',
      grade: '',
      category: input.category,
      target_audience: input.target_audience,
      intent: input.intent,
      quality_tier: input.quality_tier,
      requested_image_size: selectedPrice.image_size,
      language: input.language,
      style: input.style,
      target_budget: input.target_budget ?? null,
      target_budget_currency: input.target_budget_currency ?? null,
      target_budget_exchange_rate: input.target_budget !== undefined && input.target_budget !== null ? targetBudgetRate : null,
      target_budget_exchange_rate_date: input.target_budget !== undefined && input.target_budget !== null ? targetBudgetRateDate : null,
      idempotency_key: input.idempotency_key,
      display_currency: input.display_currency,
      exchange_rate: displayRate,
      exchange_rate_date: null,
      exchange_rate_source_url: null,
      school_budget_exchange_rate: school ? budgetRate : null,
      school_budget_exchange_rate_date: school ? budgetRateDate : null,
      school_budget_exchange_rate_source_url: school ? budgetRateSourceUrl : null,
      target_budget_exchange_rate_source_url: input.target_budget !== undefined && input.target_budget !== null
        ? targetBudgetRateSourceUrl
        : null,
      state: 'queued',
      method: providerMethod,
      provider_currency: 'USD',
      baseline_estimate: Number(baselinePrice.cost_per_image),
      optimized_estimate: Number(selectedPrice.cost_per_image),
      savings_estimate: Number(baselinePrice.cost_per_image) - Number(selectedPrice.cost_per_image),
      savings_percentage: Number(baselinePrice.cost_per_image) > 0
        ? (Number(baselinePrice.cost_per_image) - Number(selectedPrice.cost_per_image)) / Number(baselinePrice.cost_per_image) * 100
        : null,
      calculation_method: 'Studio Pro published USD price minus selected-tier published USD price. Prices are estimates and exclude other service costs.',
      pricing_effective_from: selectedPrice.effective_from,
      pricing_source_url: selectedPrice.source_url,
      baseline_pricing_effective_from: baselinePrice.effective_from,
      baseline_pricing_source_url: baselinePrice.source_url,
      estimate_currency: 'USD',
      cost_source: 'estimated',
    })
    .select('id')
    .single()
  if (insertError) {
    // The unique (user_id, idempotency_key) index is the final guard against
    // concurrent Edge Function invocations. Do not start another provider
    // call when another invocation already claimed the key.
    if (insertError.code === '23505') {
      return json(409, { error: 'This request was submitted concurrently. Retry with the same request key to retrieve its result.' })
    }
    return json(500, { error: 'Could not save the image request.' })
  }

  let reservationId: string | null = null
  if (school) {
    const { data: reservedId, error: reservationError } = await service.rpc('reserve_school_budget', {
      target_school_id: school.id,
      target_request_id: queuedRequest.id,
      estimated_amount: Number(selectedPrice.cost_per_image) * budgetRate,
      target_currency: budgetCurrency,
    })
    if (reservationError) {
      console.error('Could not reserve the school budget.', queuedRequest.id, reservationError)
      const { data: possibleReservation, error: lookupError } = await service.from('school_budget_reservations')
        .select('id')
        .eq('image_request_id', queuedRequest.id)
        .maybeSingle()
      if (lookupError) console.error('Could not check for a reservation after a budget error.', queuedRequest.id, lookupError)
      if (possibleReservation?.id) {
        const { error: releaseError } = await service.rpc('release_school_budget_reservation', {
          target_reservation_id: possibleReservation.id,
        })
        if (releaseError) console.error('Could not release a reservation after a budget error.', possibleReservation.id, releaseError)
      }
      const { error: updateError } = await service.from('image_requests')
        .update({ state: 'failed' })
        .eq('id', queuedRequest.id)
      if (updateError) console.error('Could not mark a rejected budget request as failed.', queuedRequest.id, updateError)
      if (lookupError || updateError) {
        return json(500, { error: 'Could not reserve or safely clean up the school budget request. An administrator must review it.' })
      }
      return json(503, { error: 'Could not reserve the school budget safely. Please try again or contact an administrator.' })
    }
    if (typeof reservedId !== 'string') {
      const { error: updateError } = await service.from('image_requests')
        .update({ state: 'failed' })
        .eq('id', queuedRequest.id)
      if (updateError) {
        console.error('Could not mark an over-budget request as failed.', queuedRequest.id, updateError)
        return json(500, { error: 'The school budget was not available and the request needs administrator cleanup.' })
      }
      return json(409, { error: 'This image would exceed the school budget. Choose a lower-cost option or ask an admin to review the budget.' })
    }
    reservationId = reservedId
  }

  const failRequest = async (status: number, message: string, knownProviderRejection = false) => {
    const { data: failed, error: failureError } = await service.rpc('fail_image_generation', {
      target_request_id: queuedRequest.id,
      target_reservation_id: reservationId,
      target_error_code: status === 429 ? 'generation_rate_limited' : 'generation_failed',
      target_quality_note: null,
      target_known_rejection: knownProviderRejection,
    })
    if (failureError) console.error('Could not atomically fail an image request.', queuedRequest.id, failureError)
    const cleanupFailed = Boolean(failureError || failed !== true)
    return json(status, {
      error: cleanupFailed
        ? `${message} The request state or budget reservation could not be confirmed; administrator attention is required.`
        : message,
    })
  }
  const markUncertain = async (errorCode: string, message: string) => {
    const { data: updated, error: updateError } = await service.from('image_requests')
      .update({ state: 'uncertain', provider_error_code: errorCode })
      .eq('id', queuedRequest.id)
      .eq('state', 'queued')
      .select('id')
      .maybeSingle()
    if (updateError) {
      console.error('Could not mark an image request uncertain.', queuedRequest.id, updateError)
      return json(503, { error: 'The provider outcome could not be confirmed and the request state needs administrator attention. Do not resubmit this generation.' })
    }
    if (!updated) {
      const { data: currentRequest, error: lookupError } = await service.from('image_requests')
        .select('state')
        .eq('id', queuedRequest.id)
        .maybeSingle()
      if (lookupError) console.error('Could not verify an uncertain image request.', queuedRequest.id, lookupError)
      if (currentRequest?.state !== 'uncertain') {
        return json(503, { error: 'The provider outcome could not be confirmed. Do not resubmit this generation; an administrator must reconcile its state.' })
      }
    }
    return json(202, {
      request_id: queuedRequest.id,
      state: 'uncertain',
      message,
    })
  }
  const { data: attemptClaimed, error: attemptError } = await service.rpc('claim_image_provider_attempt', {
    target_request_id: queuedRequest.id,
  })
  if (attemptError) {
    console.error('Could not claim the provider generation slot.', queuedRequest.id, attemptError)
    return failRequest(503, 'The generation limit could not be checked safely. Try again later.', true)
  }
  if (attemptClaimed !== true) {
    return failRequest(429, 'You have reached the image request limit of 10 provider attempts per hour. Try again later.')
  }

  let providerResponse: Response
  try {
    providerResponse = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      signal: AbortSignal.timeout(90000),
      headers: { Authorization: `Bearer ${openAiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: selectedPrice.model,
        prompt: fullPrompt,
        size: selectedPrice.image_size,
        quality: input.quality_tier === 'studio-pro' ? 'high' : input.quality_tier === 'precision-lite' ? 'medium' : 'low',
        output_format: 'png',
      }),
    })
  } catch (providerError) {
    const errorName = providerError instanceof Error ? providerError.name : 'UnknownError'
    console.error('The image provider outcome is uncertain.', queuedRequest.id, errorName)
    return markUncertain('provider_transport_outcome_unknown', 'The provider request timed out or lost its connection. It may have generated an image; do not resubmit. An administrator must reconcile it.')
  }

  if (!providerResponse.ok) {
    console.error('The image provider rejected the generation request.', queuedRequest.id, providerResponse.status)
    if (providerOutcomeIsUncertain(providerResponse.status)) {
      return markUncertain('provider_server_outcome_unknown', `The provider returned HTTP ${providerResponse.status}; it may have processed the request. Do not resubmit it; an administrator must reconcile the outcome.`)
    }
    if (providerResponse.status === 429) {
      return failRequest(503, 'The image provider is rate limiting requests. Wait briefly before trying again.', true)
    }
    return failRequest(
      502,
      `The image provider returned an error (${providerResponse.status}).`,
      providerResponse.status >= 400 && providerResponse.status < 500,
    )
  }

  const responseContentType = providerResponse.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase()
  const contentLengthHeader = providerResponse.headers.get('Content-Length')
  const responseContentLength = contentLengthHeader === null ? 0 : Number(contentLengthHeader)
  if (responseContentType !== 'application/json'
    || (contentLengthHeader !== null
      && (!/^\d+$/.test(contentLengthHeader) || !Number.isSafeInteger(responseContentLength)
        || responseContentLength > maximumBase64ImageLength + 65536))) {
    return markUncertain('provider_response_format_unknown', 'The provider succeeded but returned an unexpected or oversized response. Do not resubmit; an administrator must reconcile it.')
  }
  const providerResult = await readBoundedResponseJson(providerResponse, maximumBase64ImageLength + 65536)
  if (providerResult === null) {
    return markUncertain('provider_response_json_invalid', 'The provider may have generated an image, but its response could not be read within the safety limit. Do not resubmit; an administrator must reconcile it.')
  }
  const responseData = isRecord(providerResult) && Array.isArray(providerResult.data)
    ? providerResult.data[0]
    : null
  const encodedImage = isRecord(responseData) ? responseData.b64_json : null
  if (typeof encodedImage !== 'string' || !encodedImage) {
    console.error('The image provider response did not contain base64 image data.', queuedRequest.id)
    return markUncertain('provider_image_missing', 'The provider may have generated an image but returned no usable image data. Do not resubmit; an administrator must reconcile it.')
  }
  if (!isBase64Payload(encodedImage, maximumBase64ImageLength)) {
    console.error('The image provider returned an image payload outside the supported size or format.', queuedRequest.id)
    return markUncertain('provider_image_payload_invalid', 'The provider returned image data that failed the safety and size limits. Do not resubmit; an administrator must reconcile the request.')
  }
  let imageBytes: Uint8Array
  try {
    imageBytes = Uint8Array.from(atob(encodedImage), (character) => character.charCodeAt(0))
  } catch (decodeError) {
    console.error('The image provider response contained invalid base64 data.', queuedRequest.id, decodeError)
    return markUncertain('provider_image_decode_failed', 'The provider returned image data that could not be decoded. Do not resubmit; an administrator must reconcile the request.')
  }
  if (!hasValidPng(imageBytes)) {
    return markUncertain('provider_image_validation_failed', 'The provider returned an image that did not pass basic PNG validation. Do not resubmit; an administrator must reconcile the request.')
  }
  if (imageBytes.byteLength > maximumImageBytes) {
    return markUncertain('provider_image_exceeds_storage_limit', 'The generated image exceeds the configured storage limit. Do not resubmit; an administrator must reconcile the request.')
  }

  const storagePath = schoolId
    ? `schools/${schoolId}/${authData.user.id}/${queuedRequest.id}.png`
    : `users/${authData.user.id}/${queuedRequest.id}.png`
  const { error: uploadError } = await service.storage.from('educational-images').upload(
    storagePath,
    imageBytes,
    { contentType: 'image/png', upsert: false },
  )
  if (uploadError) {
    console.error('Could not safely confirm image upload.', queuedRequest.id, uploadError)
    return markUncertain('storage_upload_outcome_unknown', 'The image was generated but its storage status could not be confirmed. Do not resubmit; an administrator must reconcile it.')
  }

  let assetId: string | null = null
  try {
    const { data: completedAssetId, error: completionError } = await service.rpc('complete_image_generation', {
      target_request_id: queuedRequest.id,
      target_storage_path: storagePath,
      target_file_size_bytes: imageBytes.byteLength,
      target_content_hash: await sha256(imageBytes),
      target_source_prompt_hash: await fingerprint,
      target_description: fullPrompt,
      target_reservation_id: reservationId,
    })
    if (completionError) throw completionError
    if (typeof completedAssetId !== 'string') throw new Error('The completion service returned no asset ID.')
    assetId = completedAssetId
  } catch (completionError) {
    console.error('Could not atomically complete the image request.', queuedRequest.id, completionError)
    const { data: persistedRequest, error: verifyError } = await service.from('image_requests')
      .select('state,output_asset_id')
      .eq('id', queuedRequest.id)
      .maybeSingle()
    if (verifyError) {
      console.error('Could not verify the image request after a completion error.', queuedRequest.id, verifyError)
      return markUncertain('completion_status_unknown', 'The image was uploaded but the saved request state could not be confirmed. Do not resubmit; an administrator must reconcile it.')
    }
    if (persistedRequest?.state === 'generated' && persistedRequest.output_asset_id) {
      assetId = persistedRequest.output_asset_id
    } else {
      const { error: removeError } = await service.storage.from('educational-images').remove([storagePath])
      if (removeError) console.error('Could not remove an unindexed image file.', storagePath, removeError)
      return markUncertain(
        removeError ? 'completion_cleanup_failed' : 'completion_failed',
        removeError
          ? 'The image was uploaded but could not be finalized or safely cleaned up. Do not resubmit; an administrator must reconcile it.'
          : 'The provider returned an image but the request could not be finalized. Do not resubmit; an administrator must reconcile it.',
      )
    }
  }
  if (!assetId) {
    return json(500, { error: 'The image was saved, but the completed asset could not be identified.' })
  }

  const { data: signedFile, error: signedFileError } = await service.storage
    .from('educational-images')
    .createSignedUrl(storagePath, 300)
  if (signedFileError) return json(500, { error: 'The image was saved, but a preview link could not be created.' })
  return json(200, {
    request_id: queuedRequest.id,
    image_url: signedFile.signedUrl,
    asset_id: assetId,
    state: 'generated',
    provider: selectedPrice.provider,
    pricing_unit: 'per_image',
    quality_state: 'not_checked',
    quality_tier: input.quality_tier,
    cost_source: 'estimated',
    estimated_provider_cost: Number(selectedPrice.cost_per_image),
    provider_currency: 'USD',
    price_source_url: selectedPrice.source_url,
    price_effective_from: selectedPrice.effective_from,
    baseline_estimate: Number(baselinePrice.cost_per_image),
    optimized_estimate: Number(selectedPrice.cost_per_image),
    savings_estimate: Number(baselinePrice.cost_per_image) - Number(selectedPrice.cost_per_image),
    savings_percentage: Number(baselinePrice.cost_per_image) > 0
      ? (Number(baselinePrice.cost_per_image) - Number(selectedPrice.cost_per_image)) / Number(baselinePrice.cost_per_image) * 100
      : null,
    estimate_currency: 'USD',
    calculation_method: 'Studio Pro published USD price minus selected-tier published USD price. Prices are estimates and exclude other service costs.',
    method: `${selectedPrice.provider}/${selectedPrice.model}`,
    image_size: selectedPrice.image_size,
    image_file_size_bytes: imageBytes.byteLength,
    message: 'Image created. File checks passed; review the image content before using it in class.',
  })
})
