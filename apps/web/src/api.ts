import { createApi } from "@epidle/api-client";

/** Same origin: Vite proxies /api in dev, and the session is an httpOnly cookie. */
export const api = createApi();
