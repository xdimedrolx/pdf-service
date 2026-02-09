export const issuesToErrors = (issues) => {
  return issues.map((issue) => {
    const key = issue.path.length ? issue.path.join('.') : '_global';
    return { [key]: issue.message };
  });
};
