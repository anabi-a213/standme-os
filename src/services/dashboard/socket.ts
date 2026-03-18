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
  });

  io.on('connection', async (socket: Socket) => {
    logger.info(`[Dashboard] Client connected: ${socket.id}`);

    // Send current agent state + recent activity
    socket.emit('init', {
      agents: dashboardBus.getStatuses(),
      logs: dashboardBus.getRecentLogs(),
      stats: dashboardBus.getSystemStats(),
    });

    // Send welcome message from AI
    try {
      const welcome = await getWelcomeMessage();
      socket.emit('chat:welcome', { text: welcome, timestamp: new Date().toISOString() });
    } catch (err: any) {
      logger.warn(`[Dashboard] Welcome message error: ${err.message}`);
    }

    // ── CHAT ──────────────────────────────────────────────────────────────────
    socket.on('chat:send', async (data: { message: string; sessionId: string }) => {
      const { message, sessionId } = data;
      if (!message?.trim()) return;

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
