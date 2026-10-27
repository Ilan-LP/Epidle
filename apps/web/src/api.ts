import { createApi } from "@epidle/api-client";
import { version } from "../package.json";

/** Same origin: Vite proxies /api in dev, and the session is an httpOnly cookie. */
export const api = createApi({ client: { kind: "web", version } });
