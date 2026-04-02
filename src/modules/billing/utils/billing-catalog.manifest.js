import { billingConfig } from '../../../config/billing.config.js';
import { BILLING_ADDON_TYPE } from '../../../constants/billing-addon-type.js';
import {
  BILLING_ADDON_EFFECT_KEYS,
  BILLING_ADDON_KEYS,
  BILLING_PLAN_FEATURE_KEYS,
  BILLING_PLAN_LIMIT_KEYS
} from './billing-canonical.js';

const gb = (value) => value * 1024 * 1024 * 1024;
const mb = (value) => value * 1024 * 1024;

export const BILLING_CATALOG_DEFAULT_PLAN_KEY = 'starter';

export const billingCatalogManifest = Object.freeze({
  version: billingConfig.catalogVersion,
  provider: billingConfig.provider,
  currency: billingConfig.currency,
  defaultPlanKey: BILLING_CATALOG_DEFAULT_PLAN_KEY,
  plans: [
    {
      key: 'starter',
      name: 'Starter',
      price: 29,
      currency: billingConfig.currency,
      sortOrder: 1,
      limits: {
        [BILLING_PLAN_LIMIT_KEYS.SEATS_INCLUDED]: 1,
        [BILLING_PLAN_LIMIT_KEYS.MAILBOXES]: 1,
        [BILLING_PLAN_LIMIT_KEYS.STORAGE_BYTES]: mb(5),
        [BILLING_PLAN_LIMIT_KEYS.UPLOADS_PER_MONTH]: 2,
        [BILLING_PLAN_LIMIT_KEYS.TICKETS_PER_MONTH]: 3
      },
      features: {
        [BILLING_PLAN_FEATURE_KEYS.BILLING_ENABLED]: true,
        [BILLING_PLAN_FEATURE_KEYS.PORTAL_ENABLED]: true,
        [BILLING_PLAN_FEATURE_KEYS.CHECKOUT_ENABLED]: true,
        [BILLING_PLAN_FEATURE_KEYS.SLA_ENABLED]: false
      },
      providerMetadata: {
        stripe: {
          priceId: billingConfig.stripe.prices.starter
        }
      }
    },
    {
      key: 'growth',
      name: 'Growth',
      price: 79,
      currency: billingConfig.currency,
      sortOrder: 2,
      limits: {
        [BILLING_PLAN_LIMIT_KEYS.SEATS_INCLUDED]: 10,
        [BILLING_PLAN_LIMIT_KEYS.MAILBOXES]: 3,
        [BILLING_PLAN_LIMIT_KEYS.STORAGE_BYTES]: gb(25),
        [BILLING_PLAN_LIMIT_KEYS.UPLOADS_PER_MONTH]: 3000,
        [BILLING_PLAN_LIMIT_KEYS.TICKETS_PER_MONTH]: 8000
      },
      features: {
        [BILLING_PLAN_FEATURE_KEYS.BILLING_ENABLED]: true,
        [BILLING_PLAN_FEATURE_KEYS.PORTAL_ENABLED]: true,
        [BILLING_PLAN_FEATURE_KEYS.CHECKOUT_ENABLED]: true,
        [BILLING_PLAN_FEATURE_KEYS.SLA_ENABLED]: true
      },
      providerMetadata: {
        stripe: {
          priceId: billingConfig.stripe.prices.growth
        }
      }
    },
    {
      key: 'business',
      name: 'Business',
      price: 199,
      currency: billingConfig.currency,
      sortOrder: 3,
      limits: {
        [BILLING_PLAN_LIMIT_KEYS.SEATS_INCLUDED]: 25,
        [BILLING_PLAN_LIMIT_KEYS.MAILBOXES]: 10,
        [BILLING_PLAN_LIMIT_KEYS.STORAGE_BYTES]: gb(100),
        [BILLING_PLAN_LIMIT_KEYS.UPLOADS_PER_MONTH]: 8000,
        [BILLING_PLAN_LIMIT_KEYS.TICKETS_PER_MONTH]: 20000
      },
      features: {
        [BILLING_PLAN_FEATURE_KEYS.BILLING_ENABLED]: true,
        [BILLING_PLAN_FEATURE_KEYS.PORTAL_ENABLED]: true,
        [BILLING_PLAN_FEATURE_KEYS.CHECKOUT_ENABLED]: true,
        [BILLING_PLAN_FEATURE_KEYS.SLA_ENABLED]: true
      },
      providerMetadata: {
        stripe: {
          priceId: billingConfig.stripe.prices.business
        }
      }
    }
  ],
  addons: [
    {
      key: BILLING_ADDON_KEYS.EXTRA_SEAT,
      name: 'Extra Seat',
      type: BILLING_ADDON_TYPE.SEAT,
      price: 12,
      currency: billingConfig.currency,
      sortOrder: 1,
      effects: {
        [BILLING_ADDON_EFFECT_KEYS.SEATS]: 1
      },
      providerMetadata: {
        stripe: {
          priceId: billingConfig.stripe.prices.extra_seat
        }
      }
    },
    {
      key: BILLING_ADDON_KEYS.EXTRA_STORAGE,
      name: 'Extra Storage',
      type: BILLING_ADDON_TYPE.USAGE,
      price: 10,
      currency: billingConfig.currency,
      sortOrder: 2,
      effects: {
        [BILLING_ADDON_EFFECT_KEYS.STORAGE_BYTES]: mb(5)
      },
      providerMetadata: {
        stripe: {
          priceId: billingConfig.stripe.prices.extra_storage
        }
      }
    }
  ]
});
