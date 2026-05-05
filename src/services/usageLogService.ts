import { createSupabaseUserClient } from "../lib/supabase.js"

export async function recordAgentUsage(params: {
  userId: string
  accessToken: string
  feature: "schedule" | "summary"
  model?: string | null
  inputChars?: number | null
  outputChars?: number | null
  inputTokens?: number | null
  outputTokens?: number | null
  estimatedCost?: number | null
  success: boolean
  errorCode?: string | null
  errorMessage?: string | null
}): Promise<void> {
  try {
    const client = createSupabaseUserClient(params.accessToken)
    const { error } = await client.from("agent_usage_logs").insert({
      user_id: params.userId,
      feature: params.feature,
      model: params.model ?? null,
      input_chars: params.inputChars ?? null,
      output_chars: params.outputChars ?? null,
      input_tokens: params.inputTokens ?? null,
      output_tokens: params.outputTokens ?? null,
      estimated_cost: params.estimatedCost ?? null,
      success: params.success,
      error_code: params.errorCode ?? null,
      error_message: params.errorMessage ?? null,
    })
    if (error !== null) {
      console.error("[usageLog] insert failed:", error.message)
    }
  } catch (e) {
    console.error(
      "[usageLog] unexpected:",
      e instanceof Error ? e.message : String(e),
    )
  }
}
