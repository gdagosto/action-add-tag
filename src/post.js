'use strict';
const { input, api, post, fail } = require('./action');
if (process.env.STATE_created === 'true') {
  const token = input('token');
  if (!token) fail(new Error('token is required for cleanup'));
  else post({ created: process.env.STATE_created, repository: process.env.STATE_repository, tag: process.env.STATE_tag }, api(token)).catch(fail);
}
