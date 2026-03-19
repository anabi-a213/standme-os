import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      path: '/ws',
      // Prefer WebSocket transport — not subject to browser timer throttling
      // like long-polling is. Fall back to polling only on networks that block WS.
      transports: ['websocket', 'polling'],
      // Never give up reconnecting — background tab unfreezes, mobile network changes, etc.
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      // Generous timeout for Railway cold starts and slow mobile networks
      timeout: 30000,
      autoConnect: true,
    });

    // ── Page Visibility API ────────────────────────────────────────────────
    // Browsers throttle/freeze JS timers in background tabs. When a tab
    // is frozen the Socket.IO heartbeat stops → server drops the connection.
    // When the user comes back we force an immediate reconnect so the UI
    // is live again without waiting for the SDK's backoff timer.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          if (socket && !socket.connected) {
            socket.connect();
          }
        }
      });
    }

    // ── Online/Offline ─────────────────────────────────────────────────────
    // Mobile users can lose network and regain it (WiFi → cell → WiFi).
    // Reconnect immediately when the network comes back online.
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        if (socket && !socket.connected) {
          socket.connect();
        }
      });
    }
  }
  return socket;
}

/** Force an immediate reconnect — can be called from UI on manual retry */
export function forceReconnect(): void {
  if (socket) {
    socket.disconnect().connect();
  }
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
