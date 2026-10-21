export function normalizeFingerprintPayload(request, schoolId, providerMethod, imageSize) {
  return JSON.stringify([
    request.prompt.trim().replace(/\s+/g, ' '),
    request.category,
    request.custom_category.trim().replace(/\s+/g, ' '),
    request.target_audience.trim().replace(/\s+/g, ' '),
    request.intent,
    request.language.trim().toLowerCase(),
    request.style.trim().replace(/\s+/g, ' '),
    request.quality_tier,
    schoolId,
    providerMethod,
    imageSize,
    request.target_budget ?? null,
    request.target_budget_currency ?? null,
    request.display_currency,
  ])
}

export function buildGenerationPrompt(request) {
  return [
    `Make an image for the ${request.category} category${request.custom_category ? ` (${request.custom_category})` : ''}.`,
    `Target audience: ${request.target_audience}. Adjust visual complexity, tone, detail and accessibility for this audience.`,
    `Purpose: ${request.intent.replace(/_/g, ' ')}.`,
    `Language: ${request.language}.`,
    `Style: ${request.style}.`,
    request.prompt,
  ].join('\n')
}

export async function createRequestFingerprint(request, schoolId, providerMethod, imageSize) {
  const bytes = new TextEncoder().encode(normalizeFingerprintPayload(request, schoolId, providerMethod, imageSize))
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

export function supportsGptImage2Config(model, size, quality) {
  if (model !== 'gpt-image-2' && model !== 'gpt-image-2-2026-04-21') return false
  if (!['low', 'medium', 'high'].includes(quality)) return false
  const match = /^(\d{2,4})x(\d{2,4})$/.exec(size)
  if (!match) return false
  const width = Number(match[1])
  const height = Number(match[2])
  return width % 16 === 0
    && height % 16 === 0
    && width <= 3840
    && height <= 3840
    && width * height <= 3840 * 2160
    && width / height >= 1 / 3
    && width / height <= 3
}

export function isBase64Payload(value, maximumLength) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximumLength
    && value.length % 4 === 0
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
}

export function hasValidPng(bytes) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (bytes.length < 33 || !signature.every((value, index) => bytes[index] === value)) return false
  const width = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16)
  const height = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(20)
  return width >= 512 && height >= 512
}

export function providerOutcomeIsUncertain(status) {
  return status === 408 || status >= 500
}
