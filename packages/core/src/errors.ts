/** Error carrying an HTTP status. Thrown by the backend and by the API client. */
export class HttpError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
  /** Alias kept for client code that reads `error.status`. */
  get status() {
    return this.statusCode;
  }
}

/** Throw an HttpError. Typed as `never` so it can be used in expression position. */
export function fail(statusCode: number, message: string): never {
  throw new HttpError(statusCode, message);
}
