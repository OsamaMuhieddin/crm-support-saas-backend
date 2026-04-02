import { BILLING_JOB, BILLING_QUEUE } from '../../../constants/billing-job.js';
import {
  closeBullMqResources,
  createBullMqQueue,
  createBullMqWorker,
  isBullMqEnabled
} from '../../../infra/jobs/bullmq.js';
import {
  processBillingWebhookEventById,
  replayPendingBillingWebhookEvents,
  recomputeWorkspaceBillingRepair,
  syncWorkspaceBillingLifecycle
} from './billing-sync.service.js';

const queueRegistry = new Map();
const workerRegistry = new Map();
const BILLING_REPLAY_SWEEP_EVERY_MS = 60 * 60 * 1000;
const BILLING_REPLAY_SWEEP_PENDING_STALE_MINUTES = 5;
const BILLING_REPLAY_SWEEP_LIMIT = 50;
const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: {
    type: 'exponential',
    delay: 1000
  },
  removeOnComplete: 500,
  removeOnFail: 1000
};

const getQueue = (queueName) => {
  if (!queueRegistry.has(queueName)) {
    const queue = createBullMqQueue({
      name: queueName,
      defaultJobOptions: DEFAULT_JOB_OPTIONS
    });

    queueRegistry.set(queueName, queue);
  }

  return queueRegistry.get(queueName);
};

const addJob = async ({ queueName, jobName, data, jobId, delay = 0 }) => {
  const queue = getQueue(queueName);
  if (!queue) {
    return {
      enqueued: false,
      job: null,
      reason: 'queue_unavailable'
    };
  }

  if (jobId) {
    const existingJob = await queue.getJob(jobId);
    if (existingJob) {
      return {
        enqueued: true,
        job: existingJob,
        deduplicated: true
      };
    }
  }

  const job = await queue.add(jobName, data, {
    jobId,
    delay
  });

  return {
    enqueued: true,
    job
  };
};

export const enqueueBillingWebhookEvent = async ({ webhookEventId }) =>
  addJob({
    queueName: BILLING_QUEUE.WEBHOOKS,
    jobName: BILLING_JOB.PROCESS_WEBHOOK_EVENT,
    jobId: `billing:webhook:${webhookEventId}`,
    data: { webhookEventId }
  });

export const enqueueWorkspaceLifecycleSync = async ({ workspaceId, delay = 0 }) =>
  addJob({
    queueName: BILLING_QUEUE.LIFECYCLE,
    jobName: BILLING_JOB.SYNC_WORKSPACE_LIFECYCLE,
    jobId: `billing:lifecycle:${workspaceId}`,
    data: { workspaceId },
    delay
  });

export const enqueueWorkspaceEntitlementRepair = async ({ workspaceId, delay = 0 }) =>
  addJob({
    queueName: BILLING_QUEUE.REPAIR,
    jobName: BILLING_JOB.RECOMPUTE_WORKSPACE_ENTITLEMENTS,
    jobId: `billing:repair:${workspaceId}`,
    data: { workspaceId },
    delay
  });

const registerScheduledRepairJobs = async () => {
  const queue = getQueue(BILLING_QUEUE.REPAIR);

  if (!queue) {
    return null;
  }

  return queue.upsertJobScheduler(
    'billing:repair:scan-pending-webhook-events',
    {
      every: BILLING_REPLAY_SWEEP_EVERY_MS
    },
    {
      name: BILLING_JOB.SCAN_PENDING_WEBHOOK_EVENTS,
      data: {
        limit: BILLING_REPLAY_SWEEP_LIMIT,
        pendingOlderThanMinutes: BILLING_REPLAY_SWEEP_PENDING_STALE_MINUTES
      },
      opts: DEFAULT_JOB_OPTIONS
    }
  );
};

const processWebhookJob = async (job) => {
  if (job.name !== BILLING_JOB.PROCESS_WEBHOOK_EVENT) {
    return { ignored: true };
  }

  return processBillingWebhookEventById({
    webhookEventId: job.data?.webhookEventId
  });
};

const processLifecycleJob = async (job) => {
  if (job.name !== BILLING_JOB.SYNC_WORKSPACE_LIFECYCLE) {
    return { ignored: true };
  }

  return syncWorkspaceBillingLifecycle({
    workspaceId: job.data?.workspaceId
  });
};

const processRepairJob = async (job) => {
  if (job.name === BILLING_JOB.SCAN_PENDING_WEBHOOK_EVENTS) {
    return replayPendingBillingWebhookEvents({
      limit: job.data?.limit || BILLING_REPLAY_SWEEP_LIMIT,
      pendingOlderThanMinutes:
        job.data?.pendingOlderThanMinutes ??
        BILLING_REPLAY_SWEEP_PENDING_STALE_MINUTES
    });
  }

  if (job.name === BILLING_JOB.REPLAY_WEBHOOK_EVENT) {
    return processBillingWebhookEventById({
      webhookEventId: job.data?.webhookEventId
    });
  }

  if (job.name !== BILLING_JOB.RECOMPUTE_WORKSPACE_ENTITLEMENTS) {
    return { ignored: true };
  }

  return recomputeWorkspaceBillingRepair({
    workspaceId: job.data?.workspaceId
  });
};

const startNamedWorker = (queueName, processor) => {
  if (!isBullMqEnabled()) {
    return null;
  }

  if (!workerRegistry.has(queueName)) {
    const worker = createBullMqWorker({
      name: queueName,
      processor
    });

    workerRegistry.set(queueName, worker);
  }

  return workerRegistry.get(queueName);
};

export const startBillingWorkers = async () => {
  if (!isBullMqEnabled()) {
    return [];
  }

  await registerScheduledRepairJobs();

  const workers = [
    startNamedWorker(BILLING_QUEUE.WEBHOOKS, processWebhookJob),
    startNamedWorker(BILLING_QUEUE.LIFECYCLE, processLifecycleJob),
    startNamedWorker(BILLING_QUEUE.REPAIR, processRepairJob)
  ].filter(Boolean);

  return workers;
};

export const stopBillingWorkers = async () => {
  workerRegistry.clear();
  queueRegistry.clear();
  await closeBullMqResources();
};

export const getBillingQueueRuntime = () => ({
  enabled: isBullMqEnabled(),
  queues: Object.values(BILLING_QUEUE)
});
