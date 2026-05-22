import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../db/index.js";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<AuthUser> {
  const sessionId = request.cookies?.session;

  if (!sessionId) {
    reply.code(401).send({ error: "Unauthorized" });
    throw new Error("Unauthorized");
  }

  const sessions = await db`
    SELECT s.id, s.user_id, s.expires_at, u.email, u.display_name
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ${sessionId} AND s.expires_at > NOW()
  `;

  if (sessions.length === 0) {
    reply.code(401).send({ error: "Session expired" });
    throw new Error("Session expired");
  }

  return {
    id: sessions[0].user_id,
    email: sessions[0].email,
    displayName: sessions[0].display_name,
  };
}
