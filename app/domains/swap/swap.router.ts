import { Elysia } from "elysia";

import { create, execute, balance, price } from "./swap.controller";
import { jwtGuard } from "../../middlewares/auth/jwt/jwt.verify";

/** Every swap route is authenticated. */
export const swapRouter = new Elysia({ prefix: "/swap" })
  .use(jwtGuard)
  .post("/create", create)
  .post("/execute", execute)
  .get("/balance", balance)
  .get("/price", price);
