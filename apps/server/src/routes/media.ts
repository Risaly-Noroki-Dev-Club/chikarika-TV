import type { FastifyInstance } from "fastify";
import { redis } from "../services/redis.js";
import { db } from "../db/index.js";
import { decrypt } from "../utils/crypto.js";

interface MediaSession {
  userId: string;
  roomId: string;
  embyConnectionId: string;
  embyItemId: string;
  maxBitrate: number;
  createdAt: number;
}

async function validateMediaSession(
  session: string,
  roomId: string
): Promise<MediaSession | null> {
  const data = await redis.get(`media_session:${session}`);
  if (!data) return null;

  const parsed: MediaSession = JSON.parse(data);
  if (parsed.roomId !== roomId) return null;

  return parsed;
}

async function getEmbyCredentials(connectionId: string) {
  const connections = await db`
    SELECT base_url, api_key_encrypted, emby_user_id
    FROM emby_connections WHERE id = ${connectionId}
  `;
  if (connections.length === 0) return null;

  const conn = connections[0];
  return {
    baseUrl: conn.base_url as string,
    apiKey: decrypt(conn.api_key_encrypted),
    embyUserId: conn.emby_user_id as string | null,
  };
}

export async function mediaRoutes(app: FastifyInstance) {
  // HLS master playlist proxy
  app.get("/rooms/:roomId/master.m3u8", async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const { session } = request.query as { session: string };

    if (!session) {
      return reply.code(401).send({ error: "Missing session" });
    }

    const mediaSession = await validateMediaSession(session, roomId);
    if (!mediaSession) {
      return reply.code(403).send({ error: "Invalid or expired session" });
    }

    const creds = await getEmbyCredentials(mediaSession.embyConnectionId);
    if (!creds) {
      return reply.code(500).send({ error: "Emby connection unavailable" });
    }

    // Build Emby HLS URL with bitrate limit
    const params = new URLSearchParams();
    params.set("api_key", creds.apiKey);
    params.set("MediaSourceId", mediaSession.embyItemId);
    params.set("VideoCodec", "h264");
    params.set("AudioCodec", "aac");
    params.set("TranscodingMaxAudioChannels", "2");
    params.set(
      "MaxStreamingBitrate",
      mediaSession.maxBitrate.toString()
    );
    params.set("PlaySessionId", session.slice(0, 16));

    const embyUrl = `${creds.baseUrl}/Videos/${mediaSession.embyItemId}/master.m3u8?${params.toString()}`;

    try {
      const res = await fetch(embyUrl, {
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        return reply
          .code(res.status)
          .send({ error: `Emby returned ${res.status}` });
      }

      let playlist = await res.text();

      // Rewrite segment URLs to go through our proxy
      playlist = rewritePlaylist(playlist, roomId, session, embyUrl);

      reply.header("Content-Type", "application/vnd.apple.mpegurl");
      reply.header("Cache-Control", "no-cache");
      return reply.send(playlist);
    } catch (err: any) {
      return reply
        .code(502)
        .send({ error: `Failed to fetch from Emby: ${err.message}` });
    }
  });

  // HLS playlist/segment proxy using an encoded upstream URL. This preserves
  // relative paths and query strings from Emby playlists without ambiguity.
  app.get("/rooms/:roomId/hls", async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const { session, u } = request.query as { session?: string; u?: string };

    if (!session) {
      return reply.code(401).send({ error: "Missing session" });
    }
    if (!u) {
      return reply.code(400).send({ error: "Missing upstream URL" });
    }

    const mediaSession = await validateMediaSession(session, roomId);
    if (!mediaSession) {
      return reply.code(403).send({ error: "Invalid or expired session" });
    }

    const creds = await getEmbyCredentials(mediaSession.embyConnectionId);
    if (!creds) {
      return reply.code(500).send({ error: "Emby connection unavailable" });
    }

    let upstreamUrl: URL;
    try {
      upstreamUrl = new URL(u);
      const embyBase = new URL(creds.baseUrl);
      if (upstreamUrl.origin !== embyBase.origin) {
        return reply.code(403).send({ error: "Upstream origin mismatch" });
      }
      upstreamUrl.searchParams.set("api_key", creds.apiKey);
    } catch {
      return reply.code(400).send({ error: "Invalid upstream URL" });
    }

    return proxyHlsUpstream(upstreamUrl.toString(), roomId, session, reply);
  });

  // HLS variant/sub playlist proxy (legacy path form, kept for compatibility)
  app.get("/rooms/:roomId/hls/*", async (request, reply) => {
    const { roomId } = request.params as { roomId: string; "*": string };
    const splat = (request.params as any)["*"];
    const { session } = request.query as { session: string };

    if (!session) {
      return reply.code(401).send({ error: "Missing session" });
    }

    const mediaSession = await validateMediaSession(session, roomId);
    if (!mediaSession) {
      return reply.code(403).send({ error: "Invalid or expired session" });
    }

    const creds = await getEmbyCredentials(mediaSession.embyConnectionId);
    if (!creds) {
      return reply.code(500).send({ error: "Emby connection unavailable" });
    }

    const originalUrl = new URL(request.url, "http://localhost");
    originalUrl.searchParams.delete("session");
    originalUrl.searchParams.set("api_key", creds.apiKey);

    const embyUrl = `${creds.baseUrl}/${splat}${originalUrl.search}`;

    return proxyHlsUpstream(embyUrl, roomId, session, reply);
  });

  async function proxyHlsUpstream(
    embyUrl: string,
    roomId: string,
    session: string,
    reply: any
  ) {
    const url = new URL(embyUrl);
    const pathName = url.pathname;

    try {
      const res = await fetch(embyUrl, {
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) {
        return reply
          .code(res.status)
          .send({ error: `Emby returned ${res.status}` });
      }

      const contentType =
        res.headers.get("content-type") || "application/octet-stream";

      // If it's a playlist, rewrite URLs
      if (
        contentType.includes("mpegurl") ||
        pathName.endsWith(".m3u8")
      ) {
        let playlist = await res.text();
        playlist = rewritePlaylist(playlist, roomId, session, embyUrl);
        reply.header("Content-Type", "application/vnd.apple.mpegurl");
        reply.header("Cache-Control", "no-cache");
        return reply.send(playlist);
      }

      // For segments (.ts, .m4s, etc.), stream through
      reply.header("Content-Type", contentType);
      reply.header("Cache-Control", "no-cache, no-store");

      const contentLength = res.headers.get("content-length");
      if (contentLength) {
        reply.header("Content-Length", contentLength);
      }

      // Stream the response body
      if (res.body) {
        return reply.send(res.body);
      }

      return reply.code(502).send({ error: "No response body" });
    } catch (err: any) {
      return reply
        .code(502)
        .send({ error: `Failed to proxy: ${err.message}` });
    }
  }

  // Subtitle proxy
  app.get("/rooms/:roomId/subtitles/*", async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const splat = (request.params as any)["*"];
    const { session } = request.query as { session: string };

    if (!session) {
      return reply.code(401).send({ error: "Missing session" });
    }

    const mediaSession = await validateMediaSession(session, roomId);
    if (!mediaSession) {
      return reply.code(403).send({ error: "Invalid or expired session" });
    }

    const creds = await getEmbyCredentials(mediaSession.embyConnectionId);
    if (!creds) {
      return reply.code(500).send({ error: "Emby connection unavailable" });
    }

    const embyUrl = `${creds.baseUrl}/${splat}?api_key=${creds.apiKey}`;

    try {
      const res = await fetch(embyUrl, {
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        return reply.code(res.status).send({ error: `Emby returned ${res.status}` });
      }

      const contentType = res.headers.get("content-type") || "text/plain";
      reply.header("Content-Type", contentType);
      reply.header("Cache-Control", "public, max-age=3600");

      if (res.body) {
        return reply.send(res.body);
      }
      return reply.send(await res.text());
    } catch (err: any) {
      return reply.code(502).send({ error: `Failed to proxy subtitle: ${err.message}` });
    }
  });
}

export function rewritePlaylist(
  playlist: string,
  roomId: string,
  session: string,
  playlistUrl: string
): string {
  const lines = playlist.split("\n");
  const rewritten = lines.map((line) => {
    const trimmed = line.trim();

    // Skip comments/tags
    if (trimmed.startsWith("#") || trimmed === "") {
      return line;
    }

    try {
      const upstreamUrl = new URL(trimmed, playlistUrl);
      const params = new URLSearchParams({
        session,
        u: upstreamUrl.toString(),
      });
      return `/media/rooms/${roomId}/hls?${params.toString()}`;
    } catch {
      return line;
    }
  });

  return rewritten.join("\n");
}
