import { createClient, type SupabaseClient } from "@supabase/supabase-js"

let cached: SupabaseClient | null = null
let cachedServiceRole: SupabaseClient | null = null

function requireEnv(name: string): string {
  const v = process.env[name]
  if (v === undefined || v.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return v
}

export function getSupabase(): SupabaseClient {
  if (cached !== null) return cached
  const url = requireEnv("SUPABASE_URL")
  const key = requireEnv("SUPABASE_ANON_KEY")
  cached = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  return cached
}

/**
 * Service-role client. Bypasses RLS — use ONLY for server-authoritative writes
 * (e.g. entitlement state mutations driven by Apple verification).
 * Never expose this client or its key to the client side.
 */
export function getSupabaseServiceRole(): SupabaseClient {
  if (cachedServiceRole !== null) return cachedServiceRole
  const url = requireEnv("SUPABASE_URL")
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY")
  cachedServiceRole = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  return cachedServiceRole
}

/** Per-request client: anon key + user JWT so Postgres RLS sees auth.uid(). */
export function createSupabaseUserClient(accessToken: string): SupabaseClient {
  const url = requireEnv("SUPABASE_URL")
  const key = requireEnv("SUPABASE_ANON_KEY")
  return createClient(url, key, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}
