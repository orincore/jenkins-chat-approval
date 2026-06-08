/**
 * Thin Jenkins REST client for driving the `input` (approval) step.
 *
 * Factored out of index.js so the proceed/abort/crumb/description logic can be
 * unit-tested with a mocked fetch (see jenkins.test.js) without a live Jenkins.
 */

export function createJenkinsClient({ baseUrl, user, token, fetchImpl = fetch }) {
  if (!baseUrl || !user || !token) {
    throw new Error('createJenkinsClient requires baseUrl, user and token');
  }
  const authorization = 'Basic ' + Buffer.from(`${user}:${token}`).toString('base64');

  function withHeaders(crumb, extra = {}) {
    const headers = { Authorization: authorization, ...extra };
    if (crumb) headers[crumb.field] = crumb.value;
    return headers;
  }

  /** Fetch a CSRF crumb. Returns null when crumbs are disabled (non-2xx). */
  async function crumb() {
    const res = await fetchImpl(`${baseUrl}/crumbIssuer/api/json`, {
      headers: { Authorization: authorization },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return { field: data.crumbRequestField, value: data.crumb };
  }

  /** Stamp the build description (used to record the human approver from Chat). */
  async function setBuildDescription(buildUrl, description, crumbToken) {
    const res = await fetchImpl(`${buildUrl}submitDescription`, {
      method: 'POST',
      headers: withHeaders(crumbToken, { 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({ description }).toString(),
    });
    if (!res.ok) {
      throw new Error(`set build description failed: ${res.status} ${await res.text()}`);
    }
  }

  /** Proceed (approve) or abort (reject) the named input step. */
  async function decideInput(buildUrl, inputId, approve, crumbToken) {
    const path = approve ? `input/${inputId}/proceedEmpty` : `input/${inputId}/abort`;
    const res = await fetchImpl(`${buildUrl}${path}`, {
      method: 'POST',
      headers: withHeaders(crumbToken),
    });
    if (!res.ok) {
      throw new Error(`Jenkins ${approve ? 'proceed' : 'abort'} failed: ${res.status} ${await res.text()}`);
    }
  }

  return { authorization, crumb, setBuildDescription, decideInput };
}
