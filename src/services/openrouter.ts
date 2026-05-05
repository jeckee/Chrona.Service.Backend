const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

export type LLMCallResult = {
  content: string
  model: string
  inputChars: number
  outputChars: number
  inputTokens: number | null
  outputTokens: number | null
  estimatedCost: number | null
}

export async function callLLM(
  prompt: string,
  options?: {
    model?: string
    responseFormat?: "json" | "text"
  },
): Promise<LLMCallResult> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set")
  }

  const resolvedModel = options?.model ?? "openai/gpt-5.4"
  const body: Record<string, unknown> = {
    model: resolvedModel,
    messages: [{ role: "user", content: prompt }],
  }
  if (options?.responseFormat === "json") {
    body.response_format = { type: "json_object" }
  }

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://chrona.cc",
      "X-Title": "Chrona",
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    let detail = ""
    try {
      detail = await res.text()
    } catch {
      /* ignore */
    }
    throw new Error(detail || `OpenRouter HTTP ${res.status}`)
  }

  const data = (await res.json()) as {
    model?: string
    usage?: {
      prompt_tokens?: number
      completion_tokens?: number
      total_tokens?: number
    }
    choices?: Array<{ message?: { content?: string | null } }>
  }
  const content = data.choices?.[0]?.message?.content
  if (content == null || content === "") {
    throw new Error("Empty response from model")
  }

  const usage = data.usage
  const inputTokens = usage?.prompt_tokens ?? null
  const outputTokens = usage?.completion_tokens ?? null

  return {
    content,
    model: data.model ?? resolvedModel,
    inputChars: prompt.length,
    outputChars: content.length,
    inputTokens,
    outputTokens,
    estimatedCost: null,
  }
}
