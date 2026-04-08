import { query } from 'express-validator';
import { TICKET_PRIORITY_VALUES } from '../../../constants/ticket-priority.js';
import { buildValidationError } from '../../../shared/middlewares/validate.js';
import {
  buildAllowedReportsQueryValidation,
  REPORT_GROUP_BY_VALUES,
} from '../utils/report-filters.js';

const MAX_REPORT_RANGE_DAYS = 366;

const reportsDateRangeValidation = (req) => {
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
    fromDate <= toDate
  ) {
    const rangeInDays =
      Math.floor((toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000)) +
      1;

    if (rangeInDays > MAX_REPORT_RANGE_DAYS) {
      return [
        buildValidationError('from', 'errors.validation.invalidDateRange'),
      ];
    }

    return [];
  }

  return [
    buildValidationError('from', 'errors.validation.invalidDateRange'),
  ];
};

const baseReportsValidator = [
  buildAllowedReportsQueryValidation(),
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
    .isIn(REPORT_GROUP_BY_VALUES)
    .withMessage('errors.validation.invalidEnum'),
  query('mailboxId')
    .optional()
    .isMongoId()
    .withMessage('errors.validation.invalidId'),
  query('assigneeId')
    .optional()
    .isMongoId()
    .withMessage('errors.validation.invalidId'),
  query('priority')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .isIn(TICKET_PRIORITY_VALUES)
    .withMessage('errors.validation.invalidEnum'),
  query('categoryId')
    .optional()
    .isMongoId()
    .withMessage('errors.validation.invalidId'),
  query('tagId')
    .optional()
    .isMongoId()
    .withMessage('errors.validation.invalidId'),
  reportsDateRangeValidation,
];

export const reportsOverviewValidator = [...baseReportsValidator];
export const reportsTicketsValidator = [...baseReportsValidator];
export const reportsSlaValidator = [...baseReportsValidator];
export const reportsTeamValidator = [...baseReportsValidator];
