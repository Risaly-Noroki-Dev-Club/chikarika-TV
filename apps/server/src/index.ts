import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { db } from "./db/index.js";
import { redis } from "./services/redis.js";
import { authRoutes } from "./routes/auth.js";
import { embyRoutes } from "./routes/emby.js";
import { roomRoutes } from "./routes/rooms.js";
import { mediaRoutes } from "./routes/media.js";
import { wsHandler } from "./routes/ws.js";
import { startCleanupTasks } from "./services/cleanup.js";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: process.env.CORS_ORIGIN || "http://localhost:2262",
  credentials: true,
});

await app.register(cookie, {
  secret: process.env.SESSION_SECRET || "dev-secret",
});

await app.register(rateLimit, {
  max: 100,
  timeWindow: "1 minute",
});

await app.register(websocket);

// Routes
await app.register(authRoutes, { prefix: "/api/auth" });
await app.register(embyRoutes, { prefix: "/api/emby" });
await app.register(roomRoutes, { prefix: "/api/rooms" });
await app.register(mediaRoutes, { prefix: "/media" });
await app.register(wsHandler, { prefix: "/ws" });

// Health check
app.get("/api/health", async () => ({ status: "ok" }));

const port = parseInt(process.env.SERVER_PORT || "2261");
const host = process.env.SERVER_HOST || "0.0.0.0";

try {
  await app.listen({ port, host });
  const cleanupTimer = startCleanupTasks();
  console.log(`Server running on ${host}:${port}`);

  app.addHook("onClose", async () => {
    clearInterval(cleanupTimer);
  });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Graceful shutdown
const shutdown = async () => {
  await app.close();
  await redis.quit();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
