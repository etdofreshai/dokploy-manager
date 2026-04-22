import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const port = parseInt(process.env.PORT || "3000", 10);
const app = createApp();

console.log(`Dokploy Manager starting on port ${port}`);
serve({ fetch: app.fetch, port });
