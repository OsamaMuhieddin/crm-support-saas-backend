import {
  getWorkspaceReportsOverview,
  getWorkspaceSlaReport,
  getWorkspaceTeamReport,
  getWorkspaceTicketsReport,
} from '../services/reports.service.js';

export const getReportsOverviewController = async (req, res, next) => {
  try {
    const data = await getWorkspaceReportsOverview({
      workspaceId: req.auth.workspaceId,
      roleKey: req.member.roleKey,
      query: req.query,
    });

    return res.json(data);
  } catch (error) {
    return next(error);
  }
};

export const getReportsTicketsController = async (req, res, next) => {
  try {
    const data = await getWorkspaceTicketsReport({
      workspaceId: req.auth.workspaceId,
      roleKey: req.member.roleKey,
      query: req.query,
    });

    return res.json(data);
  } catch (error) {
    return next(error);
  }
};

export const getReportsSlaController = async (req, res, next) => {
  try {
    const data = await getWorkspaceSlaReport({
      workspaceId: req.auth.workspaceId,
      roleKey: req.member.roleKey,
      query: req.query,
    });

    return res.json(data);
  } catch (error) {
    return next(error);
  }
};

export const getReportsTeamController = async (req, res, next) => {
  try {
    const data = await getWorkspaceTeamReport({
      workspaceId: req.auth.workspaceId,
      roleKey: req.member.roleKey,
      query: req.query,
    });

    return res.json(data);
  } catch (error) {
    return next(error);
  }
};
