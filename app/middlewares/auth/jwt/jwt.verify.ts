import { Elysia } from "elysia";
import { verifyToken } from "../../../utils/auth/jwt/verify";
import type { VerificationResult, VerificationSuccess } from "../../../utils/auth/jwt/verify";
import type { TokenPayload } from "../../../utils/auth/jwt/sign";

/**
 * Bearer token guard. Rejects before the handler runs, so a protected route
 * never has to consider the unauthenticated case.
 */
export const jwtGuard = new Elysia({ name: "jwt-guard" })
  .derive({ as: "scoped" }, ({ headers }) => {
    const token = headers["authorization"]?.split(" ")[1];
    const verification: VerificationResult | null = token ? verifyToken(token) : null;
    return { verification };
  })
  .onBeforeHandle({ as: "scoped" }, ({ verification, set }) => {
    if (!verification) {
      set.status = 401;
      return {
        status: "error",
        message: "Unauthorized: Authentication required",
        data: {},
      };
    }

    if (verification.status === "error") {
      set.status = 401;
      return {
        status: "error",
        message: process.env.DEBUG ? verification.message : "Invalid Authentication",
        data: {},
      };
    }
  });

/** Narrows the guard's result once the guard has already let the request through. */
export function currentUser(verification: VerificationResult | null): TokenPayload {
  return (verification as VerificationSuccess).data;
}
