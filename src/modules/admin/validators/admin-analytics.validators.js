import { query } from 'express-validator';
import { buildValidationError } from '../../../shared/middlewares/validate.js';
import {
  ADMIN_METRICS_ALLOWED_QUERY_FIELDS,
  ADMIN_METRICS_GROUP_BY_VALUES,
} from '../utils/admin-analytics-filters.js';

const MAX_METRICS_RANGE_DAYS = 366;

const buildAllowedAdminAnalyticsQueryValidation =
  (allowedFields = []) =>
  (req) => {
    const unknownFields = Object.keys(req.query || {}).filter(
      (field) => !allowedFields.includes(field)
    );

    return unknownFields.map((field) =>
      buildValidationError(field, 'errors.validation.unknownField')
    );
  };

const adminMetricsDateRangeValidation = (req) => {
  const fromValue = req.query?.from;
  const toValue = req.query?.to;

  if (!fromValue || !toValue) {
    return [];
  }

  const fromDate = new Date(fromValue);
  const toDate = new Date(toValue);

  if (
    Number.isNaN(fromDate.getTime()) ||
    Number.isNaN(toDate.getTime()) ||
    fromDate > toDate
  ) {
    return [
      buildValidationError('from', 'errors.validation.invalidDateRange'),
    ];
  }

  const diffDays = Math.floor(
    (toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000)
  );

  if (diffDays > MAX_METRICS_RANGE_DAYS) {
    return [
      buildValidationError('from', 'errors.validation.invalidDateRange'),
    ];
  }

  return [];
};

export const adminOverviewValidator = [
  buildAllowedAdminAnalyticsQueryValidation([]),
];

export const adminBillingOverviewValidator = [
  buildAllowedAdminAnalyticsQueryValidation([]),
];

export const adminMetricsValidator = [
  buildAllowedAdminAnalyticsQueryValidation(
    ADMIN_METRICS_ALLOWED_QUERY_FIELDS
  ),
  query('from')
    .optional()
    .isISO8601()
    .withMessage('errors.validation.invalidDate'),
  query('to')
    .optional()
    .isISO8601()
    .withMessage('errors.validation.invalidDate'),
  query('groupBy')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .isIn(ADMIN_METRICS_GROUP_BY_VALUES)
    .withMessage('errors.validation.invalidEnum'),
  adminMetricsDateRangeValidation,
];
