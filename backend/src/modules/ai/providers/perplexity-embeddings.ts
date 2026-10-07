import { EmbeddingResponseError } from "./embedding-vectors.js";

/** Native embedding resources differ from Perplexity's legacy generation base. */
export function perplexityEmbeddingEndpoint(connection: {
  kind?: string;
  format: string;
  baseUrl: string;
}): string | null {
  if (connection.kind !== "perplexity" || connection.format !== "openai")
    return null;
  try {
    const url = new URL(connection.baseUrl);
    if (
      url.origin !== "https://api.perplexity.ai" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !["", "/", "/v1", "/v1/"].includes(url.pathname)
    )
      return null;
    return `${url.origin}/v1/embeddings`;
  } catch {
    return null;
  }
}

/** Full widths for reviewed native models; Orbyn does not request Matryoshka reduction. */
export function perplexityEmbeddingDimensions(model: string): number | null {
  if (model === "pplx-embed-v1-0.6b") return 1024;
  if (model === "pplx-embed-v1-4b") return 2560;
  return null;
}

/** Decode only the explicitly requested signed-int8 encoding, then use common vector checks. */
export function decodePerplexityEmbeddings(
  body: unknown,
  dimensions: number,
): unknown {
  if (
    !body ||
    typeof body !== "object" ||
    !("data" in body) ||
    !Array.isArray(body.data)
  )
    return body;
  return {
    ...body,
    data: body.data.map((row: unknown) => {
      const invalid = () =>
        new EmbeddingResponseError(
          "embedding_vector",
          "The provider returned an invalid embedding.",
        );
      if (!row || typeof row !== "object" || !("embedding" in row))
        throw invalid();
      const encoded = row.embedding;
      if (
        typeof encoded !== "string" ||
        encoded.length !== Math.ceil(dimensions / 3) * 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          encoded,
        )
      )
        throw invalid();
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.length !== dimensions || bytes.toString("base64") !== encoded)
        throw invalid();
      return {
        ...row,
        embedding: Array.from(bytes, (byte) =>
          byte > 127 ? byte - 256 : byte,
        ),
      };
    }),
  };
}
