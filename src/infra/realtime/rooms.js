export const workspaceRoomName = (workspaceId) =>
  `workspace:${String(workspaceId)}`;

export const ticketRoomName = (ticketId) => `ticket:${String(ticketId)}`;

export const userRoomName = (userId) => `user:${String(userId)}`;

export const sessionRoomName = (sessionId) => `session:${String(sessionId)}`;

export const widgetSessionRoomName = (widgetSessionId) =>
  `widget-session:${String(widgetSessionId)}`;
