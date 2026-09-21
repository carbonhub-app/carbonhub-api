import type { Context } from "elysia";

/** The response envelope every endpoint in this service returns. */
export interface Envelope<T = unknown> {
  status: "success" | "error";
  message: string;
  data: T;
}

/** The mutable part of Elysia's context this service writes to. */
export type SetContext = Context["set"];

/**
 * Request bodies are intentionally left untyped at the framework boundary.
 * Attaching a schema would make Elysia reject malformed input with its own
 * validation error, whereas every endpoint here answers with a specific
 * "Parameter ... required" message that clients already depend on.
 */
export function asBody<T>(body: unknown): T {
  return (body ?? {}) as T;
}

/**
 * The service's uniform failure response. Internal messages are only exposed
 * when DEBUG is set, matching the behaviour every handler relied on.
 */
export function badRequest(set: SetContext, err: unknown): Envelope<Record<string, never>> {
  set.status = 400;
  return {
    status: "error",
    message: process.env.DEBUG ? (err as Error)?.message : "Bad Request",
    data: {},
  };
}
