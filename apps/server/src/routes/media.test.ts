import { describe, expect, it } from "vitest";
import { rewritePlaylist } from "./media.js";

const roomId = "room_123";
const session = "session_abc";

function extractUpstream(line: string): string {
  const url = new URL(line, "http://localhost");
  return url.searchParams.get("u") || "";
}

describe("rewritePlaylist", () => {
  it("keeps comments and blank lines unchanged", () => {
    const input = "#EXTM3U\n#EXT-X-VERSION:3\n\n";
    expect(rewritePlaylist(input, roomId, session, "https://emby.example/hls/master.m3u8"))
      .toBe(input);
  });

  it("rewrites relative segment URLs against the playlist URL", () => {
    const output = rewritePlaylist(
      "segment001.ts\n",
      roomId,
      session,
      "https://emby.example/emby/videos/abc/playlist.m3u8?api_key=hidden"
    );

    const line = output.trim();
    expect(line).toContain(`/media/rooms/${roomId}/hls?`);
    expect(line).toContain(`session=${session}`);
    expect(extractUpstream(line)).toBe("https://emby.example/emby/videos/abc/segment001.ts");
  });

  it("preserves segment query strings", () => {
    const output = rewritePlaylist(
      "segment001.ts?StartTimeTicks=123&foo=bar\n",
      roomId,
      session,
      "https://emby.example/emby/videos/abc/playlist.m3u8"
    );

    expect(extractUpstream(output.trim())).toBe(
      "https://emby.example/emby/videos/abc/segment001.ts?StartTimeTicks=123&foo=bar"
    );
  });

  it("rewrites absolute URLs without losing their path/query", () => {
    const output = rewritePlaylist(
      "https://emby.example/transcoding/seg.m4s?token=x&n=1\n",
      roomId,
      session,
      "https://emby.example/emby/videos/abc/playlist.m3u8"
    );

    expect(extractUpstream(output.trim())).toBe(
      "https://emby.example/transcoding/seg.m4s?token=x&n=1"
    );
  });

  it("rewrites variant playlists as well as segments", () => {
    const output = rewritePlaylist(
      "720p/variant.m3u8\n",
      roomId,
      session,
      "https://emby.example/emby/videos/abc/master.m3u8"
    );

    expect(extractUpstream(output.trim())).toBe(
      "https://emby.example/emby/videos/abc/720p/variant.m3u8"
    );
  });
});
