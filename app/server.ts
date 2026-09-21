import path from "node:path";
import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";

import { authRouter } from "./domains/auth/auth.router";
import { emissionRouter } from "./domains/emission/emission.router";
import { swapRouter } from "./domains/swap/swap.router";

/** Origins permitted to call this API with credentials. */
const ALLOWED_ORIGINS = [
  "http://localhost:80",
  "http://localhost:8080",
  "http://localhost:3000",
  "http://localhost:4173",
  "http://localhost:5173",
  "https://carbonhub.faizath.com",
  "https://carbonhub-api.faizath.com",
];

const app = new Elysia()
  .use(
    cors({
      origin: ALLOWED_ORIGINS.map((o) => o.replace(/^https?:\/\//, "")),
      credentials: true,
    }),
  )
  // Unknown routes answer in the same envelope as everything else, rather than
  // in whatever the framework defaults to.
  .onError(({ code, set }) => {
    if (code === "NOT_FOUND") {
      set.status = 404;
      return { status: "error", message: "Not Found", data: {} };
    }
  })
  .get("/", () => Bun.file(path.join(import.meta.dir, "templates/pages/index.html")))
  .use(authRouter)
  .use(emissionRouter)
  .use(swapRouter);

export default app;
export { ALLOWED_ORIGINS };
