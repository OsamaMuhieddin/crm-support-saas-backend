import { buildPagination } from '../../../shared/utils/pagination.js';
import { FileLink } from '../models/file-link.model.js';

const buildFileLinkView = (link) => ({
  _id: String(link._id),
  workspaceId: String(link.workspaceId),
  fileId: String(link.fileId),
  entityType: link.entityType,
  entityId: String(link.entityId),
  relationType: link.relationType,
  attachedByUserId: String(link.attachedByUserId),
  createdAt: link.createdAt,
  updatedAt: link.updatedAt,
});

export const createLink = async ({
  workspaceId,
  fileId,
  entityType,
  entityId,
  relationType = null,
  attachedByUserId,
}) => {
  const normalizedEntityType = String(entityType || '')
    .trim()
    .toLowerCase();
  const normalizedRelationType = relationType || null;
  const baseQuery = {
    workspaceId,
    fileId,
    entityType: normalizedEntityType,
    entityId,
    relationType: normalizedRelationType,
  };

  const activeExisting = await FileLink.findOne({
    ...baseQuery,
    deletedAt: null,
  });

  if (activeExisting) {
    return {
      link: buildFileLinkView(activeExisting),
    };
  }

  const softDeletedExisting = await FileLink.findOne({
    ...baseQuery,
    deletedAt: { $ne: null },
  }).sort({ deletedAt: -1, updatedAt: -1, createdAt: -1, _id: -1 });

  if (softDeletedExisting) {
    softDeletedExisting.deletedAt = null;
    softDeletedExisting.deletedByUserId = null;
    softDeletedExisting.attachedByUserId = attachedByUserId;
    await softDeletedExisting.save();

    return {
      link: buildFileLinkView(softDeletedExisting),
    };
  }

  const link = await FileLink.create({
    ...baseQuery,
    attachedByUserId,
  });

  return {
    link: buildFileLinkView(link),
  };
};

export const unlink = async ({
  workspaceId,
  fileId,
  entityType,
  entityId,
  relationType = null,
  deletedByUserId,
}) => {
  await FileLink.updateOne(
    {
      workspaceId,
      fileId,
      entityType: String(entityType || '')
        .trim()
        .toLowerCase(),
      entityId,
      relationType: relationType || null,
      deletedAt: null,
    },
    {
      $set: {
        deletedAt: new Date(),
        deletedByUserId,
      },
    }
  );

  return {};
};

export const listLinksForEntity = async ({
  workspaceId,
  entityType,
  entityId,
  page = 1,
  limit = 20,
}) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const skip = (safePage - 1) * safeLimit;

  const query = {
    workspaceId,
    entityType: String(entityType || '')
      .trim()
      .toLowerCase(),
    entityId,
    deletedAt: null,
  };

  const [total, links] = await Promise.all([
    FileLink.countDocuments(query),
    FileLink.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
  ]);

  return {
    ...buildPagination({
      page: safePage,
      limit: safeLimit,
      total,
      results: links.length,
    }),
    links: links.map((link) => buildFileLinkView(link)),
  };
};

export const listLinksForFile = async ({
  workspaceId,
  fileId,
  page = 1,
  limit = 20,
}) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const skip = (safePage - 1) * safeLimit;

  const query = {
    workspaceId,
    fileId,
    deletedAt: null,
  };

  const [total, links] = await Promise.all([
    FileLink.countDocuments(query),
    FileLink.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
  ]);

  return {
    ...buildPagination({
      page: safePage,
      limit: safeLimit,
      total,
      results: links.length,
    }),
    links: links.map((link) => buildFileLinkView(link)),
  };
};

export const softDeleteLinksForFile = async ({
  workspaceId,
  fileId,
  deletedByUserId,
}) => {
  await FileLink.updateMany(
    {
      workspaceId,
      fileId,
      deletedAt: null,
    },
    {
      $set: {
        deletedAt: new Date(),
        deletedByUserId,
      },
    }
  );
};

export const findLinkedFileIds = async ({
  workspaceId,
  entityType = null,
  entityId = null,
}) => {
  const normalizedEntityType = entityType
    ? String(entityType || '')
        .trim()
        .toLowerCase()
    : null;

  return FileLink.distinct('fileId', {
    workspaceId,
    deletedAt: null,
    ...(normalizedEntityType ? { entityType: normalizedEntityType } : {}),
    ...(normalizedEntityType && entityId ? { entityId } : {}),
  });
};
