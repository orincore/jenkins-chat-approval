/**
 * Unit/integration tests for the Jenkins approval client.
 * Run: npm test   (uses Node's built-in test runner + a mocked fetch — no live Jenkins)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createJenkinsClient } from './jenkins.js';

const BASE = 'https://jenkins.cred2tech.com';
const BUILD = 'https://jenkins.cred2tech.com/job/scheme-backend/42/';
const CFG = { baseUrl: BASE, user: 'chat-approver-bot', token: 'tok123' };

/** A fetch double that records calls and replays queued responses. */
function mockFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts });
    const next = queue.shift() ?? { ok: true, status: 200 };
    return {
      ok: next.ok ?? true,
      status: next.status ?? 200,
      json: async () => next.json ?? {},
      text: async () => next.text ?? '',
    };
  };
  return { fetchImpl, calls };
}

const expectedAuth = 'Basic ' + Buffer.from('chat-approver-bot:tok123').toString('base64');

test('factory rejects missing config', () => {
  assert.throws(() => createJenkinsClient({ baseUrl: BASE }), /requires baseUrl, user and token/);
});

test('crumb() parses field + value and sends auth', async () => {
  const { fetchImpl, calls } = mockFetch([
    { ok: true, json: { crumbRequestField: 'Jenkins-Crumb', crumb: 'abc' } },
  ]);
  const jenkins = createJenkinsClient({ ...CFG, fetchImpl });
  const crumb = await jenkins.crumb();
  assert.deepEqual(crumb, { field: 'Jenkins-Crumb', value: 'abc' });
  assert.equal(calls[0].url, `${BASE}/crumbIssuer/api/json`);
  assert.equal(calls[0].opts.headers.Authorization, expectedAuth);
});

test('crumb() returns null when crumbs are disabled', async () => {
  const { fetchImpl } = mockFetch([{ ok: false, status: 404 }]);
  const jenkins = createJenkinsClient({ ...CFG, fetchImpl });
  assert.equal(await jenkins.crumb(), null);
});

test('decideInput(approve) POSTs proceedEmpty with auth + crumb header', async () => {
  const { fetchImpl, calls } = mockFetch([{ ok: true }]);
  const jenkins = createJenkinsClient({ ...CFG, fetchImpl });
  await jenkins.decideInput(BUILD, 'DeployApproval', true, { field: 'Jenkins-Crumb', value: 'xyz' });
  assert.equal(calls[0].url, `${BUILD}input/DeployApproval/proceedEmpty`);
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers.Authorization, expectedAuth);
  assert.equal(calls[0].opts.headers['Jenkins-Crumb'], 'xyz');
});

test('decideInput(reject) POSTs abort', async () => {
  const { fetchImpl, calls } = mockFetch([{ ok: true }]);
  const jenkins = createJenkinsClient({ ...CFG, fetchImpl });
  await jenkins.decideInput(BUILD, 'DeployApproval', false, null);
  assert.equal(calls[0].url, `${BUILD}input/DeployApproval/abort`);
  assert.equal(calls[0].opts.method, 'POST');
});

test('decideInput throws with status + body on failure', async () => {
  const { fetchImpl } = mockFetch([{ ok: false, status: 403, text: 'No valid crumb' }]);
  const jenkins = createJenkinsClient({ ...CFG, fetchImpl });
  await assert.rejects(
    () => jenkins.decideInput(BUILD, 'DeployApproval', true, null),
    /proceed failed: 403 No valid crumb/,
  );
});

test('setBuildDescription POSTs urlencoded description', async () => {
  const { fetchImpl, calls } = mockFetch([{ ok: true }]);
  const jenkins = createJenkinsClient({ ...CFG, fetchImpl });
  await jenkins.setBuildDescription(BUILD, 'Approved via Google Chat by alice@cred2tech.com', null);
  assert.equal(calls[0].url, `${BUILD}submitDescription`);
  assert.equal(calls[0].opts.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.match(calls[0].opts.body, /description=Approved\+via\+Google\+Chat\+by\+alice%40cred2tech.com/);
});
