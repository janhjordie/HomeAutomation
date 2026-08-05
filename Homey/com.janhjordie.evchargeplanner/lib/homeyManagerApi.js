'use strict';

async function ensureOwnerApiAccess(homey) {
  if (typeof homey.api?.getOwnerApiToken !== 'function'
    || typeof homey.api?.getLocalUrl !== 'function') {
    return null;
  }

  const token = await homey.api.getOwnerApiToken();
  const localUrl = await homey.api.getLocalUrl();
  if (!token || !localUrl) {
    return null;
  }

  return { token, localUrl };
}

async function managerApiRequest(homey, method, path, body = undefined) {
  const access = await ensureOwnerApiAccess(homey);
  if (access) {
    const url = `${access.localUrl}/api${path}`;
    const headers = {
      Authorization: `Bearer ${access.token}`
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${method} ${path} failed (${response.status}): ${text}`);
    }

    if (response.status === 204) {
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return response.json();
    }

    return null;
  }

  if (method === 'GET' && typeof homey.api?.get === 'function') {
    return homey.api.get(path);
  }
  if (method === 'PUT' && typeof homey.api?.put === 'function') {
    return homey.api.put(path, body);
  }

  throw new Error('Manager API ikke tilgaengelig');
}

module.exports = {
  managerApiRequest
};
