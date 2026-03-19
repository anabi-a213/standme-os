import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      path: '/ws',
      // Try WebSocket first, fall back to long-polling (needed for some mobile networks)
      transports: ['websocket', 'polling'],
      // Reconnection — never give up, fast initial retry, cap at 5s
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      // Longer timeout for slow mobile networks and Railway cold starts
      timeout: 30000,
      // Automatically connect when getSocket() is called
      autoConnect: true,
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
