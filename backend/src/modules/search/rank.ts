/**
 * The one ranking formula for search: how well the words match (the
 * query's tsquery as `q.tsq`), lifted for a thing touched recently, plus a
 * little for a title that merely looks like what was typed (`query`, the
 * placeholder holding the words). The search service and agents' search
 * both rank with it. No imports, so the mcp service can load it without
 * anything else from search.
 */
export const searchRank = (
  vector: string,
  title: string,
  updated: string,
  query: string,
) => `
  ts_rank_cd(${vector}, q.tsq)
    * (1 + 0.5 * exp(-(extract(epoch FROM now() - ${updated}) / 2592000)))
  + greatest(similarity(${title}, ${query}) - 0.2, 0) * 0.5`;
