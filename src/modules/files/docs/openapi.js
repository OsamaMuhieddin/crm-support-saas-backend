import {
  arrayOf,
  binaryResponse,
  booleanSchema,
  commonErrorResponses,
  idSchema,
  integerSchema,
  multipartRequest,
  objectSchema,
  operation,
  pathIdParam,
  queryParam,
  ref,
  stringSchema,
} from '../../../docs/openapi/helpers.js';

export const filesOpenApiPaths = {
  '/files': {
    post: operation({
      tags: 'Files',
      summary: 'Upload file',
      operationId: 'uploadFile',
      description:
        'Purpose: upload one file to workspace storage. Authorization: owner, admin, or agent roleKey required. The file is stored privately; public object URLs are not exposed.',
      requestBody: multipartRequest(
        {
          file: stringSchema({ format: 'binary' }),
          kind: stringSchema({ minLength: 1, maxLength: 64 }),
          source: stringSchema({ minLength: 1, maxLength: 64 }),
        },
        ['file']
      ),
      success: {
        messageKey: 'success.file.uploaded',
        payload: {
          file: ref('File'),
        },
      },
      errors: ['401', '403', '422', '429', '500', '502'],
    }),
    get: operation({
      tags: 'Files',
      summary: 'List files',
      operationId: 'listFiles',
      description:
        'Purpose: list workspace file metadata. Viewers can read files they are allowed to see. Anti-enumeration: list results are scoped to the active workspace.',
      parameters: [
        queryParam('page', integerSchema({ minimum: 1 })),
        queryParam('limit', integerSchema({ minimum: 1, maximum: 100 })),
        queryParam('search', stringSchema({ minLength: 1, maxLength: 120 })),
        queryParam('mimeType', stringSchema()),
        queryParam('extension', stringSchema({ pattern: '^\\.[a-z0-9]+$' })),
        queryParam('uploadedByUserId', idSchema('Uploader user id.')),
        queryParam('kind', stringSchema({ minLength: 1, maxLength: 64 })),
        queryParam('isLinked', booleanSchema()),
        queryParam('entityType', stringSchema({ minLength: 1, maxLength: 64 })),
        queryParam(
          'entityId',
          idSchema('Linked entity id. Requires entityType.')
        ),
        queryParam('createdFrom', stringSchema({ format: 'date-time' })),
        queryParam('createdTo', stringSchema({ format: 'date-time' })),
        queryParam(
          'sort',
          stringSchema({
            enum: [
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
            ],
          })
        ),
      ],
      success: {
        payload: {
          page: integerSchema({ minimum: 1 }),
          limit: integerSchema({ minimum: 1 }),
          total: integerSchema({ minimum: 0 }),
          results: integerSchema({ minimum: 0 }),
          files: arrayOf(ref('File')),
        },
      },
    }),
  },
  '/files/{fileId}': {
    get: operation({
      tags: 'Files',
      summary: 'Get file metadata',
      operationId: 'getFileMetadata',
      description:
        'Purpose: return file metadata. Anti-enumeration: missing and cross-workspace files collapse to not found.',
      parameters: [pathIdParam('fileId', 'File id.')],
      success: {
        payload: {
          file: ref('File'),
        },
      },
      errors: ['401', '403', '404', '422', '500'],
    }),
    delete: operation({
      tags: 'Files',
      summary: 'Delete file',
      operationId: 'deleteFile',
      description:
        'Purpose: soft-delete a file and related links when allowed. Authorization: owner or admin roleKey required. Action response is compact.',
      parameters: [pathIdParam('fileId', 'File id.')],
      success: {
        messageKey: 'success.file.deleted',
        payload: {
          file: ref('FileDeleteAction'),
        },
      },
      errors: ['401', '403', '404', '409', '422', '500'],
    }),
  },
  '/files/{fileId}/download': {
    get: operation({
      tags: 'Files',
      summary: 'Download file',
      operationId: 'downloadFile',
      description:
        'Purpose: backend-stream a private file download. This route returns binary content instead of the normal JSON success envelope. Anti-enumeration: missing and cross-workspace files collapse to not found.',
      parameters: [pathIdParam('fileId', 'File id.')],
      responses: {
        200: binaryResponse(
          'File stream. Content-Type matches stored file metadata.',
          [
            'application/octet-stream',
            'image/png',
            'image/jpeg',
            'application/pdf',
          ]
        ),
        ...commonErrorResponses([
          '401',
          '403',
          '404',
          '422',
          '429',
          '500',
          '502',
        ]),
      },
    }),
  },
};
