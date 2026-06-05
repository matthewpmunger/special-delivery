export const LOCAL_SOCKET_SERVER_URL = "http://localhost:4000";
export const PRODUCTION_SOCKET_SERVER_URL = "https://socket-server-production-d851.up.railway.app";

export function fallbackSocketServerUrl(hostname?: string): string {
  if (hostname && isLocalHostname(hostname)) {
    return LOCAL_SOCKET_SERVER_URL;
  }

  return process.env.NODE_ENV === "development" ? LOCAL_SOCKET_SERVER_URL : PRODUCTION_SOCKET_SERVER_URL;
}

export function normalizeSocketServerUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
