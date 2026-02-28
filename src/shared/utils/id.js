export const isMongoId = (value) =>
  typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
