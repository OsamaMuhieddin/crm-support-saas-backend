import mongoose from 'mongoose';
import { connectDB } from '../infra/db/mongoose.js';
import { startBillingWorkers, stopBillingWorkers } from '../modules/billing/services/billing-queue.service.js';

let shuttingDown = false;

const shutdown = async (signal) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.info(`[billing:worker] shutting down (${signal})`);

  try {
    await stopBillingWorkers();
    await mongoose.disconnect();
  } catch (error) {
    console.error('[billing:worker] shutdown failed', error);
    process.exit(1);
  }

  process.exit(0);
};

const run = async () => {
  try {
    await connectDB();
    const workers = await startBillingWorkers();

    if (workers.length === 0) {
      console.warn(
        '[billing:worker] Redis is disabled or unavailable. No billing workers started.'
      );
    } else {
      console.info(`[billing:worker] started ${workers.length} billing workers`);
    }

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    console.error('[billing:worker] failed', error);

    try {
      await stopBillingWorkers();
      await mongoose.disconnect();
    } catch (disconnectError) {
      // best-effort cleanup
    }

    process.exit(1);
  }
};

run();
