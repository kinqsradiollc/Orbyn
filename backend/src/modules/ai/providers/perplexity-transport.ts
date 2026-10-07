/** Reviewed native resources; custom and Router paths retain their saved compatible protocol. */
export function perplexityNativeBase(ai: {
  kind?: string;
  format: string;
  baseUrl: string;
}): string | null {
  if (ai.kind !== "perplexity" || ai.format !== "openai") return null;
  try {
    const url = new URL(ai.baseUrl);
    if (
      url.origin !== "https://api.perplexity.ai" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !["", "/", "/v1", "/v1/"].includes(url.pathname)
    )
      return null;
    return `${url.origin}/v1`;
  } catch {
    return null;
  }
}

/** Retain existing Sonar choices; Agent API catalog models use its Responses contract. */
export function usesPerplexityResponses(ai: {
  kind?: string;
  format: string;
  baseUrl: string;
  model: string;
}): boolean {
  return (
    perplexityNativeBase(ai) !== null &&
    !!ai.model &&
    !/^(sonar(?:-|$)|r1-1776$)/.test(ai.model)
  );
}
