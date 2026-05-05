import { createSupabaseUserClient } from "../lib/supabase.js"

export async function ensureUserProfile(params: {
  userId: string
  email: string | null
  accessToken: string
}): Promise<void> {
  const client = createSupabaseUserClient(params.accessToken)

  const payload: { id: string; email?: string } = { id: params.userId }
  if (params.email !== null && params.email !== "") {
    payload.email = params.email
  }

  const { error } = await client
    .from("users")
    .upsert(payload, { onConflict: "id" })

  if (error !== null) {
    throw new Error(`ensureUserProfile failed: ${error.message}`)
  }
}
