import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { File } from '../src/modules/files/models/file.model.js';
import { createLink } from '../src/modules/files/services/file-links.service.js';
import {
  getStorageProvider,
  resetStorageProviderForTests,
  StorageError,
  STORAGE_ERROR_CODES,
} from '../src/infra/storage/index.js';
import { WORKSPACE_ROLES } from '../src/constants/workspace-roles.js';
import {
  captureFallbackEmail,
  extractInviteTokenFromLogs,
  extractOtpCodeFromLogs,
} from './helpers/email-capture.js';
import { patchPlanForTests } from './helpers/billing.js';

const maybeDbTest = globalThis.__DB_TESTS_DISABLED__ ? test.skip : test;

const storageRoot = path.resolve(
  process.env.STORAGE_LOCAL_ROOT || '.tmp/local-storage-test'
);

const signupAndCaptureOtp = async ({
  email,
  password = 'Password123!',
  name = 'Test User',
}) => {
  const { response, logs } = await captureFallbackEmail(() =>
    request(app).post('/api/auth/signup').send({ email, password, name })
  );

  return {
    response,
    code: extractOtpCodeFromLogs(logs),
  };
};

const createVerifiedUser = async ({
  email,
  password = 'Password123!',
  name = 'Test User',
}) => {
  const signup = await signupAndCaptureOtp({ email, password, name });
  expect(signup.response.status).toBe(200);
  expect(signup.code).toBeTruthy();

  const verify = await request(app).post('/api/auth/verify-email').send({
    email,
    code: signup.code,
  });

  expect(verify.status).toBe(200);

  return {
    email,
    password,
    userId: verify.body.user._id,
    accessToken: verify.body.tokens.accessToken,
    workspaceId: verify.body.user.defaultWorkspaceId,
  };
};

const createInviteWithToken = async ({
  workspaceId,
  accessToken,
  email,
  roleKey,
}) => {
  const { response, logs } = await captureFallbackEmail(() =>
    request(app)
      .post(`/api/workspaces/${workspaceId}/invites`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ email, roleKey })
  );

  return {
    response,
    token: extractInviteTokenFromLogs(logs),
  };
};

const createWorkspaceScopedTokenForRole = async ({ owner, roleKey, email }) => {
  const member = await createVerifiedUser({ email });

  const invite = await createInviteWithToken({
    workspaceId: owner.workspaceId,
    accessToken: owner.accessToken,
    email: member.email,
    roleKey,
  });

  expect(invite.response.status).toBe(200);
  expect(invite.token).toBeTruthy();

  const accept = await request(app)
    .post('/api/workspaces/invites/accept')
    .send({
      token: invite.token,
      email: member.email,
    });
  expect(accept.status).toBe(200);

  const login = await request(app).post('/api/auth/login').send({
    email: member.email,
    password: member.password,
  });
  expect(login.status).toBe(200);

  const switched = await request(app)
    .post('/api/workspaces/switch')
    .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
    .send({ workspaceId: owner.workspaceId });

  expect(switched.status).toBe(200);
  expect(switched.body.accessToken).toBeTruthy();

  return {
    accessToken: switched.body.accessToken,
    email: member.email,
  };
};

const uploadTextFile = (
  accessToken,
  filename = 'notes.txt',
  content = 'hello file'
) =>
  request(app)
    .post('/api/files')
    .set('Authorization', `Bearer ${accessToken}`)
    .attach('file', Buffer.from(content), {
      filename,
      contentType: 'text/plain',
    });

afterEach(async () => {
  jest.restoreAllMocks();
  resetStorageProviderForTests();
  await fs.promises.rm(storageRoot, { recursive: true, force: true });
});

