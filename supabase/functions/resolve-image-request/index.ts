import { createClient } from 'npm:@supabase/supabase-js@2'
import { hasValidPng } from '../_shared/image-helpers.mjs'

const maximumRequestBytes = 8192
const maximumImageBytes = 10 * 1024 * 1024
const appOrigin = Deno.env.get('APP_ORIGIN')?.trim() || 'http://127.0.0.1:5173'
const headers = {
  'Access-Control-Allow-Origin': appOrigin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Vary': 'Origin',
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readRequest(request: Request): Promise<unknown | null> {
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

async function sha256(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (request) => {
  if (request.headers.get('Origin') && request.headers.get('Origin') !== appOrigin) {
    return json(403, { error: 'Origin not allowed.' })
  }
  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  if (request.method !== 'POST') return json(405, { error: 'Use POST for image-request operations.' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceKey) return json(503, { error: 'The image operations service is not configured.' })

  const authorization = request.headers.get('Authorization')
  if (!authorization) return json(401, { error: 'Sign in with an authorized operator account.' })
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: authData, error: authError } = await userClient.auth.getUser()
  if (authError || !authData.user) return json(401, { error: 'Your session is no longer valid. Sign in again.' })

  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: operator, error: operatorError } = await service.from('image_generation_operators')
    .select('user_id')
    .eq('user_id', authData.user.id)
    .maybeSingle()
  if (operatorError) {
    console.error('Could not verify image-generation operator access.', operatorError)
    return json(503, { error: 'Operator authorization could not be verified.' })
  }
  if (!operator) return json(403, { error: 'Only an authorized image-generation operator can use this service.' })

  const body = await readRequest(request)
  if (!isRecord(body) || typeof body.action !== 'string') {
    return json(400, { error: 'Provide a valid image-operations action.' })
  }

  if (body.action === 'list_uncertain') {
    const { data, error } = await service.from('image_requests')
      .select('id,user_id,school_id,prompt,state,provider_error_code,provider_started_at,created_at')
      .eq('state', 'uncertain')
      .order('provider_started_at', { ascending: true })
      .limit(50)
    if (error) {
      console.error('Could not load uncertain image requests.', error)
      return json(503, { error: 'Uncertain requests could not be loaded.' })
    }
    return json(200, { requests: data ?? [] })
  }

  if (body.action !== 'confirm_no_image' && body.action !== 'recover_stored_image') {
    return json(400, { error: 'Choose a supported image recovery action.' })
  }
  if (typeof body.request_id !== 'string' || !uuidPattern.test(body.request_id)
    || typeof body.note !== 'string' || body.note.trim().length < 1 || body.note.length > 1000) {
    return json(400, { error: 'A valid request ID and audit note are required.' })
  }

  if (body.action === 'confirm_no_image') {
    const { error } = await userClient.rpc('resolve_uncertain_image_request', {
      target_request_id: body.request_id,
      target_resolution: 'confirmed_no_image',
      target_note: body.note.trim(),
    })
    if (error) {
      console.error('Could not resolve an uncertain request as having no image.', body.request_id, error.code)
      return json(409, { error: 'The request could not be resolved. Confirm that it is still uncertain and that no provider image exists.' })
    }
    console.info('Resolved uncertain image request as confirmed-no-image.', body.request_id, authData.user.id)
    return json(200, { request_id: body.request_id, state: 'failed', message: 'The request was resolved as having no generated image; any reserved school budget was released.' })
  }

  const { data: savedRequest, error: requestError } = await service.from('image_requests')
    .select('id,user_id,school_id,prompt,provider_prompt,source_prompt_hash,state,provider_started_at')
    .eq('id', body.request_id)
    .maybeSingle()
  if (requestError || !savedRequest || savedRequest.state !== 'uncertain' || !savedRequest.provider_started_at) {
    if (requestError) console.error('Could not load an uncertain request for image recovery.', body.request_id, requestError)
    return json(409, { error: 'The request is not available for image recovery or is no longer uncertain.' })
  }
  if (!savedRequest.source_prompt_hash) {
    return json(409, { error: 'This request predates recovery metadata. It must remain uncertain until an administrator performs a documented manual reconciliation.' })
  }

  const storagePath = savedRequest.school_id
    ? `schools/${savedRequest.school_id}/${savedRequest.user_id}/${savedRequest.id}.png`
    : `users/${savedRequest.user_id}/${savedRequest.id}.png`
  const { data: storedImage, error: downloadError } = await service.storage
    .from('educational-images')
    .download(storagePath)
  if (downloadError || !storedImage) {
    if (downloadError) console.error('Could not download the known image during recovery.', body.request_id, downloadError)
    return json(409, { error: 'No image was found at the request’s expected private storage path. Keep the request uncertain until its provider outcome is established.' })
  }
  if (storedImage.size <= 0 || storedImage.size > maximumImageBytes) {
    return json(422, { error: 'The stored image exceeds the supported recovery size.' })
  }
  const imageBytes = new Uint8Array(await storedImage.arrayBuffer())
  if (imageBytes.byteLength !== storedImage.size || !hasValidPng(imageBytes)) {
    return json(422, { error: 'The stored object did not pass PNG integrity checks. The request remains uncertain.' })
  }

  const contentHash = await sha256(imageBytes)
  const { data: assetId, error: completionError } = await service.rpc('complete_uncertain_image_generation', {
    target_request_id: savedRequest.id,
    target_resolver_id: authData.user.id,
    target_storage_path: storagePath,
    target_file_size_bytes: imageBytes.byteLength,
    target_content_hash: contentHash,
    target_description: savedRequest.provider_prompt ?? savedRequest.prompt,
    target_resolution_note: body.note.trim(),
  })
  if (completionError || typeof assetId !== 'string') {
    console.error('Could not atomically finalize a recovered image.', body.request_id, completionError?.code)
    return json(409, { error: 'The recovered image could not be finalized. The request remains unchanged; verify its status before retrying this operator action.' })
  }

  const { data: signed, error: signedError } = await service.storage.from('educational-images')
    .createSignedUrl(storagePath, 300)
  if (signedError) console.error('Recovered image was finalized but its preview URL failed.', body.request_id, signedError)
  console.info('Recovered and finalized uncertain image request.', body.request_id, authData.user.id)
  return json(200, {
    request_id: savedRequest.id,
    asset_id: assetId,
    state: 'generated',
    image_url: signed?.signedUrl ?? null,
    message: 'The known stored image was validated and attached without another provider call. Human content review is still required.',
  })
})
