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
  if (error?.details && typeof error.details === 'object') {
    return error.details;
  }

  return {
    name: error?.name ?? 'Error',
    message: error?.message ?? 'Unknown error',
  };
};

export const resolveErrorStatus = (error) => {
  if (Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599) {
    return error.status;
  }
  return 500;
};

export const resolveErrorCode = (error) => {
  if (typeof error?.code === 'string' && error.code.trim().length > 0) {
    return error.code;
  }
  return 'INTERNAL_ERROR';
};
