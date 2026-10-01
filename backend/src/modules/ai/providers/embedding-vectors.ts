/** pgvector's storage limit, independent of approximate-index limits. */
export const MAX_EMBEDDING_DIMENSIONS = 16000;

/** A bounded diagnostic that never includes provider output or credentials. */
export class EmbeddingResponseError extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = "EmbeddingResponseError";
  }
}

/** Validate and order provider vectors before they can reach persistent storage. */
export function embeddingVectors(
  body: unknown,
  count: number,
  dimensions?: number,
): number[][] {
  if (
    dimensions !== undefined &&
    (!Number.isInteger(dimensions) ||
      dimensions < 1 ||
      dimensions > MAX_EMBEDDING_DIMENSIONS)
  )
    throw new EmbeddingResponseError(
      "embedding_dimensions",
      "The expected embedding dimensions are invalid.",
    );
  const rows =
    body && typeof body === "object" && "data" in body ? body.data : null;
  if (
    !Number.isInteger(count) ||
    count < 0 ||
    !Array.isArray(rows) ||
    rows.length !== count
  )
    throw new EmbeddingResponseError(
      "embedding_count",
      "The provider measured a different number of passages than it was given.",
    );
  const ordered: number[][] = new Array(count);
  const indexed = rows.some(
    (row) => row && typeof row === "object" && "index" in row,
  );
  let width = dimensions;
  for (const [at, row] of rows.entries()) {
    if (!row || typeof row !== "object")
      throw new EmbeddingResponseError(
        "embedding_vector",
        "The provider returned an invalid embedding.",
      );
    const index = indexed ? row.index : at;
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= count ||
      ordered[index]
    )
      throw new EmbeddingResponseError(
        "embedding_index",
        "The provider returned invalid passage indices.",
      );
    const vector: unknown = row.embedding;
    if (
      !Array.isArray(vector) ||
      !vector.length ||
      vector.length > MAX_EMBEDDING_DIMENSIONS ||
      !Array.from(vector).every(
        (value) =>
          typeof value === "number" && Number.isFinite(Math.fround(value)),
      ) ||
      !vector.some((value) => Math.fround(value) !== 0)
    )
      throw new EmbeddingResponseError(
        "embedding_vector",
        "The provider returned an invalid embedding.",
      );
    width ??= vector.length;
    if (vector.length !== width)
      throw new EmbeddingResponseError(
        "embedding_dimensions",
        "The provider returned incompatible embedding dimensions.",
      );
    ordered[index] = vector;
  }
  return ordered;
}
