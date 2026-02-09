export const issuesToErrors = (issues) => {
  return issues.map((issue) => {
    const key = issue.path.length ? issue.path.join('.') : '_global';
    return { [key]: issue.message };
  });
};

export const normalizeErrorToErrors = (error) => {
  if (error?.issues && Array.isArray(error.issues)) {
    return issuesToErrors(error.issues);
  }

  if (error?.message) {
    return [{ _global: error.message }];
  }

  return [{ _global: 'An error has occurred' }];
};

export const serializeErrorDetails = (error) => {
  return {
    name: error?.name ?? 'Error',
    message: error?.message ?? 'Unknown error',
    stack: error?.stack ?? null,
  };
};
