import { Elysia } from "elysia";

import { challenge, verify, status } from "./auth.controller";
import { jwtGuard } from "../../middlewares/auth/jwt/jwt.verify";

/** Routes that require a bearer token live in their own instance so the
 *  guard's scoped hooks reach them without touching the public routes. */
const protectedRoutes = new Elysia().use(jwtGuard).get("/status", status);

export const authRouter = new Elysia({ prefix: "/auth" })
  .post("/request-challenge", challenge)
  .post("/verify-signature", verify)
  .use(protectedRoutes);
