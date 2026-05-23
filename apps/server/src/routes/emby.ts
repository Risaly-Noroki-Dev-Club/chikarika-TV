import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import { encrypt, decrypt } from "../utils/crypto.js";
import { validateEmbyUrl } from "../utils/ssrf.js";

const addConnectionSchema = z.object({
  baseUrl: z.string().url(),
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(512),
});

const EMBY_CLIENT_NAME = "watchroom";
const EMBY_CLIENT_VERSION = "0.1.0";

function embyAuthorization(deviceId: string, userId?: string | null) {
  const userPart = userId ? `UserId="${userId}", ` : "";
  return `Emby ${userPart}Client="${EMBY_CLIENT_NAME}", Device="watchroom-web", DeviceId="${deviceId}", Version="${EMBY_CLIENT_VERSION}"`;
}

async function fetchJson(url: string, init: RequestInit = {}) {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`Emby responded with ${res.status}`);
  }
  return res.json();
}

async function normalizeEmbyBaseUrl(input: string) {
  const base = input.replace(/\/+$/, "");
  const candidates = [base];
  if (!base.endsWith("/emby")) {
    candidates.push(`${base}/emby`);
  }

  for (const candidate of candidates) {
    try {
      await fetchJson(`${candidate}/System/Info/Public`);
      return candidate;
    } catch {
      // Try the next common Emby API base path.
    }
  }

  return base;
}

async function authenticateEmbyUser(
  baseUrl: string,
  username: string,
  password: string,
  deviceId: string
) {
  return fetchJson(`${baseUrl}/Users/AuthenticateByName`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: embyAuthorization(deviceId),
    },
    body: JSON.stringify({ Username: username, Pw: password }),
  });
}

async function embyFetch(
  baseUrl: string,
  accessToken: string,
  path: string,
  deviceId: string,
  userId?: string | null
) {
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  return fetchJson(url, {
    headers: {
      "X-Emby-Token": accessToken,
      Authorization: embyAuthorization(deviceId, userId),
    },
  });
}

