import { Router } from 'express';
import { WORKSPACE_ROLES } from '../../../constants/workspace-roles.js';
import requireActiveMember from '../../../shared/middlewares/requireActiveMember.js';
import requireActiveUser from '../../../shared/middlewares/requireActiveUser.js';
import requireAuth from '../../../shared/middlewares/requireAuth.js';
import requireWorkspaceRole from '../../../shared/middlewares/requireWorkspaceRole.js';
import validate from '../../../shared/middlewares/validate.js';
import {
  changeBillingPlanController,
  createBillingCheckoutSessionController,
  createBillingPortalSessionController,
  getBillingCatalogController,
  getBillingEntitlementsController,
  getBillingSubscriptionController,
  getBillingSummaryController,
  getBillingUsageController,
  stripeWebhookController,
  updateBillingAddonsController
} from '../controllers/billing.controller.js';
import {
  billingAddonUpdateValidator,
  billingCatalogValidator,
  billingCheckoutSessionValidator,
  billingEntitlementsValidator,
  billingPlanChangeValidator,
  billingPortalSessionValidator,
  billingSubscriptionValidator,
  billingSummaryValidator,
  billingStripeWebhookValidator,
  billingUsageValidator
} from '../validators/billing.validators.js';

const router = Router();

router.post(
  '/webhooks/stripe',
  validate(billingStripeWebhookValidator),
  stripeWebhookController
);

router.use(requireAuth, requireActiveUser, requireActiveMember);
router.use(requireWorkspaceRole(WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN));

router.get('/catalog', validate(billingCatalogValidator), getBillingCatalogController);
router.get(
  '/subscription',
  validate(billingSubscriptionValidator),
  getBillingSubscriptionController
);
router.get(
  '/entitlements',
  validate(billingEntitlementsValidator),
  getBillingEntitlementsController
);
router.get('/usage', validate(billingUsageValidator), getBillingUsageController);
router.get('/summary', validate(billingSummaryValidator), getBillingSummaryController);
router.post(
  '/checkout-session',
  validate(billingCheckoutSessionValidator),
  createBillingCheckoutSessionController
);
router.post(
  '/portal-session',
  validate(billingPortalSessionValidator),
  createBillingPortalSessionController
);
router.post(
  '/change-plan',
  validate(billingPlanChangeValidator),
  changeBillingPlanController
);
router.post(
  '/update-addons',
  validate(billingAddonUpdateValidator),
  updateBillingAddonsController
);

export default router;
