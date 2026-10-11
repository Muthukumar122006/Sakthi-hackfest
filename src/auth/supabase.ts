import { createClient } from '@supabase/supabase-js'

const supabaseUrlValue = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

function validateSupabaseUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'VITE_SUPABASE_URL must be a valid project URL.'
  }

  const isLocalHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !isLocalHttp) {
    return 'VITE_SUPABASE_URL must use HTTPS, except for localhost development.'
  }
  if (url.username || url.password || url.search || url.hash) {
    return 'VITE_SUPABASE_URL must not contain credentials, query parameters, or a fragment.'
  }
  return null
}

export const supabaseConfigurationError = (() => {
  if (!supabaseUrlValue && !supabaseAnonKey) return null
  if (!supabaseUrlValue || !supabaseAnonKey) {
    return 'Set both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable the backend.'
  }
  return validateSupabaseUrl(supabaseUrlValue)
})()

const supabaseUrl = supabaseConfigurationError ? null : supabaseUrlValue

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    })
  : null

export const isSupabaseConfigured = supabase !== null