describe('Files v1 endpoints', () => {
  maybeDbTest('upload success', async () => {
    const owner = await createVerifiedUser({
      email: 'files-upload-success-owner@example.com',
    });

    const response = await uploadTextFile(
      owner.accessToken,
      'upload-success.txt'
    );

    expect(response.status).toBe(200);
    expect(response.body.messageKey).toBe('success.file.uploaded');
    expect(response.body.file._id).toBeTruthy();
    expect(response.body.file.url).toContain('/api/files/');
    expect(response.body.file.mimeType).toBe('text/plain');
  });

  maybeDbTest('upload forbidden for viewer', async () => {
    const owner = await createVerifiedUser({
      email: 'files-viewer-owner@example.com',
    });

    const viewer = await createWorkspaceScopedTokenForRole({
      owner,
      roleKey: WORKSPACE_ROLES.VIEWER,
      email: 'files-viewer-user@example.com',
    });

    const response = await uploadTextFile(
      viewer.accessToken,
      'viewer-should-fail.txt'
    );

    expect(response.status).toBe(403);
    expect(response.body.messageKey).toBe('errors.auth.forbiddenRole');
  });

  maybeDbTest('upload validation failure for missing file', async () => {
    const owner = await createVerifiedUser({
      email: 'files-upload-missing-owner@example.com',
    });

    const response = await request(app)
      .post('/api/files')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .field('kind', 'attachment');

    expect(response.status).toBe(422);
    expect(response.body.messageKey).toBe('errors.validation.failed');
    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'file',
          messageKey: 'errors.file.empty',
        }),
      ])
    );
  });

  maybeDbTest('upload rejects invalid mime type', async () => {
    const owner = await createVerifiedUser({
      email: 'files-invalid-mime-owner@example.com',
    });

    const response = await request(app)
      .post('/api/files')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .attach('file', Buffer.from('danger'), {
        filename: 'danger.txt',
        contentType: 'application/x-msdownload',
      });

    expect(response.status).toBe(422);
    expect(response.body.messageKey).toBe('errors.validation.failed');
    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'file',
          messageKey: 'errors.file.invalidMimeType',
        }),
      ])
    );
  });

  maybeDbTest('upload rejects invalid extension', async () => {
    const owner = await createVerifiedUser({
      email: 'files-invalid-ext-owner@example.com',
    });

    const response = await request(app)
      .post('/api/files')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .attach('file', Buffer.from('plain text'), {
        filename: 'not-allowed.exe',
        contentType: 'text/plain',
      });

    expect(response.status).toBe(422);
    expect(response.body.messageKey).toBe('errors.validation.failed');
    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'file',
          messageKey: 'errors.file.invalidExtension',
        }),
      ])
    );
  });

  maybeDbTest('get file metadata success', async () => {
    const owner = await createVerifiedUser({
      email: 'files-metadata-owner@example.com',
    });

    const upload = await uploadTextFile(owner.accessToken, 'metadata.txt');
    expect(upload.status).toBe(200);

    const response = await request(app)
      .get(`/api/files/${upload.body.file._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.messageKey).toBe('success.ok');
    expect(response.body.file._id).toBe(upload.body.file._id);
  });

  maybeDbTest('list files with pagination', async () => {
    const owner = await createVerifiedUser({
      email: 'files-list-pagination-owner@example.com',
    });

    await uploadTextFile(owner.accessToken, 'list-1.txt');
    await uploadTextFile(owner.accessToken, 'list-2.txt');

    const response = await request(app)
      .get('/api/files?page=1&limit=1&sort=createdAt')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.page).toBe(1);
    expect(response.body.limit).toBe(1);
    expect(response.body.total).toBe(2);
    expect(response.body.results).toBe(1);
    expect(response.body.files).toHaveLength(1);
  });

  maybeDbTest('list files with safe search filter', async () => {
    const owner = await createVerifiedUser({
      email: 'files-list-search-owner@example.com',
    });

    await uploadTextFile(owner.accessToken, 'alpha-report.txt');
    await uploadTextFile(owner.accessToken, 'beta-report.txt');

    const response = await request(app)
      .get('/api/files?search=alpha')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.files).toHaveLength(1);
    expect(response.body.files[0].originalName).toContain('alpha-report');
  });

  maybeDbTest('list files with entityType only filter', async () => {
    const owner = await createVerifiedUser({
      email: 'files-list-entity-type-owner@example.com',
    });

    const ticketEntityA = new mongoose.Types.ObjectId();
    const ticketEntityB = new mongoose.Types.ObjectId();
    const customerEntity = new mongoose.Types.ObjectId();

    const ticketFileA = await uploadTextFile(owner.accessToken, 'ticket-a.txt');
    const ticketFileB = await uploadTextFile(owner.accessToken, 'ticket-b.txt');
    const customerFile = await uploadTextFile(
      owner.accessToken,
      'customer-a.txt'
    );

    expect(ticketFileA.status).toBe(200);
    expect(ticketFileB.status).toBe(200);
    expect(customerFile.status).toBe(200);

    await createLink({
      workspaceId: owner.workspaceId,
      fileId: ticketFileA.body.file._id,
      entityType: 'ticket',
      entityId: ticketEntityA,
      attachedByUserId: owner.userId,
    });

    await createLink({
      workspaceId: owner.workspaceId,
      fileId: ticketFileB.body.file._id,
      entityType: 'ticket',
      entityId: ticketEntityB,
      attachedByUserId: owner.userId,
    });

    await createLink({
      workspaceId: owner.workspaceId,
      fileId: customerFile.body.file._id,
      entityType: 'customer',
      entityId: customerEntity,
      attachedByUserId: owner.userId,
    });

    const response = await request(app)
      .get('/api/files?entityType=ticket')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(response.status).toBe(200);
    const fileIds = new Set(response.body.files.map((file) => file._id));
    expect(fileIds.has(ticketFileA.body.file._id)).toBe(true);
    expect(fileIds.has(ticketFileB.body.file._id)).toBe(true);
    expect(fileIds.has(customerFile.body.file._id)).toBe(false);
  });

  maybeDbTest('list files with entityType and entityId filter', async () => {
    const owner = await createVerifiedUser({
      email: 'files-list-entity-id-owner@example.com',
    });

    const ticketEntityA = new mongoose.Types.ObjectId();
    const ticketEntityB = new mongoose.Types.ObjectId();

    const ticketFileA = await uploadTextFile(
      owner.accessToken,
      'ticket-only-a.txt'
    );
    const ticketFileB = await uploadTextFile(
      owner.accessToken,
      'ticket-only-b.txt'
    );

    expect(ticketFileA.status).toBe(200);
    expect(ticketFileB.status).toBe(200);

    await createLink({
      workspaceId: owner.workspaceId,
      fileId: ticketFileA.body.file._id,
      entityType: 'ticket',
      entityId: ticketEntityA,
      attachedByUserId: owner.userId,
    });

    await createLink({
      workspaceId: owner.workspaceId,
      fileId: ticketFileB.body.file._id,
      entityType: 'ticket',
      entityId: ticketEntityB,
      attachedByUserId: owner.userId,
    });

    const response = await request(app)
      .get(`/api/files?entityType=ticket&entityId=${ticketEntityA}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.files).toHaveLength(1);
    expect(response.body.files[0]._id).toBe(ticketFileA.body.file._id);
  });

  maybeDbTest(
    'list files pagination and total remain consistent with entity filters',
    async () => {
      const owner = await createVerifiedUser({
        email: 'files-list-entity-pagination-owner@example.com',
      });

      const ticketEntityA = new mongoose.Types.ObjectId();
      const ticketEntityB = new mongoose.Types.ObjectId();
      const ticketEntityC = new mongoose.Types.ObjectId();

      const ticketFileA = await uploadTextFile(owner.accessToken, 'ticket-page-a.txt');
      const ticketFileB = await uploadTextFile(owner.accessToken, 'ticket-page-b.txt');
      const ticketFileC = await uploadTextFile(owner.accessToken, 'ticket-page-c.txt');

      await createLink({
        workspaceId: owner.workspaceId,
        fileId: ticketFileA.body.file._id,
        entityType: 'ticket',
        entityId: ticketEntityA,
        attachedByUserId: owner.userId,
      });
      await createLink({
        workspaceId: owner.workspaceId,
        fileId: ticketFileB.body.file._id,
        entityType: 'ticket',
        entityId: ticketEntityB,
        attachedByUserId: owner.userId,
      });
      await createLink({
        workspaceId: owner.workspaceId,
        fileId: ticketFileC.body.file._id,
        entityType: 'ticket',
        entityId: ticketEntityC,
        attachedByUserId: owner.userId,
      });

      const page1 = await request(app)
        .get('/api/files?entityType=ticket&limit=2&page=1&sort=originalName')
        .set('Authorization', `Bearer ${owner.accessToken}`);
      const page2 = await request(app)
        .get('/api/files?entityType=ticket&limit=2&page=2&sort=originalName')
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(page1.status).toBe(200);
      expect(page1.body.total).toBe(3);
      expect(page1.body.results).toBe(2);
      expect(page2.status).toBe(200);
      expect(page2.body.total).toBe(3);
      expect(page2.body.results).toBe(1);
    }
  );

  maybeDbTest(
    'list files keeps global isLinked while filtering with entityType and isLinked=false',
    async () => {
      const owner = await createVerifiedUser({
        email: 'files-list-entity-type-islinked-false-owner@example.com',
      });

      const ticketEntity = new mongoose.Types.ObjectId();
      const customerEntity = new mongoose.Types.ObjectId();

      const ticketFile = await uploadTextFile(
        owner.accessToken,
        'entity-ticket-linked.txt'
      );
      const customerFile = await uploadTextFile(
        owner.accessToken,
        'entity-customer-linked.txt'
      );
      const unlinkedFile = await uploadTextFile(
        owner.accessToken,
        'entity-unlinked.txt'
      );

      expect(ticketFile.status).toBe(200);
      expect(customerFile.status).toBe(200);
      expect(unlinkedFile.status).toBe(200);

      await createLink({
        workspaceId: owner.workspaceId,
        fileId: ticketFile.body.file._id,
        entityType: 'ticket',
        entityId: ticketEntity,
        attachedByUserId: owner.userId,
      });

      await createLink({
        workspaceId: owner.workspaceId,
        fileId: customerFile.body.file._id,
        entityType: 'customer',
        entityId: customerEntity,
        attachedByUserId: owner.userId,
      });

      const response = await request(app)
        .get('/api/files?entityType=ticket&isLinked=false')
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(response.status).toBe(200);
      const ticketResult = response.body.files.find(
        (file) => file._id === ticketFile.body.file._id
      );
      const customerResult = response.body.files.find(
        (file) => file._id === customerFile.body.file._id
      );
      const unlinkedResult = response.body.files.find(
        (file) => file._id === unlinkedFile.body.file._id
      );

      expect(ticketResult).toBeUndefined();
      expect(customerResult).toBeTruthy();
      expect(customerResult.isLinked).toBe(true);
      expect(unlinkedResult).toBeTruthy();
      expect(unlinkedResult.isLinked).toBe(false);
    }
  );

  maybeDbTest('list files supports originalName sort parity', async () => {
    const owner = await createVerifiedUser({
      email: 'files-list-sort-originalname-owner@example.com',
    });

    await uploadTextFile(owner.accessToken, 'c-name.txt');
    await uploadTextFile(owner.accessToken, 'a-name.txt');
    await uploadTextFile(owner.accessToken, 'b-name.txt');

    const response = await request(app)
      .get('/api/files?sort=originalName')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(response.status).toBe(200);
    const names = response.body.files.map((file) => file.originalName);
    expect(names.slice(0, 3)).toEqual(['a-name.txt', 'b-name.txt', 'c-name.txt']);
  });

  maybeDbTest('list files is workspace isolated', async () => {
    const workspaceAUser = await createVerifiedUser({
      email: 'files-list-workspace-a-owner@example.com',
    });
    const workspaceBUser = await createVerifiedUser({
      email: 'files-list-workspace-b-owner@example.com',
    });

    const uploadA = await uploadTextFile(workspaceAUser.accessToken, 'workspace-a.txt');
    const uploadB = await uploadTextFile(workspaceBUser.accessToken, 'workspace-b.txt');

    expect(uploadA.status).toBe(200);
    expect(uploadB.status).toBe(200);

    const responseA = await request(app)
      .get('/api/files')
      .set('Authorization', `Bearer ${workspaceAUser.accessToken}`);

    expect(responseA.status).toBe(200);
    const idsA = new Set(responseA.body.files.map((file) => file._id));
    expect(idsA.has(uploadA.body.file._id)).toBe(true);
    expect(idsA.has(uploadB.body.file._id)).toBe(false);
  });

  maybeDbTest(
    'list files validation fails when entityId is sent without entityType',
    async () => {
      const owner = await createVerifiedUser({
        email: 'files-list-entity-id-validation-owner@example.com',
      });

      const entityId = new mongoose.Types.ObjectId();
      const response = await request(app)
        .get(`/api/files?entityId=${entityId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(response.status).toBe(422);
      expect(response.body.messageKey).toBe('errors.validation.failed');
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'entityId',
            messageKey: 'errors.validation.entityTypeRequiredWithEntityId',
          }),
        ])
      );
    }
  );

  maybeDbTest('download success', async () => {
    const owner = await createVerifiedUser({
      email: 'files-download-owner@example.com',
    });

    const upload = await uploadTextFile(
      owner.accessToken,
      'download.txt',
      'download-body-content'
    );
    expect(upload.status).toBe(200);

    const response = await request(app)
      .get(`/api/files/${upload.body.file._id}/download`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.headers['content-disposition']).toContain('attachment;');
    expect(response.text).toBe('download-body-content');
  });

  maybeDbTest('download not found for wrong workspace', async () => {
    const owner = await createVerifiedUser({
      email: 'files-download-owner-ws@example.com',
    });

    const outsider = await createVerifiedUser({
      email: 'files-download-outsider@example.com',
    });

    const upload = await uploadTextFile(owner.accessToken, 'private.txt');
    expect(upload.status).toBe(200);

    const response = await request(app)
      .get(`/api/files/${upload.body.file._id}/download`)
      .set('Authorization', `Bearer ${outsider.accessToken}`);

    expect(response.status).toBe(404);
    expect(response.body.messageKey).toBe('errors.file.notFound');
  });

  maybeDbTest('delete success', async () => {
    const owner = await createVerifiedUser({
      email: 'files-delete-owner@example.com',
    });

    const upload = await uploadTextFile(
      owner.accessToken,
      'delete-success.txt'
    );
    expect(upload.status).toBe(200);

    const response = await request(app)
      .delete(`/api/files/${upload.body.file._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.messageKey).toBe('success.file.deleted');
    expect(response.body.alreadyDeleted).toBe(false);

    const fileRecord = await File.findById(upload.body.file._id);
    expect(fileRecord.deletedAt).toBeTruthy();
    expect(fileRecord.storageStatus).toBe('deleted');
  });

  maybeDbTest('delete forbidden for agent', async () => {
    const owner = await createVerifiedUser({
      email: 'files-delete-agent-owner@example.com',
    });

    const agent = await createWorkspaceScopedTokenForRole({
      owner,
      roleKey: WORKSPACE_ROLES.AGENT,
      email: 'files-delete-agent-user@example.com',
    });

    const upload = await uploadTextFile(
      owner.accessToken,
      'agent-cannot-delete.txt'
    );
    expect(upload.status).toBe(200);

    const response = await request(app)
      .delete(`/api/files/${upload.body.file._id}`)
      .set('Authorization', `Bearer ${agent.accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.messageKey).toBe('errors.auth.forbiddenRole');
  });

  maybeDbTest(
    'upload compensation cleanup runs when db save fails',
    async () => {
      const owner = await createVerifiedUser({
        email: 'files-compensation-owner@example.com',
      });

      const storage = getStorageProvider();
      const deleteSpy = jest.spyOn(storage, 'deleteObject');
      jest.spyOn(File, 'create').mockRejectedValueOnce(new Error('db-failure'));

      const response = await uploadTextFile(
        owner.accessToken,
        'compensation.txt'
      );

      expect(response.status).toBe(502);
      expect(response.body.messageKey).toBe('errors.file.uploadFailed');
      expect(deleteSpy).toHaveBeenCalledTimes(1);
    }
  );

  maybeDbTest('upload handles storage unavailability', async () => {
    const owner = await createVerifiedUser({
      email: 'files-storage-error-owner@example.com',
    });

    const storage = getStorageProvider();
    jest
      .spyOn(storage, 'uploadObject')
      .mockRejectedValueOnce(
        new StorageError(STORAGE_ERROR_CODES.UNAVAILABLE, 'storage is down')
      );

    const response = await uploadTextFile(
      owner.accessToken,
      'storage-error.txt'
    );

    expect(response.status).toBe(503);
    expect(response.body.messageKey).toBe('errors.file.storageUnavailable');
  });

  maybeDbTest('upload is blocked when storage byte limit would be exceeded', async () => {
    const owner = await createVerifiedUser({
      email: 'files-storage-limit-owner@example.com',
    });

    await patchPlanForTests({
      planKey: 'starter',
      limits: {
        storageBytes: 3,
      },
    });

    const response = await uploadTextFile(
      owner.accessToken,
      'storage-limit.txt',
      '1234'
    );

    expect(response.status).toBe(409);
    expect(response.body.messageKey).toBe(
      'errors.billing.storageLimitExceeded'
    );
  });

  maybeDbTest('upload is blocked when monthly upload limit is reached', async () => {
    const owner = await createVerifiedUser({
      email: 'files-monthly-upload-limit-owner@example.com',
    });

    await patchPlanForTests({
      planKey: 'starter',
      limits: {
        uploadsPerMonth: 1,
      },
    });

    const first = await uploadTextFile(owner.accessToken, 'monthly-one.txt');
    expect(first.status).toBe(200);

    const second = await uploadTextFile(owner.accessToken, 'monthly-two.txt');
    expect(second.status).toBe(409);
    expect(second.body.messageKey).toBe(
      'errors.billing.uploadLimitExceeded'
    );
  });

  maybeDbTest('delete decrements current storage usage but does not decrement uploads this period', async () => {
    const owner = await createVerifiedUser({
      email: 'files-delete-usage-owner@example.com',
    });

    const upload = await uploadTextFile(
      owner.accessToken,
      'usage-delete.txt',
      'hello usage'
    );
    expect(upload.status).toBe(200);

    const usageAfterUpload = await request(app)
      .get('/api/billing/usage')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(usageAfterUpload.status).toBe(200);
    expect(usageAfterUpload.body.usage.current.storageBytes).toBeGreaterThan(0);
    expect(usageAfterUpload.body.usage.monthly.uploadsCount).toBe(1);

    const deleted = await request(app)
      .delete(`/api/files/${upload.body.file._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(deleted.status).toBe(200);

    const usageAfterDelete = await request(app)
      .get('/api/billing/usage')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(usageAfterDelete.status).toBe(200);
    expect(usageAfterDelete.body.usage.current.storageBytes).toBe(0);
    expect(usageAfterDelete.body.usage.monthly.uploadsCount).toBe(1);
  });
});
