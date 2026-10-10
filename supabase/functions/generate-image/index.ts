import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

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
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sha256(bytes: Uint8Array) {
  return crypto.subtle.digest('SHA-256', bytes).then((hash) =>
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

async function getUsdRate(currency: string) {
  if (currency === 'USD') return { rate: 1, date: null as string | null }
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Choose a valid currency code.')
  const response = await fetch(`https://api.frankfurter.dev/v1/latest?base=USD&symbols=${currency}`, {
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`Could not get the USD to ${currency} exchange rate.`)
  const result = await response.json() as { date?: string; rates?: Record<string, number> }
  const rate = result.rates?.[currency]
  if (!result.date || typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    throw new Error(`No USD to ${currency} exchange rate is available.`)
  }
  return { rate, date: result.date }
}

function hasValidPng(bytes: Uint8Array) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (bytes.length < 33 || !signature.every((value, index) => bytes[index] === value)) return false
  const width = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16)
  const height = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(20)
  return width >= 512 && height >= 512
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

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json(400, { error: 'The request body must be valid JSON.' })
  }
  const input = validateRequest(body)
  if (!input) return json(400, { error: 'Check the image description, class, language, style, purpose and budget fields.' })

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
    .select('id,state,output_asset_id,reused_asset_id,method,baseline_estimate,optimized_estimate,savings_estimate,savings_percentage,estimate_currency,calculation_method,pricing_source_url,pricing_effective_from,cost_source')
    .eq('user_id', authData.user.id)
    .eq('idempotency_key', input.idempotency_key)
    .maybeSingle()
  if (priorRequestError) return json(500, { error: 'Could not check for a duplicate image request.' })
  if (priorRequest) {
    if (priorRequest.state === 'queued') return json(409, { error: 'This image request is already being processed.' })
    if (priorRequest.state !== 'generated' && priorRequest.state !== 'reused') {
      return json(409, { error: 'This request already failed. Start a new request to try again.' })
    }
    const assetId = priorRequest.output_asset_id ?? priorRequest.reused_asset_id
    if (!assetId) return json(500, { error: 'The previous request has no saved image. An administrator must review it.' })
    const { data: priorAsset, error: priorAssetError } = await service.from('educational_assets')
      .select('storage_path,kind')
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

  const { data: withinLimit, error: limitError } = await service.rpc('consume_generation_rate_limit', {
    target_user_id: authData.user.id,
  })
  if (limitError) return json(503, { error: 'Could not check the image request limit. Please try again shortly.' })
  if (withinLimit !== true) return json(429, { error: 'You have reached the image request limit of 10 per hour. Try again later.' })

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

  const fingerprint = await requestFingerprint(input)
  let assetQuery = service.from('educational_assets')
    .select('id,title,storage_path,school_id,kind')
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
    const { data: savedRequest, error: saveError } = await service.from('image_requests')
      .insert({
        user_id: authData.user.id,
        idempotency_key: input.idempotency_key,
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
        method: 'Exact approved library match',
        reused_asset_id: cachedAsset.id,
        provider_currency: 'USD',
        baseline_estimate: baselinePrice ? Number(baselinePrice.cost_per_image) : null,
        optimized_estimate: 0,
        savings_estimate: baselinePrice ? Number(baselinePrice.cost_per_image) : null,
        savings_percentage: baselinePrice && Number(baselinePrice.cost_per_image) > 0 ? 100 : null,
        calculation_method: 'Studio Pro published USD estimate minus avoided image-generation API call; other hosting or service costs are not included.',
        pricing_effective_from: today,
        pricing_source_url: baselinePrice?.source_url ?? null,
        estimate_currency: 'USD',
        exchange_rate: input.display_currency === 'USD' ? 1 : null,
        cost_source: 'estimated',
      })
      .select('id,state,reused_asset_id')
      .single()
    if (saveError) return json(500, { error: 'The request matched an image, but the reuse record could not be saved.' })
    return json(200, {
      request: savedRequest,
      kind: cachedAsset.kind,
      request_id: savedRequest.id,
      asset_id: cachedAsset.id,
      image_url: signedFile.signedUrl,
      state: 'reused',
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
  if (!selectedPrice.source_url.startsWith('https://')) return json(503, { error: 'The provider price must include a source link.' })

  if (!baselinePrice) return json(503, { error: 'Add a current Studio Pro baseline price before generation so savings can be compared fairly.' })

  let budgetRate = 1
  let budgetRateDate: string | null = null
  let targetBudgetRate = 1
  let targetBudgetRateDate: string | null = null
  let displayRate = 1
  let displayRateDate: string | null = null
  let budgetCurrency = school?.budget_currency ?? 'USD'
  try {
    const displayExchange = await getUsdRate(input.display_currency)
    displayRate = displayExchange.rate
    displayRateDate = displayExchange.date
    if (school) {
      const budgetExchange = await getUsdRate(budgetCurrency)
      budgetRate = budgetExchange.rate
      budgetRateDate = budgetExchange.date
    }
    if (input.target_budget !== undefined && input.target_budget !== null) {
      const requestBudgetCurrency = input.target_budget_currency ?? 'USD'
      const targetExchange = await getUsdRate(requestBudgetCurrency)
      targetBudgetRate = targetExchange.rate
      targetBudgetRateDate = targetExchange.date
      if (Number(selectedPrice.cost_per_image) * targetBudgetRate > input.target_budget) {
        return json(409, { error: 'This option costs more than your maximum budget. Choose a lower-cost quality level.' })
      }
    }
  } catch (budgetError) {
    return json(503, { error: budgetError instanceof Error ? budgetError.message : 'Could not check the budget safely.' })
  }

  const { data: queuedRequest, error: insertError } = await service.from('image_requests')
    .insert({
      user_id: authData.user.id,
      school_id: schoolId,
      prompt: input.prompt,
      subject: '',
      grade: '',
      category: input.category,
      target_audience: input.target_audience,
      intent: input.intent,
      quality_tier: input.quality_tier,
      language: input.language,
      style: input.style,
      target_budget: input.target_budget ?? null,
      target_budget_currency: input.target_budget_currency ?? null,
      target_budget_exchange_rate: input.target_budget !== undefined && input.target_budget !== null ? targetBudgetRate : null,
      target_budget_exchange_rate_date: input.target_budget !== undefined && input.target_budget !== null ? targetBudgetRateDate : null,
      idempotency_key: input.idempotency_key,
      display_currency: input.display_currency,
      exchange_rate: displayRate,
      exchange_rate_date: displayRateDate,
      school_budget_exchange_rate: school ? budgetRate : null,
      school_budget_exchange_rate_date: school ? budgetRateDate : null,
      state: 'queued',
      method: `${selectedPrice.provider}/${selectedPrice.model}`,
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
      estimate_currency: 'USD',
      cost_source: 'estimated',
    })
    .select('id')
    .single()
  if (insertError) return json(500, { error: 'Could not save the image request.' })

  let reservationId: string | null = null
  if (school) {
    const { data: reservedId, error: reservationError } = await service.rpc('reserve_school_budget', {
      target_school_id: school.id,
      target_request_id: queuedRequest.id,
      estimated_amount: Number(selectedPrice.cost_per_image) * budgetRate,
      target_currency: budgetCurrency,
    })
    if (reservationError) {
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
      return json(500, { error: `Could not reserve the school budget: ${reservationError.message}` })
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

  const releaseBudget = async () => {
    if (!reservationId) return null
    try {
      const { error } = await service.rpc('release_school_budget_reservation', { target_reservation_id: reservationId })
      if (error) {
        console.error('Could not release a school budget reservation.', reservationId, error)
        return error
      }
    } catch (error) {
      console.error('Could not reach the budget reservation service.', reservationId, error)
      return error
    }
    return null
  }
  const failRequest = async (
    status: number,
    message: string,
    extra: { quality_state?: 'failed'; quality_note?: string } = {},
  ) => {
    const releaseError = await releaseBudget()
    let updateError: unknown = null
    try {
      const { error } = await service.from('image_requests')
        .update({ state: 'failed', ...extra })
        .eq('id', queuedRequest.id)
      updateError = error
    } catch (error) {
      updateError = error
    }
    if (updateError) console.error('Could not mark a failed image request.', queuedRequest.id, updateError)
    const cleanupFailed = Boolean(releaseError || updateError)
    return json(status, {
      error: cleanupFailed
        ? `${message} The request cleanup failed and needs administrator attention.`
        : message,
    })
  }
  const fullPrompt = [
    `Make an image for the ${input.category} category${input.custom_category ? ` (${input.custom_category})` : ''}.`,
    `Target audience: ${input.target_audience}. Adjust visual complexity, tone, detail and accessibility for this audience.`,
    `Purpose: ${input.intent.replace(/_/g, ' ')}.`,
    `Language: ${input.language}.`,
    `Style: ${input.style}.`,
    input.prompt,
  ].join('\n')
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
  } catch {
    return failRequest(502, 'The image provider could not be reached. Your request was marked as failed.')
  }

  if (!providerResponse.ok) {
    return failRequest(502, `The image provider returned an error (${providerResponse.status}).`)
  }

  let providerResult: { data?: { b64_json?: string }[] }
  try {
    providerResult = await providerResponse.json() as { data?: { b64_json?: string }[] }
  } catch {
    return failRequest(502, 'The image provider returned an invalid response. Your request was marked as failed.')
  }
  const encodedImage = providerResult.data?.[0]?.b64_json
  if (!encodedImage) {
    return failRequest(502, 'The image provider returned no image. The request was marked as failed.')
  }
  let imageBytes: Uint8Array
  try {
    imageBytes = Uint8Array.from(atob(encodedImage), (character) => character.charCodeAt(0))
  } catch {
    return failRequest(502, 'The image provider returned invalid image data. Your request was marked as failed.')
  }
  if (!hasValidPng(imageBytes)) {
    return failRequest(502, 'The returned image did not pass the basic file and size check.', {
      quality_state: 'failed',
      quality_note: 'The output was empty, too small, or not a valid PNG image.',
    })
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
    return failRequest(500, 'The image was created but could not be saved securely.')
  }

  const { data: asset, error: assetError } = await service.from('educational_assets')
    .insert({
      school_id: schoolId,
      title: input.prompt.slice(0, 200),
      description: fullPrompt,
      subject: '',
      category: input.category,
      target_audience: input.target_audience,
      intent: input.intent,
      quality_tier: input.quality_tier,
      grade: '',
      language: input.language,
      tags: [],
      kind: 'generated',
      review_state: schoolId ? 'pending' : 'approved',
      visibility: schoolId ? 'school' : 'private',
      storage_path: storagePath,
      source_prompt_hash: fingerprint,
      content_hash: await sha256(imageBytes),
      licence: 'Generated for this account. Review applicable provider terms before sharing.',
      created_by: authData.user.id,
    })
    .select('id')
    .single()
  if (assetError) {
    const { error: removeError } = await service.storage.from('educational-images').remove([storagePath])
    if (removeError) console.error('Could not remove an unindexed image file.', storagePath, removeError)
    const failure = await failRequest(500, 'The image could not be added to your account library.')
    if (removeError) return json(500, { error: 'The image could not be added to your account library, and its temporary file needs administrator cleanup.' })
    return failure
  }

  const { error: updateError } = await service.from('image_requests').update({
    state: 'generated',
    output_asset_id: asset.id,
    quality_state: 'not_checked',
    quality_note: 'File format and image size were checked. A teacher must review the image content.',
  }).eq('id', queuedRequest.id)
  if (updateError) {
    console.error('The image was saved but its request record could not be updated.', queuedRequest.id, updateError)
    if (reservationId) {
      const { error: settleError } = await service.rpc('settle_school_budget_reservation', {
        target_reservation_id: reservationId,
      })
      if (settleError) console.error('Could not settle the school budget after saving the image.', reservationId, settleError)
    }
    return json(500, { error: 'The image was saved, but its request record could not be updated. An administrator may need to check the request and budget.' })
  }

  if (reservationId) {
    const { error: settleError } = await service.rpc('settle_school_budget_reservation', {
      target_reservation_id: reservationId,
    })
    if (settleError) return json(500, { error: 'The image is ready, but its estimated school usage could not be recorded.' })
  }

  const { data: signedFile, error: signedFileError } = await service.storage
    .from('educational-images')
    .createSignedUrl(storagePath, 300)
  if (signedFileError) return json(500, { error: 'The image was saved, but a preview link could not be created.' })
  return json(200, {
    request_id: queuedRequest.id,
    image_url: signedFile.signedUrl,
    asset_id: asset.id,
    state: 'generated',
    quality_state: 'not_checked',
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
    message: 'Image created. File checks passed; review the image content before using it in class.',
  })
})
