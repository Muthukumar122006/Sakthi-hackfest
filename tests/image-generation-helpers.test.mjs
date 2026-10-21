import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createRequestFingerprint,
  buildGenerationPrompt,
  hasValidPng,
  isBase64Payload,
  normalizeFingerprintPayload,
  providerOutcomeIsUncertain,
  supportsGptImage2Config,
} from '../supabase/functions/_shared/image-helpers.mjs'

const request = {
  prompt: '  Draw   a plant ',
  category: 'educational',
  custom_category: '',
  target_audience: 'Older children: ages 9–12',
  intent: 'science_diagram',
  language: 'en',
  style: ' Simple   line art ',
  quality_tier: 'precision-lite',
  target_budget: 1.5,
  target_budget_currency: 'USD',
  display_currency: 'USD',
}

test('fingerprint normalization ignores prompt/style whitespace but preserves meaningful casing', async () => {
  const equivalent = {
    ...request,
    prompt: 'Draw a   plant',
    style: 'Simple line   art',
  }
  const one = await createRequestFingerprint(request, null, 'openai/gpt-image-2', '1024x1024')
  const two = await createRequestFingerprint(equivalent, null, 'openai/gpt-image-2', '1024x1024')
  assert.equal(one, two)
  const differentCase = await createRequestFingerprint({ ...request, prompt: 'draw a plant' }, null, 'openai/gpt-image-2', '1024x1024')
  assert.notEqual(one, differentCase)
})

test('fingerprint changes when tenant, model, or dimensions change', () => {
  const original = normalizeFingerprintPayload(request, null, 'openai/gpt-image-2', '1024x1024')
  assert.notEqual(original, normalizeFingerprintPayload(request, 'school-1', 'openai/gpt-image-2', '1024x1024'))
  assert.notEqual(original, normalizeFingerprintPayload(request, null, 'openai/gpt-image-2-snapshot', '1024x1024'))
  assert.notEqual(original, normalizeFingerprintPayload(request, null, 'openai/gpt-image-2', '1024x1536'))
  assert.notEqual(original, normalizeFingerprintPayload({ ...request, target_budget: 2 }, null, 'openai/gpt-image-2', '1024x1024'))
  assert.notEqual(original, normalizeFingerprintPayload({ ...request, display_currency: 'INR' }, null, 'openai/gpt-image-2', '1024x1024'))
})

test('accepts documented GPT Image 2 quality and size values', () => {
  for (const quality of ['low', 'medium', 'high']) {
    assert.equal(supportsGptImage2Config('gpt-image-2', '1024x1024', quality), true)
  }
  assert.equal(supportsGptImage2Config('gpt-image-2', '1024x1536', 'high'), true)
  assert.equal(supportsGptImage2Config('gpt-image-2-2026-04-21', '1024x1024', 'high'), true)
  assert.equal(supportsGptImage2Config('gpt-image-2', '1024x1000', 'high'), false)
  assert.equal(supportsGptImage2Config('other-model', '1024x1024', 'high'), false)
  assert.equal(supportsGptImage2Config('gpt-image-2-2027-01-01', '1024x1024', 'high'), false)
  assert.equal(supportsGptImage2Config('gpt-image-2', '1024x1024', 'xhigh'), false)
})

test('validates base64 structure, size, and PNG dimensions', () => {
  assert.equal(isBase64Payload('iVBORw==', 8), true)
  assert.equal(isBase64Payload('not base64', 100), false)
  assert.equal(isBase64Payload('iVBORw==', 4), false)

  const pngHeader = new Uint8Array(33)
  pngHeader.set([137, 80, 78, 71, 13, 10, 26, 10])
  new DataView(pngHeader.buffer).setUint32(16, 512)
  new DataView(pngHeader.buffer).setUint32(20, 512)
  assert.equal(hasValidPng(pngHeader), true)
  assert.equal(hasValidPng(new Uint8Array(33)), false)
})

test('treats timeouts and provider server errors as uncertain outcomes', () => {
  assert.equal(providerOutcomeIsUncertain(408), true)
  assert.equal(providerOutcomeIsUncertain(500), true)
  assert.equal(providerOutcomeIsUncertain(429), false)
  assert.equal(providerOutcomeIsUncertain(400), false)
})

test('builds the same complete provider prompt used for recovery metadata', () => {
  const prompt = buildGenerationPrompt(request)
  assert.match(prompt, /Make an image for the educational category/)
  assert.match(prompt, /Purpose: science diagram/)
  assert.match(prompt, /Draw   a plant/)
})
