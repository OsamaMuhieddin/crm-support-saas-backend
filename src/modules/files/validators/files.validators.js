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
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 64 })
    .withMessage('errors.validation.lengthRange'),
  body('source')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 64 })
    .withMessage('errors.validation.lengthRange'),
];

export const listFilesValidator = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('errors.validation.invalidNumber')
    .toInt(),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('errors.validation.invalidNumber')
    .toInt(),
  query('search')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage('errors.validation.lengthRange'),
  query('mimeType')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .customSanitizer((value) => toMime(value)),
  query('extension')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .customSanitizer((value) => toExtension(value))
    .matches(/^\.[a-z0-9]+$/)
    .withMessage('errors.validation.invalid'),
  query('uploadedByUserId')
    .optional()
    .isMongoId()
    .withMessage('errors.validation.invalidId'),
  query('kind')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 64 })
    .withMessage('errors.validation.lengthRange'),
  query('isLinked')
    .optional()
    .isBoolean()
    .withMessage('errors.validation.invalidBoolean'),
  query('entityType')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .trim()
    .isLength({ min: 1, max: 64 })
    .withMessage('errors.validation.lengthRange'),
  query('entityId')
    .optional()
    .isMongoId()
    .withMessage('errors.validation.invalidId')
    .custom((value, { req }) => {
      if (!value) {
        return true;
      }

      if (!req.query.entityType) {
        throw new Error('errors.validation.entityTypeRequiredWithEntityId');
      }

      return true;
    }),
  query('createdFrom')
    .optional()
    .isISO8601()
    .withMessage('errors.validation.invalidDate'),
  query('createdTo')
    .optional()
    .isISO8601()
    .withMessage('errors.validation.invalidDate'),
  query('sort')
    .optional()
    .isString()
    .withMessage('errors.validation.invalid')
    .isIn(sortAllowlist)
    .withMessage('errors.validation.invalidEnum'),
];

export const fileByIdValidator = [
  param('fileId').isMongoId().withMessage('errors.validation.invalidId'),
];
