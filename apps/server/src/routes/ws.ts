import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { db } from "../db/index.js";
import { redis } from "../services/redis.js";
import type { PlaybackState } from "@chikarika-tv/shared";

interface WsClient {
  ws: WebSocket;
  userId: string;
  displayName: string;
  roomId: string | null;
}

const clients = new Map<WebSocket, WsClient>();
const roomClients = new Map<string, Set<WebSocket>>();

function broadcast(roomId: string, event: string, data: any, exclude?: WebSocket) {
  const room = roomClients.get(roomId);
  if (!room) return;

  const message = JSON.stringify({ event, data });
  for (const ws of room) {
    if (ws !== exclude && ws.readyState === 1) {
      ws.send(message);
    }
  }
}

function sendTo(ws: WebSocket, event: string, data: any) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ event, data }));
  }
}

export async function wsHandler(app: FastifyInstance) {
  app.get("/", { websocket: true }, async (socket, request) => {
    const ws = socket as unknown as WebSocket;

    // Authenticate via cookie
    const sessionId = request.cookies?.session;
    if (!sessionId) {
      sendTo(ws, "system:error", { message: "Unauthorized" });
      ws.close(4001, "Unauthorized");
      return;
    }

    const sessions = await db`
      SELECT s.user_id, u.display_name
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.id = ${sessionId} AND s.expires_at > NOW()
    `;

    if (sessions.length === 0) {
      sendTo(ws, "system:error", { message: "Session expired" });
      ws.close(4001, "Session expired");
      return;
    }

    const client: WsClient = {
      ws,
      userId: sessions[0].user_id,
      displayName: sessions[0].display_name,
      roomId: null,
    };

    clients.set(ws, client);

    ws.on("message", async (raw: any) => {
      try {
        const { event, data } = JSON.parse(raw.toString());
        await handleEvent(client, event, data);
      } catch (err) {
        sendTo(ws, "system:error", { message: "Invalid message format" });
      }
    });

    ws.on("close", () => {
      if (client.roomId) {
        leaveRoom(client);
      }
      clients.delete(ws);
    });

    ws.on("error", () => {
      if (client.roomId) {
        leaveRoom(client);
      }
      clients.delete(ws);
    });

    // Heartbeat
    const heartbeat = setInterval(() => {
      if (ws.readyState === 1) {
        sendTo(ws, "system:ping", { time: Date.now() });
      } else {
        clearInterval(heartbeat);
      }
    }, 30000);

    ws.on("close", () => clearInterval(heartbeat));
  });
}

async function handleEvent(client: WsClient, event: string, data: any) {
  switch (event) {
    case "room:join":
      await joinRoom(client, data.roomId);
      break;
    case "room:leave":
      await leaveRoom(client);
      break;
    case "chat:send":
      await handleChat(client, data);
      break;
    case "playback:play":
    case "playback:pause":
    case "playback:seek":
      await handlePlayback(client, event, data);
      break;
    case "playback:resync":
      await handleResync(client, data);
      break;
    case "system:pong":
      // Client responded to heartbeat
      break;
    default:
      sendTo(client.ws, "system:error", { message: `Unknown event: ${event}` });
  }
}

async function joinRoom(client: WsClient, roomId: string) {
  if (!roomId) return;

  // Verify membership
  const membership = await db`
    SELECT rm.role FROM room_members rm
    JOIN rooms r ON r.id = rm.room_id
    WHERE rm.room_id = ${roomId} AND rm.user_id = ${client.userId}
      AND rm.left_at IS NULL AND r.status = 'open'
  `;

  if (membership.length === 0) {
    sendTo(client.ws, "system:error", { message: "Not a member of this room" });
    return;
  }

  // Leave current room if any
  if (client.roomId) {
    await leaveRoom(client);
  }

  client.roomId = roomId;

  // Add to room clients
  if (!roomClients.has(roomId)) {
    roomClients.set(roomId, new Set());
  }
  roomClients.get(roomId)!.add(client.ws);

  // Update presence in Redis
  await redis.hset(`room:${roomId}:presence`, client.userId, JSON.stringify({
    displayName: client.displayName,
    online: true,
    joinedAt: Date.now(),
  }));

  // Notify room
  broadcast(roomId, "room:member:joined", {
    roomId,
    userId: client.userId,
    displayName: client.displayName,
  }, client.ws);

  // Send current presence to joining client
  const presence = await redis.hgetall(`room:${roomId}:presence`);
  const members = Object.entries(presence).map(([userId, json]) => {
    const info = JSON.parse(json);
    return { userId, displayName: info.displayName, online: info.online };
  });
  sendTo(client.ws, "room:presence", { roomId, members });

  // Send current playback state
  const stateJson = await redis.get(`room:${roomId}:playback`);
  if (stateJson) {
    sendTo(client.ws, "playback:state", JSON.parse(stateJson));
  }

  // System message
  await saveSystemMessage(roomId, `${client.displayName} 加入了房间`);
  broadcast(roomId, "system:message", {
    roomId,
    content: `${client.displayName} 加入了房间`,
  });
}

