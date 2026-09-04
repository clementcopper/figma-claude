/**
 * curl config for the sync daemon path.
 *
 * `figmaEvalSync` and the health checks must be synchronous, so they shell out to curl. The
 * session token used to go on the command line as `-H "X-Daemon-Token: …"`, which `ps` shows
 * to every local user for the length of the call — the readers the token exists to keep out.
 * A config file on stdin (`curl -K -`) carries every option without touching argv.
 *
 * Pure: returns the config text; the caller pipes it in.
 */

export const CURL_ARGS = ['-s', '-K', '-'];

const q = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

export function curlConfig({ url, token, method, dataFile, output, writeOut }) {
  const lines = [`url = ${q(url)}`];
  if (method) lines.push(`request = ${q(method)}`);
  if (token) lines.push(`header = ${q('X-Daemon-Token: ' + token)}`);
  if (dataFile) {
    lines.push(`header = ${q('Content-Type: application/json')}`);
    lines.push(`data = ${q('@' + dataFile)}`);
  }
  if (output) lines.push(`output = ${q(output)}`);
  if (writeOut) lines.push(`write-out = ${q(writeOut)}`);
  return lines.join('\n') + '\n';
}
