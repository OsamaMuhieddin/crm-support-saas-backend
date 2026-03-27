import { Server } from 'socket.io';
import { realtimeConfig } from '../../config/realtime.config.js';
import {
  registerRealtimeSocketHandlers,
  resetRealtimeSocketHandlersRuntime,
} from '../../modules/realtime/services/realtime-socket.service.js';
import {
  configureRealtimeRedisAdapter,
  closeRealtimeRedis,
  getRealtimeRedisStatus,
} from './realtime-redis.js';
import { authenticateRealtimeSocket } from './socket-auth.js';
import {
  clearRealtimeServer,
  getRealtimeServer,
  setRealtimeServer,
} from './server-state.js';

let initializationPromise = null;

const buildCorsOrigin = () => realtimeConfig.corsOrigin;

export const initializeRealtime = async (httpServer) => {
  if (!realtimeConfig.enabled) {
    return null;
  }

  if (getRealtimeServer()) {
    return getRealtimeServer();
  }

  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    const io = new Server(httpServer, {
      path: realtimeConfig.path,
      transports: realtimeConfig.transports,
      pingInterval: realtimeConfig.pingIntervalMs,
      pingTimeout: realtimeConfig.pingTimeoutMs,
      cors: {
        origin: buildCorsOrigin(),
        credentials: true,
      },
    });

    await configureRealtimeRedisAdapter(io);

    io.use(authenticateRealtimeSocket);
    registerRealtimeSocketHandlers(io);

    setRealtimeServer(io);

    return io;
  })();

  try {
    return await initializationPromise;
  } finally {
    initializationPromise = null;
  }
};

export const shutdownRealtime = async () => {
  const io = getRealtimeServer();

  if (io) {
    await new Promise((resolve) => {
      io.close(() => resolve());
    });
  }

  clearRealtimeServer();
  resetRealtimeSocketHandlersRuntime();
  await closeRealtimeRedis();
  initializationPromise = null;
};

export const getRealtimeRuntimeStatus = () => ({
  enabled: realtimeConfig.enabled,
  path: realtimeConfig.path,
  transports: realtimeConfig.transports,
  redis: getRealtimeRedisStatus(),
});
