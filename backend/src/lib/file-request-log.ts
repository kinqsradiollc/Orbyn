/** Preserve normal request fields while keeping signed file capabilities out of logs. */
export function serializeFileRequest(request: {
  method?: string;
  url?: string;
  headers?: Record<string, unknown>;
  host?: string;
  ip?: string;
  socket?: { remotePort?: number };
}) {
  const version = request.headers?.["accept-version"];
  return {
    method: request.method,
    url: request.url?.replace(
      /^\/files\/([upr])(?:\/|%2f).*$/i,
      "/files/$1/:token",
    ),
    version: typeof version === "string" ? version : undefined,
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket?.remotePort,
  };
}