async function leaveRoom(client: WsClient) {
  const roomId = client.roomId;
  if (!roomId) return;

  // Remove from room clients
  const room = roomClients.get(roomId);
  if (room) {
    room.delete(client.ws);
    if (room.size === 0) {
      roomClients.delete(roomId);
    }
  }

  // Update presence
  await redis.hdel(`room:${roomId}:presence`, client.userId);

  // Notify room
  broadcast(roomId, "room:member:left", {
    roomId,
    userId: client.userId,
    displayName: client.displayName,
  });

  await saveSystemMessage(roomId, `${client.displayName} 离开了房间`);
  broadcast(roomId, "system:message", {
    roomId,
    content: `${client.displayName} 离开了房间`,
  });

  client.roomId = null;
}

async function handleChat(client: WsClient, data: { roomId: string; content: string }) {
  const roomId = client.roomId;
  if (!roomId || roomId !== data.roomId) return;
  if (!data.content || data.content.length > 1000) return;

  const allowed = await rateLimit(`rate:chat:${roomId}:${client.userId}`, 20, 60);
  if (!allowed) {
    sendTo(client.ws, "system:error", { message: "发送太快了，稍后再试" });
    return;
  }

  // Save to DB
  const [msg] = await db`
    INSERT INTO chat_messages (room_id, user_id, type, content)
    VALUES (${roomId}, ${client.userId}, 'text', ${data.content})
    RETURNING id, room_id, user_id, type, content, created_at
  `;

  // Broadcast to room
  broadcast(roomId, "chat:new", {
    id: msg.id,
    roomId: msg.room_id,
    userId: msg.user_id,
    displayName: client.displayName,
    type: msg.type,
    content: msg.content,
    createdAt: msg.created_at,
  });
}

async function handlePlayback(
  client: WsClient,
  event: string,
  data: { roomId: string; positionMs: number; clientTime: number }
) {
  const roomId = client.roomId;
  if (!roomId || roomId !== data.roomId) return;

  const allowed = await rateLimit(`rate:playback:${roomId}:${client.userId}`, 30, 10);
  if (!allowed) {
    sendTo(client.ws, "system:error", { message: "播放控制太频繁了，稍后再试" });
    return;
  }

  const type = event.replace("playback:", "") as "play" | "pause" | "seek";

  // Get current state
  const stateJson = await redis.get(`room:${roomId}:playback`);
  const currentState: PlaybackState = stateJson
    ? JSON.parse(stateJson)
    : { roomId, playing: false, positionMs: 0, serverTime: Date.now(), updatedBy: client.userId, revision: 0 };

  // Update state
  const newState: PlaybackState = {
    roomId,
    playing: type === "play" ? true : type === "pause" ? false : currentState.playing,
    positionMs: data.positionMs,
    serverTime: Date.now(),
    updatedBy: client.userId,
    revision: currentState.revision + 1,
  };

  await redis.set(`room:${roomId}:playback`, JSON.stringify(newState), "EX", 86400);

  // Broadcast to all in room (including sender for confirmation)
  broadcast(roomId, "playback:state", newState);

  // System message for seek/pause
  const actionText =
    type === "play" ? "播放" :
    type === "pause" ? "暂停" :
    `跳转到 ${formatTime(data.positionMs)}`;

  await saveSystemMessage(roomId, `${client.displayName} ${actionText}了`);
  broadcast(roomId, "system:message", {
    roomId,
    content: `${client.displayName} ${actionText}了`,
  });
}

async function handleResync(client: WsClient, data: { roomId: string }) {
  const roomId = client.roomId;
  if (!roomId || roomId !== data.roomId) return;

  const stateJson = await redis.get(`room:${roomId}:playback`);
  if (stateJson) {
    sendTo(client.ws, "playback:state", JSON.parse(stateJson));
  }
}

async function saveSystemMessage(roomId: string, content: string) {
  await db`
    INSERT INTO chat_messages (room_id, type, content)
    VALUES (${roomId}, 'system', ${content})
  `;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

async function rateLimit(key: string, max: number, windowSeconds: number): Promise<boolean> {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  return count <= max;
}
