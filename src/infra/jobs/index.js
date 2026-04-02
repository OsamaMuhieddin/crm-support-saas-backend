import {
  startBillingWorkers,
  stopBillingWorkers,
} from '../../modules/billing/services/billing-queue.service.js';

export const startJobs = async () => startBillingWorkers();
export const stopJobs = async () => stopBillingWorkers();
