import { db } from "../db/index.js";
import { redis } from "./redis.js";

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const EMPTY_ROOM_AFTER_INTERVAL = "30 minutes";

export function startCleanupTasks() {
  const run = async () => {
    try {
      await cleanupExpiredSessions();
      await cleanupEmptyRooms();
    } catch (err) {
      console.error("Cleanup task failed:", err);
    }
  };

  void run();
  return setInterval(run, CLEANUP_INTERVAL_MS);
}

async function cleanupExpiredSessions() {
  await db`DELETE FROM sessions WHERE expires_at < NOW()`;
}

async function cleanupEmptyRooms() {
  const rooms = await db`
    SELECT id
    FROM rooms
    WHERE status = 'open'
      AND created_at < NOW() - ${EMPTY_ROOM_AFTER_INTERVAL}::interval
  `;

  for (const room of rooms) {
    const onlineCount = await redis.hlen(`room:${room.id}:presence`);
    if (onlineCount > 0) continue;

    await db.begin(async (tx) => {
      await tx`
        UPDATE rooms
        SET status = 'closed', closed_at = NOW()
        WHERE id = ${room.id} AND status = 'open'
      `;
      await tx`
        UPDATE room_members
        SET left_at = COALESCE(left_at, NOW())
        WHERE room_id = ${room.id}
      `;
    });

    await redis.del(`room:${room.id}:playback`);
    await redis.del(`room:${room.id}:presence`);
  }
}
