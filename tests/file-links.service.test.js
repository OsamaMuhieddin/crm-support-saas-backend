import mongoose from 'mongoose';
import { createLink } from '../src/modules/files/services/file-links.service.js';
import { FileLink } from '../src/modules/files/models/file-link.model.js';

const maybeDbTest = globalThis.__DB_TESTS_DISABLED__ ? test.skip : test;

describe('file-links.service createLink', () => {
  maybeDbTest('active existing link is reused', async () => {
    const workspaceId = new mongoose.Types.ObjectId();
    const fileId = new mongoose.Types.ObjectId();
    const entityId = new mongoose.Types.ObjectId();
    const originalAttachedByUserId = new mongoose.Types.ObjectId();
    const secondAttachedByUserId = new mongoose.Types.ObjectId();

    const existing = await FileLink.create({
      workspaceId,
      fileId,
      entityType: 'ticket',
      entityId,
      relationType: null,
      attachedByUserId: originalAttachedByUserId,
    });

    const result = await createLink({
      workspaceId,
      fileId,
      entityType: 'ticket',
      entityId,
      attachedByUserId: secondAttachedByUserId,
    });

    expect(result.link._id).toBe(String(existing._id));
    expect(await FileLink.countDocuments({ workspaceId, fileId })).toBe(1);
  });

  maybeDbTest('most recent deleted matching link is revived', async () => {
    const workspaceId = new mongoose.Types.ObjectId();
    const fileId = new mongoose.Types.ObjectId();
    const entityId = new mongoose.Types.ObjectId();
    const oldAttachedByUserId = new mongoose.Types.ObjectId();
    const newerAttachedByUserId = new mongoose.Types.ObjectId();
    const revivedAttachedByUserId = new mongoose.Types.ObjectId();
    const deletedByUserId = new mongoose.Types.ObjectId();

    const olderDeleted = await FileLink.create({
      workspaceId,
      fileId,
      entityType: 'ticket',
      entityId,
      relationType: null,
      attachedByUserId: oldAttachedByUserId,
      deletedAt: new Date('2025-01-01T00:00:00.000Z'),
      deletedByUserId,
    });

    const newerDeleted = await FileLink.create({
      workspaceId,
      fileId,
      entityType: 'ticket',
      entityId,
      relationType: null,
      attachedByUserId: newerAttachedByUserId,
      deletedAt: new Date('2025-02-01T00:00:00.000Z'),
      deletedByUserId,
    });

    const result = await createLink({
      workspaceId,
      fileId,
      entityType: 'ticket',
      entityId,
      attachedByUserId: revivedAttachedByUserId,
    });

    expect(result.link._id).toBe(String(newerDeleted._id));

    const revived = await FileLink.findById(newerDeleted._id);
    expect(revived.deletedAt).toBeNull();
    expect(revived.deletedByUserId).toBeNull();
    expect(String(revived.attachedByUserId)).toBe(
      String(revivedAttachedByUserId)
    );

    const stillDeleted = await FileLink.findById(olderDeleted._id);
    expect(stillDeleted.deletedAt).toBeTruthy();
  });

  maybeDbTest('new link is created when no match exists', async () => {
    const workspaceId = new mongoose.Types.ObjectId();
    const fileId = new mongoose.Types.ObjectId();
    const entityId = new mongoose.Types.ObjectId();
    const attachedByUserId = new mongoose.Types.ObjectId();

    const result = await createLink({
      workspaceId,
      fileId,
      entityType: 'ticket',
      entityId,
      attachedByUserId,
    });

    expect(result.link._id).toBeTruthy();
    expect(await FileLink.countDocuments({ workspaceId, fileId })).toBe(1);
  });
});
