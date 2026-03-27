let realtimeServer = null;

export const setRealtimeServer = (io) => {
  realtimeServer = io;
  return realtimeServer;
};

export const getRealtimeServer = () => realtimeServer;

export const clearRealtimeServer = () => {
  realtimeServer = null;
};
