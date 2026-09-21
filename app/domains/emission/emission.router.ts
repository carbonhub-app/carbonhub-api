import { Elysia } from "elysia";

import {
  collect,
  report,
  companies,
  annual,
  monthly,
  daily,
  quota,
  withdraw,
} from "./emission.controller";
import { jwtGuard } from "../../middlewares/auth/jwt/jwt.verify";

const protectedRoutes = new Elysia()
  .use(jwtGuard)
  .get("/quota", quota)
  .post("/withdraw", withdraw);

export const emissionRouter = new Elysia({ prefix: "/emission" })
  .post("/collect", collect)
  .post("/report", report)
  .get("/companies", companies)
  .get("/annual/:id", annual)
  .get("/monthly/:id", monthly)
  .get("/daily/:id", daily)
  .use(protectedRoutes);
