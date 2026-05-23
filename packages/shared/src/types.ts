// ========== User ==========
export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  createdAt: Date;
}

// ========== Emby Connection ==========
export interface EmbyConnection {
  id: string;
  userId: string;
  baseUrl: string;
  accessToken?: string; // never sent to client
  embyUserId?: string;
  serverId?: string;
  serverName?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ========== Room ==========
export type RoomStatus = "open" | "closed";
export type RoomRole = "owner" | "member";
export type StreamPolicy = "host_direct_guest_proxy";

export interface Room {
  id: string;
  ownerId: string;
  embyConnectionId: string;
  embyItemId: string;
  title: string;
  streamPolicy: StreamPolicy;
  proxyMaxBitrate: number;
  maxMembers: number;
  status: RoomStatus;
  createdAt: Date;
  closedAt?: Date;
}

export interface RoomMember {
  id: string;
  roomId: string;
  userId: string;
  role: RoomRole;
  joinedAt: Date;
  leftAt?: Date;
}

// ========== Chat ==========
export type ChatMessageType = "text" | "system";

export interface ChatMessage {
  id: string;
  roomId: string;
  userId?: string;
  type: ChatMessageType;
  content: string;
  createdAt: Date;
}

// ========== Playback ==========
export interface PlaybackState {
  roomId: string;
  playing: boolean;
  positionMs: number;
  serverTime: number;
  updatedBy: string;
  revision: number;
}

export interface PlaybackCommand {
  roomId: string;
  type: "play" | "pause" | "seek";
  positionMs: number;
  clientTime: number;
  userId: string;
}

// ========== Playback URL ==========
export type PlaybackMode = "direct" | "proxy";

export interface PlaybackUrlResponse {
  mode: PlaybackMode;
  type: "hls";
  url: string;
  maxBitrate?: number;
  refreshInSeconds: number;
}

// ========== WebSocket Events ==========

// Client -> Server
export interface ClientEvents {
  "room:join": { roomId: string };
  "room:leave": { roomId: string };
  "chat:send": { roomId: string; content: string };
  "playback:play": { roomId: string; positionMs: number; clientTime: number };
  "playback:pause": { roomId: string; positionMs: number; clientTime: number };
  "playback:seek": { roomId: string; positionMs: number; clientTime: number };
  "playback:resync": { roomId: string };
}

// Server -> Client
export interface ServerEvents {
  "room:presence": {
    roomId: string;
    members: Array<{ userId: string; displayName: string; online: boolean }>;
  };
  "room:member:joined": { roomId: string; userId: string; displayName: string };
  "room:member:left": { roomId: string; userId: string; displayName: string };
  "room:closed": { roomId: string };
  "chat:new": ChatMessage;
  "playback:state": PlaybackState;
  "system:message": { roomId: string; content: string };
  "system:error": { message: string };
}
