import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import { redis } from "../services/redis.js";
import { authenticate } from "../middleware/auth.js";
import { decrypt } from "../utils/crypto.js";

const createRoomSchema = z.object({
  embyConnectionId: z.string(),
  embyItemId: z.string(),
  title: z.string().min(1).max(200),
  proxyMaxBitrate: z.number().min(500000).max(6000000).optional(),
});

const bitrateSchema = z.object({
  proxyMaxBitrate: z.number().min(500000).max(6000000),
});

export async function roomRoutes(app: FastifyInstance) {
  // Create room
  app.post("/", async (request, reply) => {
    const user = await authenticate(request, reply);
    const body = createRoomSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Invalid input", details: body.error.flatten() });
    }

    const { embyConnectionId, embyItemId, title, proxyMaxBitrate } = body.data;

    // Check user owns the emby connection
    const connections = await db`
      SELECT id FROM emby_connections
      WHERE id = ${embyConnectionId} AND user_id = ${user.id}
    `;
    if (connections.length === 0) {
      return reply.code(404).send({ error: "Emby connection not found" });
    }

    // Check user doesn't already have an open room
    const openRooms = await db`
      SELECT id FROM rooms WHERE owner_id = ${user.id} AND status = 'open'
    `;
    if (openRooms.length > 0) {
      return reply
        .code(409)
        .send({ error: "You already have an open room. Close it first." });
    }

    const [room] = await db`
      INSERT INTO rooms (owner_id, emby_connection_id, emby_item_id, title, proxy_max_bitrate)
      VALUES (${user.id}, ${embyConnectionId}, ${embyItemId}, ${title}, ${proxyMaxBitrate || 4000000})
      RETURNING *
    `;

    // Add owner as member
    await db`
      INSERT INTO room_members (room_id, user_id, role)
      VALUES (${room.id}, ${user.id}, 'owner')
    `;

    // Init playback state in Redis
    const state = {
      roomId: room.id,
      playing: false,
      positionMs: 0,
      serverTime: Date.now(),
      updatedBy: user.id,
      revision: 0,
    };
    await redis.set(`room:${room.id}:playback`, JSON.stringify(state), "EX", 86400);

    return {
      room: {
        id: room.id,
        ownerId: room.owner_id,
        title: room.title,
        embyItemId: room.emby_item_id,
        streamPolicy: room.stream_policy,
        proxyMaxBitrate: room.proxy_max_bitrate,
        maxMembers: room.max_members,
        status: room.status,
        createdAt: room.created_at,
      },
    };
  });

  // List my rooms
  app.get("/", async (request, reply) => {
    const user = await authenticate(request, reply);

    const rooms = await db`
      SELECT r.*, rm.role
      FROM rooms r
      JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = ${user.id}
      WHERE rm.left_at IS NULL
      ORDER BY r.created_at DESC
    `;

    return {
      rooms: rooms.map((r) => ({
        id: r.id,
        ownerId: r.owner_id,
        title: r.title,
        embyItemId: r.emby_item_id,
        streamPolicy: r.stream_policy,
        proxyMaxBitrate: r.proxy_max_bitrate,
        maxMembers: r.max_members,
        status: r.status,
        role: r.role,
        createdAt: r.created_at,
        closedAt: r.closed_at,
      })),
    };
  });

  // Get room
  app.get("/:roomId", async (request, reply) => {
    const user = await authenticate(request, reply);
    const { roomId } = request.params as { roomId: string };

    const rooms = await db`
      SELECT r.*, rm.role
      FROM rooms r
      LEFT JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = ${user.id} AND rm.left_at IS NULL
      WHERE r.id = ${roomId}
    `;

    if (rooms.length === 0) {
      return reply.code(404).send({ error: "Room not found" });
    }

    const room = rooms[0];

    // Get members
    const members = await db`
      SELECT rm.user_id, rm.role, rm.joined_at, u.display_name, u.avatar_url
      FROM room_members rm
      JOIN users u ON u.id = rm.user_id
      WHERE rm.room_id = ${roomId} AND rm.left_at IS NULL
    `;

    return {
      room: {
        id: room.id,
        ownerId: room.owner_id,
        title: room.title,
        embyItemId: room.emby_item_id,
        embyConnectionId: room.emby_connection_id,
        streamPolicy: room.stream_policy,
        proxyMaxBitrate: room.proxy_max_bitrate,
        maxMembers: room.max_members,
        status: room.status,
        role: room.role,
        createdAt: room.created_at,
        closedAt: room.closed_at,
      },
      members: members.map((m) => ({
        userId: m.user_id,
        displayName: m.display_name,
        avatarUrl: m.avatar_url,
        role: m.role,
        joinedAt: m.joined_at,
      })),
    };
  });

  // Join room
  app.post("/:roomId/join", async (request, reply) => {
    const user = await authenticate(request, reply);
    const { roomId } = request.params as { roomId: string };

    const rooms = await db`SELECT * FROM rooms WHERE id = ${roomId} AND status = 'open'`;
    if (rooms.length === 0) {
      return reply.code(404).send({ error: "Room not found or closed" });
    }

    const room = rooms[0];

    // Check if already a member
    const existingMember = await db`
      SELECT id FROM room_members
      WHERE room_id = ${roomId} AND user_id = ${user.id} AND left_at IS NULL
    `;
    if (existingMember.length > 0) {
      return { ok: true, message: "Already in room" };
    }

    // Check room capacity
    const memberCount = await db`
      SELECT COUNT(*) as count FROM room_members
      WHERE room_id = ${roomId} AND left_at IS NULL
    `;
    if (Number(memberCount[0].count) >= room.max_members) {
      return reply.code(409).send({ error: "Room is full" });
    }

    await db`
      INSERT INTO room_members (room_id, user_id, role)
      VALUES (${roomId}, ${user.id}, 'member')
      ON CONFLICT (room_id, user_id) DO UPDATE SET left_at = NULL, joined_at = NOW()
    `;

    return { ok: true };
  });

  // Leave room
  app.post("/:roomId/leave", async (request, reply) => {
    const user = await authenticate(request, reply);
    const { roomId } = request.params as { roomId: string };

    await db`
      UPDATE room_members SET left_at = NOW()
      WHERE room_id = ${roomId} AND user_id = ${user.id} AND left_at IS NULL
    `;

    return { ok: true };
  });

  // Close room (owner only)
  app.post("/:roomId/close", async (request, reply) => {
    const user = await authenticate(request, reply);
    const { roomId } = request.params as { roomId: string };

    const rooms = await db`
      SELECT id FROM rooms WHERE id = ${roomId} AND owner_id = ${user.id} AND status = 'open'
    `;
    if (rooms.length === 0) {
      return reply.code(404).send({ error: "Room not found or not owner" });
    }

    await db`
      UPDATE rooms SET status = 'closed', closed_at = NOW() WHERE id = ${roomId}
    `;

    // Mark all members as left
    await db`
      UPDATE room_members SET left_at = NOW()
      WHERE room_id = ${roomId} AND left_at IS NULL
    `;

    // Clean up Redis
    await redis.del(`room:${roomId}:playback`);
    await redis.del(`room:${roomId}:presence`);

    return { ok: true };
  });

  // Kick member (owner only)
  app.post("/:roomId/kick", async (request, reply) => {
    const user = await authenticate(request, reply);
    const { roomId } = request.params as { roomId: string };
    const { userId } = request.body as { userId: string };

    if (!userId) {
      return reply.code(400).send({ error: "userId required" });
    }

    const rooms = await db`
      SELECT id FROM rooms WHERE id = ${roomId} AND owner_id = ${user.id} AND status = 'open'
    `;
    if (rooms.length === 0) {
      return reply.code(404).send({ error: "Room not found or not owner" });
    }

    if (userId === user.id) {
      return reply.code(400).send({ error: "Cannot kick yourself" });
    }

    await db`
      UPDATE room_members SET left_at = NOW()
      WHERE room_id = ${roomId} AND user_id = ${userId} AND left_at IS NULL
    `;

    return { ok: true };
  });

  // Update proxy bitrate (owner only)
  app.patch("/:roomId/bitrate", async (request, reply) => {
    const user = await authenticate(request, reply);
    const { roomId } = request.params as { roomId: string };
    const body = bitrateSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Invalid input" });
    }

    const rooms = await db`
      SELECT id FROM rooms WHERE id = ${roomId} AND owner_id = ${user.id} AND status = 'open'
    `;
    if (rooms.length === 0) {
      return reply.code(404).send({ error: "Room not found or not owner" });
    }

    await db`
      UPDATE rooms SET proxy_max_bitrate = ${body.data.proxyMaxBitrate}
      WHERE id = ${roomId}
    `;

    return { ok: true };
  });

  // Get chat history
  app.get("/:roomId/messages", async (request, reply) => {
    const user = await authenticate(request, reply);
    const { roomId } = request.params as { roomId: string };
    const { limit, before } = request.query as { limit?: string; before?: string };

    // Verify membership
    const membership = await db`
      SELECT id FROM room_members
      WHERE room_id = ${roomId} AND user_id = ${user.id} AND left_at IS NULL
    `;
    if (membership.length === 0) {
      return reply.code(403).send({ error: "Not a room member" });
    }

    const messageLimit = Math.min(parseInt(limit || "50"), 100);

    let messages;
    if (before) {
      messages = await db`
        SELECT cm.id, cm.room_id, cm.user_id, cm.type, cm.content, cm.created_at, u.display_name
        FROM chat_messages cm
        LEFT JOIN users u ON u.id = cm.user_id
        WHERE cm.room_id = ${roomId} AND cm.created_at < ${before}
        ORDER BY cm.created_at DESC
        LIMIT ${messageLimit}
      `;
    } else {
      messages = await db`
        SELECT cm.id, cm.room_id, cm.user_id, cm.type, cm.content, cm.created_at, u.display_name
        FROM chat_messages cm
        LEFT JOIN users u ON u.id = cm.user_id
        WHERE cm.room_id = ${roomId}
        ORDER BY cm.created_at DESC
        LIMIT ${messageLimit}
      `;
    }

    return {
      messages: messages.reverse().map((m) => ({
        id: m.id,
        roomId: m.room_id,
        userId: m.user_id,
        displayName: m.display_name,
        type: m.type,
        content: m.content,
        createdAt: m.created_at,
      })),
    };
  });

  // Get playback URL
  app.get("/:roomId/playback-url", async (request, reply) => {
    const user = await authenticate(request, reply);
    const { roomId } = request.params as { roomId: string };

    // Verify membership
    const membership = await db`
      SELECT rm.role, r.owner_id, r.emby_connection_id, r.emby_item_id, r.proxy_max_bitrate, r.status
      FROM room_members rm
      JOIN rooms r ON r.id = rm.room_id
      WHERE rm.room_id = ${roomId} AND rm.user_id = ${user.id} AND rm.left_at IS NULL
    `;

    if (membership.length === 0) {
      return reply.code(403).send({ error: "Not a room member" });
    }

    const room = membership[0];

    if (room.status !== "open") {
      return reply.code(410).send({ error: "Room is closed" });
    }

    const isOwner = room.owner_id === user.id;

    if (isOwner) {
      // Direct: return Emby HLS URL
      const connections = await db`
        SELECT base_url, api_key_encrypted, emby_user_id
        FROM emby_connections WHERE id = ${room.emby_connection_id}
      `;

      if (connections.length === 0) {
        return reply.code(404).send({ error: "Emby connection not found" });
      }

      const conn = connections[0];
      const apiKey = decrypt(conn.api_key_encrypted);

      const params = new URLSearchParams();
      params.set("api_key", apiKey);
      params.set("MediaSourceId", room.emby_item_id);
      params.set("PlaySessionId", nanoid(16));
      params.set("VideoCodec", "h264");
      params.set("AudioCodec", "aac");
      params.set("TranscodingMaxAudioChannels", "2");

      const hlsUrl = `${conn.base_url}/Videos/${room.emby_item_id}/master.m3u8?${params.toString()}`;

      return {
        mode: "direct",
        type: "hls",
        url: hlsUrl,
        refreshInSeconds: 1200,
      };
    } else {
      // Proxy: generate media session
      const sessionId = nanoid(32);
      const session = {
        userId: user.id,
        roomId,
        embyConnectionId: room.emby_connection_id,
        embyItemId: room.emby_item_id,
        maxBitrate: room.proxy_max_bitrate,
        createdAt: Date.now(),
      };

      await redis.set(
        `media_session:${sessionId}`,
        JSON.stringify(session),
        "EX",
        1800 // 30 minutes
      );

      return {
        mode: "proxy",
        type: "hls",
        url: `/media/rooms/${roomId}/master.m3u8?session=${sessionId}`,
        maxBitrate: room.proxy_max_bitrate,
        refreshInSeconds: 1200,
      };
    }
  });
}
