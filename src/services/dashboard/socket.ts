import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { dashboardBus } from './event-bus';
import { logger } from '../../utils/logger';

let io: SocketServer | null = null;

export function initDashboardSocket(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: { origin: '*' },
    path: '/ws',
  });

  io.on('connection', (socket) => {
    logger.info(`[Dashboard] Client connected: ${socket.id}`);

    // Send current state on connect
    socket.emit('init', {
      agents: dashboardBus.getStatuses(),
      logs: dashboardBus.getRecentLogs(),
      stats: dashboardBus.getSystemStats(),
    });

    socket.on('disconnect', () => {
      logger.info(`[Dashboard] Client disconnected: ${socket.id}`);
    });
  });

  // Forward all events to connected clients
  dashboardBus.on('event', (event) => {
    if (io) {
      io.emit('event', event);
      // Also send updated stats
      io.emit('stats', dashboardBus.getSystemStats());
      // Send updated agent status
      io.emit('agents', dashboardBus.getStatuses());
    }
  });

  logger.info('[Dashboard] Socket.IO initialized');
  return io;
}

export function getIO(): SocketServer | null {
  return io;
}
