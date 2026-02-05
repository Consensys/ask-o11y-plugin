module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'],
    ],
    'scope-enum': [
      1, // Warning only - don't block commits with new scopes
      'always',
      ['chat', 'mcp', 'session', 'config', 'rbac', 'oauth', 'share', 'viz', 'backend', 'ui', 'deps', 'release'],
    ],
  },
};
