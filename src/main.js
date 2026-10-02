'use strict';
const { input, runner, api, main, fail } = require('./action');
const token = input('token');
if (!token) {
  fail(new Error('token is required'));
} else {
  main({ tag: input('tag'), sha: input('commit_sha'), repository: input('repository'), message: input('message') }, api(token), runner()).catch(fail);
}
