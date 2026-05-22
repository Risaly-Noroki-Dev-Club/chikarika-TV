import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as argon2 from "argon2";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";

const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(50),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function authRoutes(app: FastifyInstance) {
  // Register
  app.post("/register", async (request, reply) => {
    const body = registerSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Invalid input", details: body.error.flatten() });
    }

    const { email, password, displayName } = body.data;

    // Check existing user
    const existing = await db`SELECT id FROM users WHERE email = ${email}`;
    if (existing.length > 0) {
      return reply.code(409).send({ error: "Email already registered" });
    }

    const passwordHash = await argon2.hash(password);

    const [user] = await db`
      INSERT INTO users (email, password_hash, display_name)
      VALUES (${email}, ${passwordHash}, ${displayName})
      RETURNING id, email, display_name
    `;

    // Create session
    const sessionId = nanoid(32);
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);

    await db`
      INSERT INTO sessions (id, user_id, expires_at)
      VALUES (${sessionId}, ${user.id}, ${expiresAt})
    `;

    reply.setCookie("session", sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_MS / 1000,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
      },
    };
  });

  // Login
  app.post("/login", async (request, reply) => {
    const body = loginSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Invalid input" });
    }

    const { email, password } = body.data;

    const users = await db`
      SELECT id, email, password_hash, display_name
      FROM users WHERE email = ${email}
    `;

    if (users.length === 0) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }

    const user = users[0];
    const valid = await argon2.verify(user.password_hash, password);
    if (!valid) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }

    const sessionId = nanoid(32);
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);

    await db`
      INSERT INTO sessions (id, user_id, expires_at)
      VALUES (${sessionId}, ${user.id}, ${expiresAt})
    `;

    reply.setCookie("session", sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_MS / 1000,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
      },
    };
  });

  // Logout
  app.post("/logout", async (request, reply) => {
    const sessionId = request.cookies?.session;
    if (sessionId) {
      await db`DELETE FROM sessions WHERE id = ${sessionId}`;
    }
    reply.clearCookie("session", { path: "/" });
    return { ok: true };
  });

  // Get current user
  app.get("/me", async (request, reply) => {
    const user = await authenticate(request, reply);
    return { user };
  });
}
