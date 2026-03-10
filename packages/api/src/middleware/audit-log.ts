export function auditLog(
  userId: string,
  action: string,
  resource: string,
  details?: object,
): Promise<void> {
  console.info(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      userId,
      action,
      resource,
      details,
    }),
  );
  return Promise.resolve();
}
