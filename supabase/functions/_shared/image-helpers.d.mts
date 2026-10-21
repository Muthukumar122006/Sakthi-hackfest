type FingerprintRequest = {
  prompt: string
  category: string
  custom_category: string
  target_audience: string
  intent: string
  language: string
  style: string
  quality_tier: string
  target_budget?: number | null
  target_budget_currency?: string | null
  display_currency: string
}

export function normalizeFingerprintPayload(
  request: FingerprintRequest,
  schoolId: string | null,
  providerMethod: string | null,
  imageSize: string | null,
): string
export function createRequestFingerprint(
  request: FingerprintRequest,
  schoolId: string | null,
  providerMethod: string | null,
  imageSize: string | null,
): Promise<string>
export function buildGenerationPrompt(request: FingerprintRequest): string
export function supportsGptImage2Config(model: string, size: string, quality: string): boolean
export function isBase64Payload(value: unknown, maximumLength: number): value is string
export function hasValidPng(bytes: Uint8Array): boolean
export function providerOutcomeIsUncertain(status: number): boolean
