/**
 * The HTTP error vocabulary, in its own module.
 *
 * It lives apart from `api.ts` so that modules `api.ts` itself depends on —
 * `scope.ts`, above all — can raise a refusal without importing the layer that
 * imports them. A cycle here would resolve at runtime only by accident of
 * evaluation order, which is not a property to rely on for authorisation code.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (m: string, d?: unknown) => new ApiError(400, m, d);
export const unauthorized = (m = "You must be signed in.") => new ApiError(401, m);
export const forbidden = (m = "You do not have access to this resource.") =>
  new ApiError(403, m);
export const notFound = (m = "Not found.") => new ApiError(404, m);
export const conflict = (m: string, d?: unknown) => new ApiError(409, m, d);
export const tooMany = (m = "Too many requests. Please slow down.") =>
  new ApiError(429, m);
