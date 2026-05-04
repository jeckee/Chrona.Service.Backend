const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

export async function callLLM(
  prompt: string,
  options?: {
    model?: string
    responseFormat?: "json" | "text"
  },
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set")
  }

  const body: Record<string, unknown> = {
    model: options?.model ?? "openai/gpt-4o-mini",
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
    choices?: Array<{ message?: { content?: string | null } }>
  }
  const content = data.choices?.[0]?.message?.content
  if (content == null || content === "") {
    throw new Error("Empty response from model")
  }
  return content
}
