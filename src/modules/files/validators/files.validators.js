import { body, param, query } from 'express-validator';
import { filesConfig } from '../../../config/files.config.js';
import { buildValidationError } from '../../../shared/middlewares/validate.js';
import { getFileExtension } from '../../../shared/utils/filename.js';

const sortAllowlist = [
  'createdAt',
  '-createdAt',
  'sizeBytes',
  '-sizeBytes',
  'originalName',
  '-originalName',
  'downloadCount',
  '-downloadCount',
  'lastAccessedAt',
  '-lastAccessedAt',
];

const toMime = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();
const toExtension = (value) => {
  const ext = String(value || '')
    .trim()
    .toLowerCase();
  return ext.startsWith('.') ? ext : `.${ext}`;
};

export const uploadFileValidation = (req) => {
  const errors = [];
  const file = req.file;

  if (!file) {
    errors.push(buildValidationError('file', 'errors.file.empty'));
    return errors;
  }

  if (!file.size || file.size <= 0) {
    errors.push(buildValidationError('file', 'errors.file.empty'));
  }

  const mimeType = toMime(file.mimetype);
  if (!filesConfig.allowedMimeTypes.includes(mimeType)) {
    errors.push(buildValidationError('file', 'errors.file.invalidMimeType'));
  }

  const extension = getFileExtension(file.originalname);
  if (!extension || !filesConfig.allowedExtensions.includes(extension)) {
    errors.push(buildValidationError('file', 'errors.file.invalidExtension'));
  }

  return errors;
};

export const uploadFileBodyValidator = [
  body('kind')
    .optional()
    .isString()
    .withMessage('errors.validation.failed')
    .trim()
    .isLength({ min: 1, max: 64 })
    .withMessage('errors.validation.failed'),
  body('source')
    .optional()
    .isString()
    .withMessage('errors.validation.failed')
    .trim()
    .isLength({ min: 1, max: 64 })
    .withMessage('errors.validation.failed'),
];

export const listFilesValidator = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('errors.validation.failed')
    .toInt(),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('errors.validation.failed')
    .toInt(),
  query('search')
    .optional()
    .isString()
    .withMessage('errors.validation.failed')
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage('errors.validation.failed'),
  query('mimeType')
    .optional()
    .isString()
    .withMessage('errors.validation.failed')
    .trim()
    .customSanitizer((value) => toMime(value)),
  query('extension')
    .optional()
    .isString()
    .withMessage('errors.validation.failed')
    .trim()
    .customSanitizer((value) => toExtension(value))
    .matches(/^\.[a-z0-9]+$/)
    .withMessage('errors.validation.failed'),
  query('uploadedByUserId')
    .optional()
    .isMongoId()
    .withMessage('errors.validation.failed'),
  query('kind')
    .optional()
    .isString()
    .withMessage('errors.validation.failed')
    .trim()
    .isLength({ min: 1, max: 64 })
    .withMessage('errors.validation.failed'),
  query('isLinked')
    .optional()
    .isBoolean()
    .withMessage('errors.validation.failed'),
  query('entityType')
    .optional()
    .isString()
    .withMessage('errors.validation.failed')
    .trim()
    .isLength({ min: 1, max: 64 })
    .withMessage('errors.validation.failed'),
  query('entityId')
    .optional()
    .isMongoId()
    .withMessage('errors.validation.failed')
    .custom((value, { req }) => {
      if (!value) {
        return true;
      }

      if (!req.query.entityType) {
        throw new Error('errors.validation.failed');
      }

      return true;
    })
    .withMessage('errors.validation.failed'),
  query('createdFrom')
    .optional()
    .isISO8601()
    .withMessage('errors.validation.failed'),
  query('createdTo')
    .optional()
    .isISO8601()
    .withMessage('errors.validation.failed'),
  query('sort')
    .optional()
    .isString()
    .withMessage('errors.validation.failed')
    .isIn(sortAllowlist)
    .withMessage('errors.validation.failed'),
];

export const fileByIdValidator = [
  param('fileId').isMongoId().withMessage('errors.validation.failed'),
];
