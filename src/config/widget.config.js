const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

export const widgetConfig = {
  recovery: {
    tokenExpiresMinutes: toInt(
      process.env.WIDGET_RECOVERY_TOKEN_EXPIRES_MINUTES,
      15
    ),
    solvedTicketWindowHours: toInt(
      process.env.WIDGET_RECOVERY_SOLVED_TICKET_WINDOW_HOURS,
      72
    ),
  },
};
