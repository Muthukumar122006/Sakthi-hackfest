import { createClient } from 'npm:@supabase/supabase-js@2'

const appOrigin = Deno.env.get('APP_ORIGIN')?.trim() || 'http://127.0.0.1:5173'
const parsedAppOrigin = new URL(appOrigin)
const isLocalAppOrigin = parsedAppOrigin.protocol === 'http:'
  && ['localhost', '127.0.0.1'].includes(parsedAppOrigin.hostname)
if (parsedAppOrigin.origin !== appOrigin || (parsedAppOrigin.protocol !== 'https:' && !isLocalAppOrigin)) {
  throw new Error('APP_ORIGIN must be an HTTPS origin, except for localhost development.')
}

const localAppOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173']
const allowedAppOrigins = new Set([appOrigin, ...localAppOrigins])
const maximumRequestBytes = 16_384
const tiers = new Set(['draft-rapid', 'precision-lite', 'studio-pro'])
const categories = new Set([
  'fun', 'motivational', 'bold', 'educational', 'minimal',
  'inspirational', 'cute', 'professional', 'creative', 'custom',
])
const intents = new Set([
  'colouring_worksheet', 'flashcard', 'textbook_illustration',
  'science_diagram', 'educational_poster', 'general_illustration',
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

type Tier = 'draft-rapid' | 'precision-lite' | 'studio-pro'
type Price = {
  provider: string
  quality_tier: Tier
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

function corsHeadersFor(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function jsonResponse(status: number, body: Record<string, unknown>, origin: string) {
  const errorMessage = typeof body.error === 'string' ? body.error : null
  const payload = errorMessage
    ? {
      success: false,
      error: {
        code: status === 401 ? 'AUTHENTICATION_REQUIRED'
          : status === 403 ? 'FORBIDDEN'
          : status === 400 ? 'VALIDATION_ERROR'
          : status === 429 ? 'RATE_LIMITED'
          : status >= 500 ? 'SERVICE_ERROR'
          : 'REQUEST_ERROR',
        message: errorMessage,
      },
    }
    : { success: true, ...body }
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeadersFor(origin), 'Content-Type': 'application/json' },
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readRequestBody(request: Request): Promise<unknown | null> {
  const contentLength = request.headers.get('Content-Length')
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maximumRequestBytes)) return null
  if (!request.body) return null

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

function recommendTier(
  input: Record<string, unknown>,
  prices: Map<Tier, Price>,
  budgetUsdMicros: number | null,
): { tier: Tier; reason: string } | null {
  const ageRange = typeof input.target_audience === 'string'
    ? input.target_audience.match(/^Custom ages (\d{1,3})-(\d{1,3})$/)
    : null
  const validAudience = typeof input.target_audience === 'string'
    && (audiences.has(input.target_audience)
      || Boolean(ageRange && Number(ageRange[1]) <= Number(ageRange[2]) && Number(ageRange[2]) <= 120))
  if (typeof input.prompt !== 'string' || input.prompt.trim().length < 1 || input.prompt.length > 4000
    || typeof input.category !== 'string' || !categories.has(input.category)
    || typeof input.intent !== 'string' || !intents.has(input.intent)
    || typeof input.target_audience !== 'string' || !validAudience || input.target_audience.length > 80
    || (input.selected_quality_tier !== undefined
      && (typeof input.selected_quality_tier !== 'string' || !tiers.has(input.selected_quality_tier)))) {
    return null
  }

  const prompt = input.prompt.toLowerCase()
  const detailed = /highly detailed|fine detail|intricate|photoreal|realistic texture|many small/.test(prompt)
  const simple = /colouring|coloring|outline|simple icon|few shapes|draft|rough concept/.test(prompt)
  const needsDetail = detailed
    || input.intent === 'science_diagram'
    || input.intent === 'educational_poster'
    || input.category === 'professional'
    || input.category === 'bold'

  let recommendation: { tier: Tier; reason: string }
  if (simple && input.target_audience.startsWith('Early childhood')) {
    recommendation = { tier: 'draft-rapid', reason: 'A simple image is usually enough for young children.' }
  } else if (needsDetail) {
    recommendation = { tier: 'studio-pro', reason: 'This request may benefit from more detail or a clear layout.' }
  } else if (simple || ['minimal', 'cute', 'fun'].includes(input.category)) {
    recommendation = { tier: 'draft-rapid', reason: 'This style can work well with the lower-cost option.' }
  } else {
    recommendation = { tier: 'precision-lite', reason: 'Balanced is a good starting choice for this image.' }
  }

  if (budgetUsdMicros !== null) {
    const recommendedPrice = prices.get(recommendation.tier)
    if (!recommendedPrice || Math.round(recommendedPrice.cost_per_image * 1_000_000) > budgetUsdMicros) {
      const affordableOptions = [...prices.values()]
        .filter((price) => Math.round(price.cost_per_image * 1_000_000) <= budgetUsdMicros)
        .sort((left, right) => left.cost_per_image - right.cost_per_image)
      const affordable = affordableOptions[0]
      if (affordable && affordable.quality_tier !== recommendation.tier) {
        recommendation = {
          tier: affordable.quality_tier,
          reason: `This is the lowest-priced configured option within your budget. ${recommendation.reason}`,
        }
      }
    }
  }
  return recommendation
}

Deno.serve(async (request) => {
  const requestOrigin = request.headers.get('Origin')
  const responseOrigin = requestOrigin && allowedAppOrigins.has(requestOrigin) ? requestOrigin : appOrigin
  const json = (status: number, body: Record<string, unknown>) => jsonResponse(status, body, responseOrigin)
  if (requestOrigin && !allowedAppOrigins.has(requestOrigin)) {
    return json(403, { error: 'Origin not allowed.' })
  }
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeadersFor(responseOrigin) })
  if (request.method !== 'POST') return json(405, { error: 'Use POST for this service.' })

  const body = await readRequestBody(request)
  if (!isRecord(body)) return json(400, { error: 'The request body must be valid JSON and under 16 KiB.' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !anonKey) return json(503, { error: 'The Supabase service is not configured.' })

  if (body.action === 'health') {
    return json(200, {
      service: 'edugen-planner',
      status: 'available',
      checked_at: new Date().toISOString(),
      provider_status: 'not_checked',
    })
  }

  const authorization = request.headers.get('Authorization')
  if (!authorization) return json(401, { error: 'Sign in to use planner services.' })
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: authData, error: authError } = await userClient.auth.getUser()
  if (authError || !authData.user) return json(401, { error: 'Your session is no longer valid. Sign in again.' })

  const provider = Deno.env.get('IMAGE_PROVIDER')?.trim() || 'openai'
  if (provider !== 'openai') {
    return json(503, { error: `The configured image provider "${provider}" is not supported by this service.` })
  }

  if (body.action !== 'prices' && body.action !== 'recommendation') {
    return json(400, { error: 'Choose a supported planner service.' })
  }
  if (body.action === 'recommendation'
    && body.target_budget !== undefined && body.target_budget !== null
    && (typeof body.target_budget !== 'number' || !Number.isFinite(body.target_budget) || body.target_budget < 0)) {
    return json(400, { error: 'Enter a valid maximum budget.' })
  }
  if (body.action === 'recommendation'
    && body.budget_currency !== undefined
    && (typeof body.budget_currency !== 'string' || !/^[A-Z]{3}$/.test(body.budget_currency))) {
    return json(400, { error: 'Choose a valid budget currency.' })
  }

  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await userClient.from('provider_pricing')
    .select('provider,quality_tier,model,image_size,cost_per_image,currency,source_url,effective_from')
    .eq('provider', provider)
    .eq('currency', 'USD')
    .eq('active', true)
    .lte('effective_from', today)
    .order('effective_from', { ascending: false })
  if (error) {
    console.error('Could not read active provider pricing.', authData.user.id, error)
    return json(503, { error: 'Could not load current provider settings. Try again shortly.' })
  }

  const currentPrices = new Map<Tier, Price>()
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const priceValue = Number(row.cost_per_image)
    if (row.provider !== provider
      || typeof row.quality_tier !== 'string' || !tiers.has(row.quality_tier)
      || typeof row.model !== 'string' || !row.model.trim()
      || typeof row.image_size !== 'string' || !row.image_size.trim()
      || row.currency !== 'USD'
      || !Number.isFinite(priceValue) || priceValue < 0
      || typeof row.source_url !== 'string' || !row.source_url.startsWith('https://')
      || typeof row.effective_from !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.effective_from)) {
      console.error('The active provider price configuration contains invalid data.', authData.user.id)
      return json(503, { error: 'The provider price configuration is invalid. Ask an admin to review it.' })
    }
    const price: Price = {
      provider: row.provider,
      quality_tier: row.quality_tier as Tier,
      model: row.model,
      image_size: row.image_size,
      cost_per_image: priceValue,
      currency: 'USD',
      pricing_unit: 'per_image',
      active: true,
      applicable: true,
      source_url: row.source_url,
      effective_from: row.effective_from,
    }
    if (!currentPrices.has(price.quality_tier)) currentPrices.set(price.quality_tier, price)
  }
  const prices = [...currentPrices.values()]

  if (body.action === 'prices') {
    return json(200, {
      prices,
      available_tiers: prices.map((price) => price.quality_tier),
      supported_sizes: [...new Set(prices.map((price) => price.image_size))],
      currency: 'USD',
      pricing_unit: 'per_image',
      active: true,
      applicable: true,
      pricing_basis: 'per image; estimates only, not actual charges',
      unavailable_reason: prices.length === 0 ? 'No current, source-linked provider prices are configured.' : null,
    })
  }

  let budgetUsdMicros: number | null = null
  if (body.target_budget !== undefined && body.target_budget !== null) {
    const budgetCurrency = (body.budget_currency as string | undefined) ?? 'USD'
    if (budgetCurrency === 'USD') {
      budgetUsdMicros = Math.floor((body.target_budget as number) * 1_000_000)
    } else {
      let exchangeResponse: Response
      try {
        exchangeResponse = await fetch(
          `https://api.frankfurter.dev/v1/latest?base=USD&symbols=${budgetCurrency}`,
          { signal: AbortSignal.timeout(8000) },
        )
      } catch (exchangeError) {
        console.error('Could not check the recommendation budget exchange rate.', authData.user.id, exchangeError)
        return json(503, { error: 'The budget exchange rate is unavailable. Try again later.' })
      }
      if (!exchangeResponse.ok) return json(503, { error: 'The budget exchange rate is unavailable. Try again later.' })
      let exchangeData: { rates?: Record<string, number> }
      try {
        exchangeData = await exchangeResponse.json() as { rates?: Record<string, number> }
      } catch (exchangeError) {
        console.error('The budget exchange service returned invalid data.', authData.user.id, exchangeError)
        return json(503, { error: 'The budget exchange rate is unavailable. Try again later.' })
      }
      const rate = exchangeData.rates?.[budgetCurrency]
      if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
        return json(503, { error: 'The budget exchange rate is unavailable. Try again later.' })
      }
      budgetUsdMicros = Math.floor(((body.target_budget as number) / rate) * 1_000_000)
    }
  }

  const recommendation = recommendTier(body, currentPrices, budgetUsdMicros)
  if (!recommendation) return json(400, { error: 'Check the image description, category, purpose, audience, and selected quality.' })

  const recommendedPrice = currentPrices.get(recommendation.tier)
  const baselinePrice = currentPrices.get('studio-pro')
  const selectedTier = body.selected_quality_tier as Tier | undefined
  return json(200, {
    recommendation: {
      tier: recommendation.tier,
      reason: recommendation.reason,
      provider,
      model: recommendedPrice?.model ?? null,
      estimated_cost: recommendedPrice?.cost_per_image ?? null,
      currency: recommendedPrice?.currency ?? null,
      pricing_unit: 'per_image',
      price_source_url: recommendedPrice?.source_url ?? null,
      price_effective_from: recommendedPrice?.effective_from ?? null,
      requested_image_size: recommendedPrice?.image_size ?? null,
      pricing_status: recommendedPrice ? 'available' : 'unavailable',
      limitations: recommendedPrice
        ? budgetUsdMicros !== null && Math.round(recommendedPrice.cost_per_image * 1_000_000) > budgetUsdMicros
          ? ['No configured quality tier is within the entered budget.']
          : []
        : ['No current source-linked price is configured for this quality.'],
    },
    selected_quality_tier: selectedTier ?? null,
    selected_quality_remains_authoritative: true,
    high_quality_baseline: baselinePrice
      ? { estimated_cost: baselinePrice.cost_per_image, currency: baselinePrice.currency }
      : null,
  })
})
