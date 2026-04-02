export const BILLING_QUEUE = Object.freeze({
  WEBHOOKS: 'billing-webhooks',
  LIFECYCLE: 'billing-lifecycle',
  REPAIR: 'billing-repair',
});

export const BILLING_JOB = Object.freeze({
  PROCESS_WEBHOOK_EVENT: 'process-webhook-event',
  SYNC_WORKSPACE_LIFECYCLE: 'sync-workspace-lifecycle',
  RECOMPUTE_WORKSPACE_ENTITLEMENTS: 'recompute-workspace-entitlements',
  REPLAY_WEBHOOK_EVENT: 'replay-webhook-event',
  SCAN_PENDING_WEBHOOK_EVENTS: 'scan-pending-webhook-events',
});