export async function embyRoutes(app: FastifyInstance) {
  // Add Emby connection
  app.post("/connections", async (request, reply) => {
    const user = await authenticate(request, reply);
    const body = addConnectionSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Invalid input", details: body.error.flatten() });
    }

    const { username, password } = body.data;
    let { baseUrl } = body.data;

    // SSRF check
    const validation = await validateEmbyUrl(baseUrl);
    if (!validation.valid) {
      return reply.code(400).send({ error: validation.error });
    }

    // Test connection
    try {
      baseUrl = await normalizeEmbyBaseUrl(baseUrl);
      const deviceId = `watchroom-${nanoid(24)}`;
      const auth = await authenticateEmbyUser(baseUrl, username, password, deviceId);
      const accessToken = auth.AccessToken;
      const embyUserId = auth.User?.Id || null;
      if (!accessToken || !embyUserId) {
        throw new Error("Emby login response did not include an access token");
      }

      let info = auth.SessionInfo || auth;
      try {
        info = await embyFetch(baseUrl, accessToken, "/System/Info", deviceId, embyUserId);
      } catch {
        // Authentication succeeded; server info is only used for display.
      }

      const accessTokenEncrypted = encrypt(accessToken);

      const [conn] = await db`
        INSERT INTO emby_connections (user_id, base_url, api_key_encrypted, emby_user_id, server_id, server_name, device_id)
        VALUES (${user.id}, ${baseUrl}, ${accessTokenEncrypted}, ${embyUserId}, ${info.Id || auth.ServerId || null}, ${info.ServerName || null}, ${deviceId})
        RETURNING id, base_url, emby_user_id, server_id, server_name, created_at
      `;

      return {
        connection: {
          id: conn.id,
          baseUrl: conn.base_url,
          embyUserId: conn.emby_user_id,
          serverId: conn.server_id,
          serverName: conn.server_name,
          createdAt: conn.created_at,
        },
      };
    } catch (err: any) {
      return reply
        .code(400)
        .send({ error: `Cannot connect to Emby: ${err.message}` });
    }
  });

  // List connections
  app.get("/connections", async (request, reply) => {
    const user = await authenticate(request, reply);
    const connections = await db`
      SELECT id, base_url, emby_user_id, server_id, server_name, created_at, updated_at
      FROM emby_connections WHERE user_id = ${user.id}
      ORDER BY created_at DESC
    `;

    return {
      connections: connections.map((c) => ({
        id: c.id,
        baseUrl: c.base_url,
        embyUserId: c.emby_user_id,
        serverId: c.server_id,
        serverName: c.server_name,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      })),
    };
  });

  // Test connection
  app.post("/connections/:id/test", async (request, reply) => {
    const user = await authenticate(request, reply);
    const { id } = request.params as { id: string };

    const connections = await db`
      SELECT id, base_url, api_key_encrypted, emby_user_id, device_id
      FROM emby_connections WHERE id = ${id} AND user_id = ${user.id}
    `;

    if (connections.length === 0) {
      return reply.code(404).send({ error: "Connection not found" });
    }

    const conn = connections[0];
    const accessToken = decrypt(conn.api_key_encrypted);

    try {
      const info = await embyFetch(
        conn.base_url,
        accessToken,
        "/System/Info",
        conn.device_id || `watchroom-${conn.id}`,
        conn.emby_user_id
      );
      return { ok: true, serverName: info.ServerName };
    } catch (err: any) {
      return reply.code(400).send({ error: `Connection failed: ${err.message}` });
    }
  });

  // Delete connection
  app.delete("/connections/:id", async (request, reply) => {
    const user = await authenticate(request, reply);
    const { id } = request.params as { id: string };

    const result = await db`
      DELETE FROM emby_connections WHERE id = ${id} AND user_id = ${user.id}
      RETURNING id
    `;

    if (result.length === 0) {
      return reply.code(404).send({ error: "Connection not found" });
    }

    return { ok: true };
  });

  // Get libraries
  app.get("/connections/:id/libraries", async (request, reply) => {
    const user = await authenticate(request, reply);
    const { id } = request.params as { id: string };

    const connections = await db`
      SELECT id, base_url, api_key_encrypted, emby_user_id, device_id
      FROM emby_connections WHERE id = ${id} AND user_id = ${user.id}
    `;

    if (connections.length === 0) {
      return reply.code(404).send({ error: "Connection not found" });
    }

    const conn = connections[0];
    const accessToken = decrypt(conn.api_key_encrypted);

    try {
      let path = "/Library/VirtualFolders";
      const data = await embyFetch(
        conn.base_url,
        accessToken,
        path,
        conn.device_id || `watchroom-${conn.id}`,
        conn.emby_user_id
      );
      return { libraries: data };
    } catch (err: any) {
      return reply.code(400).send({ error: `Failed to fetch libraries: ${err.message}` });
    }
  });

  // Get items (movies, episodes, etc.)
  app.get("/connections/:id/items", async (request, reply) => {
    const user = await authenticate(request, reply);
    const { id } = request.params as { id: string };
    const { parentId, limit, startIndex, searchTerm } = request.query as {
      parentId?: string;
      limit?: string;
      startIndex?: string;
      searchTerm?: string;
    };

    const connections = await db`
      SELECT id, base_url, api_key_encrypted, emby_user_id, device_id
      FROM emby_connections WHERE id = ${id} AND user_id = ${user.id}
    `;

    if (connections.length === 0) {
      return reply.code(404).send({ error: "Connection not found" });
    }

    const conn = connections[0];
    const accessToken = decrypt(conn.api_key_encrypted);

    try {
      const params = new URLSearchParams();
      params.set("Recursive", "true");
      params.set(
        "IncludeItemTypes",
        "Movie,Episode,Series"
      );
      params.set(
        "Fields",
        "Overview,Genres,CommunityRating,RunTimeTicks,MediaSources"
      );
      params.set("Limit", limit || "50");
      params.set("StartIndex", startIndex || "0");
      params.set("SortBy", "SortName");
      params.set("SortOrder", "Ascending");

      if (parentId) params.set("ParentId", parentId);
      if (searchTerm) params.set("SearchTerm", searchTerm);

      const userId = conn.emby_user_id;
      let path: string;
      if (userId) {
        path = `/Users/${userId}/Items?${params.toString()}`;
      } else {
        path = `/Items?${params.toString()}`;
      }

      const data = await embyFetch(
        conn.base_url,
        accessToken,
        path,
        conn.device_id || `watchroom-${conn.id}`,
        userId
      );
      return { items: data.Items || [], totalCount: data.TotalRecordCount || 0 };
    } catch (err: any) {
      return reply.code(400).send({ error: `Failed to fetch items: ${err.message}` });
    }
  });

  // Get single item details
  app.get("/connections/:id/items/:itemId", async (request, reply) => {
    const user = await authenticate(request, reply);
    const { id, itemId } = request.params as { id: string; itemId: string };

    const connections = await db`
      SELECT id, base_url, api_key_encrypted, emby_user_id, device_id
      FROM emby_connections WHERE id = ${id} AND user_id = ${user.id}
    `;

    if (connections.length === 0) {
      return reply.code(404).send({ error: "Connection not found" });
    }

    const conn = connections[0];
    const accessToken = decrypt(conn.api_key_encrypted);

    try {
      const userId = conn.emby_user_id;
      let path: string;
      if (userId) {
        path = `/Users/${userId}/Items/${itemId}`;
      } else {
        path = `/Items/${itemId}`;
      }

      const data = await embyFetch(
        conn.base_url,
        accessToken,
        path,
        conn.device_id || `watchroom-${conn.id}`,
        userId
      );
      return { item: data };
    } catch (err: any) {
      return reply
        .code(400)
        .send({ error: `Failed to fetch item: ${err.message}` });
    }
  });
}
