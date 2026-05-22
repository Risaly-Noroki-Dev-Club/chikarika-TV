import { URL } from "node:url";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

const BLOCKED_RANGES = [
  // Loopback
  { start: "127.0.0.0", mask: 8 },
  // Private networks
  { start: "10.0.0.0", mask: 8 },
  { start: "172.16.0.0", mask: 12 },
  { start: "192.168.0.0", mask: 16 },
  // Link-local
  { start: "169.254.0.0", mask: 16 },
  // Multicast
  { start: "224.0.0.0", mask: 4 },
];

function ipToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isBlockedIp(ip: string): boolean {
  if (!isIP(ip)) return false;
  // Only handle IPv4 for now
  if (isIP(ip) !== 4) return false;

  const ipInt = ipToInt(ip);

  for (const range of BLOCKED_RANGES) {
    const startInt = ipToInt(range.start);
    const mask = (0xffffffff << (32 - range.mask)) >>> 0;
    if ((ipInt & mask) === (startInt & mask)) {
      return true;
    }
  }

  return false;
}

export async function validateEmbyUrl(urlString: string): Promise<{
  valid: boolean;
  error?: string;
  url?: URL;
}> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    return { valid: false, error: "Only HTTP/HTTPS protocols allowed" };
  }

  const hostname = url.hostname;

  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return { valid: false, error: "Localhost addresses are not allowed" };
  }

  // Check if hostname is an IP
  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      return { valid: false, error: "Private/reserved IP addresses are not allowed" };
    }
  } else {
    // Resolve hostname and check
    try {
      const result = await lookup(hostname);
      if (isBlockedIp(result.address)) {
        return {
          valid: false,
          error: "Hostname resolves to a private/reserved IP address",
        };
      }
    } catch {
      return { valid: false, error: "Cannot resolve hostname" };
    }
  }

  return { valid: true, url };
}
