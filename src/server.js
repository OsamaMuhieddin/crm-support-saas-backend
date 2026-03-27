import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import app from './app.js';
import { env } from './config/env.js';
import { connectDB } from './infra/db/mongoose.js';
import { initializeRealtime } from './infra/realtime/index.js';

export const createHttpServer = async () => {
  const httpServer = createServer(app);

  await initializeRealtime(httpServer);

  return httpServer;
};

export const startServer = async () => {
  try {
    await connectDB();
    const httpServer = await createHttpServer();

    httpServer.listen(env.PORT, () =>
      console.log(`Server running on port ${env.PORT}`)
    );

    return httpServer;
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
};

const isMainModule =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  startServer();
}
