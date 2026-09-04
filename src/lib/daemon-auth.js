/**
 * Daemon authentication — pure decisions, no I/O.
 *
 * The daemon binds loopback only, but loopback is shared with every local
 * process and with every web page the user has open: a page can open a
 * WebSocket to 127.0.0.1 without any CORS preflight. So both entry points —
 * HTTP requests and the /plugin WebSocket upgrade — check the same three
 * things: a loopback Host header (no DNS rebinding), the session token, and
 * for the upgrade an Origin that is not a real web origin.
 *
 * Every function returns null when the request may pass, or a short reason
 * string when it must be rejected.
 */

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1)(:\d+)?$/;

/** HTTP request: Host header + X-Daemon-Token header. */
export function validateHttpRequest(headers, sessionToken) {
  const host = headers.host || '';
  if (!LOOPBACK_HOST.test(host)) return 'Invalid host header';
  return checkToken(headers['x-daemon-token'], sessionToken);
}

/**
 * WebSocket upgrade for the Safe Mode plugin.
 * `req` is the shape of an http.IncomingMessage: { headers, url }.
 *
 * The plugin UI runs in a sandboxed iframe, whose origin is opaque, so the
 * browser sends `Origin: null` (or nothing, from a non-browser client). Any
 * other Origin is a web page and is refused even with a valid token.
 * The token travels in the query string (`/plugin?token=…`) because a browser
 * WebSocket cannot set headers; a header is accepted too for other clients.
 */
export function validateUpgrade(req, sessionToken) {
  const headers = req.headers || {};
  const host = headers.host || '';
  if (!LOOPBACK_HOST.test(host)) return 'Invalid host header';

  const origin = headers.origin;
  if (origin !== undefined && origin !== 'null') return 'Cross-origin WebSocket rejected';

  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname !== '/plugin') return 'Unknown upgrade path';

  const token = url.searchParams.get('token') || headers['x-daemon-token'];
  return checkToken(token, sessionToken);
}

function checkToken(token, sessionToken) {
  if (!sessionToken) return 'No session token configured';
  if (!token || token !== sessionToken) return 'Invalid or missing token';
  return null;
}
