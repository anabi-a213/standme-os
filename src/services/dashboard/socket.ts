import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import { dashboardBus } from './event-bus';
import { processChat, getSessionHistory, clearSession, getWelcomeMessage } from './chat-service';
import { logger } from '../../utils/logger';

let io: SocketServer | null = null;

export function initDashboardSocket(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: { origin: '*' },
    path: '/ws',
    // pingInterval must stay well under Railway's 75s proxy idle timeout.
    // pingTimeout is generous so throttled background tabs don't get false-disconnected.
    // upgradeTimeout gives slow mobile connections time to upgrade WS.
    pingInterval: 25000,
    pingTimeout: 20000,
    upgradeTimeout: 30000,
    // Allow both transports; client tries WS first, falls back to long-polling
    transports: ['websocket', 'polling'],
  });

  // Give event-bus a direct reference to io so broadcastToChat() emits without EventEmitter relay
  dashboardBus.setIO(io);

  io.on('connection', async (socket: Socket) => {
    logger.info(`[Dashboard] Client connected: ${socket.id}`);

    // Send current agent state + recent activity
    socket.emit('init', {
      agents: dashboardBus.getStatuses(),
      logs: dashboardBus.getRecentLogs(),
      stats: dashboardBus.getSystemStats(),
    });

    // Replay recent Telegram agent broadcasts so clients that connect late still see them
    const recentBroadcasts = dashboardBus.getRecentBroadcasts();
    if (recentBroadcasts.length > 0) {
      socket.emit('chat:broadcast_history', recentBroadcasts);
    }

    // Send welcome message — getWelcomeMessage() caches the result in memory for 6h
    // so reconnects don't trigger a fresh AI call every time
    try {
      const welcome = await getWelcomeMessage();
      socket.emit('chat:welcome', { text: welcome, timestamp: new Date().toISOString() });
    } catch (err: any) {
      logger.warn(`[Dashboard] Welcome message error: ${err.message}`);
    }

    // Track which session this socket is using (captured from first chat event).
    let socketSessionId: string | null = null;

    // ── CHAT ──────────────────────────────────────────────────────────────────
    socket.on('chat:send', async (data: { message: string; sessionId: string }) => {
      const { message, sessionId } = data;
      if (!message?.trim()) return;

      // Capture sessionId so disconnect handler can clean up
      if (sessionId) socketSessionId = sessionId;

      logger.info(`[DashboardChat] [${sessionId}] User: ${message.substring(0, 80)}`);

      // Tell client AI is typing
      socket.emit('chat:typing', { sessionId });

      try {
        await processChat(
          sessionId,
          message,

          // Stream each text chunk back in real time
          (chunk: string) => {
            socket.emit('chat:chunk', { text: chunk, sessionId });
          },

          // Agent starting
          (command: string) => {
            socket.emit('chat:agent_start', { command, sessionId });
          },

          // Agent done
          (command: string, result: string, success: boolean) => {
            socket.emit('chat:agent_done', { command, result, success, sessionId });
          },
        );

        socket.emit('chat:done', { sessionId });
      } catch (err: any) {
        logger.error(`[DashboardChat] Error: ${err.message}`);
        socket.emit('chat:error', { message: err.message, sessionId });
      }
    });

    // Load conversation history for a session
    socket.on('chat:history', (data: { sessionId: string }) => {
      if (data.sessionId) socketSessionId = data.sessionId;
      const history = getSessionHistory(data.sessionId);
      socket.emit('chat:history', { history, sessionId: data.sessionId });
    });

    // Clear conversation
    socket.on('chat:clear', (data: { sessionId: string }) => {
      clearSession(data.sessionId);
      socket.emit('chat:cleared', { sessionId: data.sessionId });
    });

    socket.on('disconnect', () => {
      logger.info(`[Dashboard] Client disconnected: ${socket.id}`);
      // Clear session immediately on disconnect so memory is freed without waiting
      // for the hourly TTL sweep. If the user reconnects with the same sessionId
      // they'll start a fresh session (expected behaviour for a closed tab).
      if (socketSessionId) {
        clearSession(socketSessionId);
      }
    });
  });

  // ── AGENT EVENTS → broadcast to all dashboard clients ────────────────────
  dashboardBus.on('event', (event) => {
    if (io) {
      io.emit('event', event);
      io.emit('stats', dashboardBus.getSystemStats());
      io.emit('agents', dashboardBus.getStatuses());
    }
  });

  logger.info('[Dashboard] Socket.IO initialized');
  return io;
}

export function getIO(): SocketServer | null {
  return io;
}
