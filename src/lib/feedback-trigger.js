/**
 * Deciding whether a Bash call earns a feedback reminder.
 *
 * The first version of this lived inside the hook script as two `case` statements over the raw
 * payload, on the reasoning that nothing had to be extracted, only recognised. It fired within
 * minutes of being installed on
 *
 *     tail -14 /Users/danielmartin/Website/LEARNINGS.md
 *
 * — no figma-cli in the command, exit 0, nothing wrong. The file's *contents* carry the words
 * `figma-cli` and `⚠`, because it documents earlier findings, and the pattern matched the payload
 * rather than the command. Every `cat`, `grep` or `git diff` over notes would have done it, and a
 * `git diff FEEDBACK.md` most of all.
 *
 * That is why this is a module with tests rather than two lines of shell: the question "did the
 * user invoke the CLI, and did it complain" needs the command and the response kept apart.
 */

/** Where one shell command ends and the next begins. Enough for the shapes people actually type. */
function segments(command) {
  return String(command || '')
    .split(/(?:\|\||&&|[;\n|])/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Strips what may stand before the program: `env`, `VAR=1`, `sudo`, `time`, `npx`, `bunx`. */
function programOf(segment) {
  const words = segment.split(/\s+/);
  let i = 0;
  while (i < words.length) {
    const word = words[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word) || ['env', 'sudo', 'time', 'npx', 'bunx', 'command'].includes(word)) {
      i += 1;
      continue;
    }
    break;
  }
  return { program: words[i] || '', rest: words.slice(i + 1) };
}

/**
 * Did this command actually run the CLI?
 *
 * The program has to BE the CLI — the name appearing somewhere in an argument is what produced
 * the false positive. `node …/src/index.js` counts, since that is how a checkout is driven.
 */
export function isFigmaCliInvocation(command) {
  for (const segment of segments(command)) {
    const { program, rest } = programOf(segment);
    if (!program) continue;
    const base = program.split('/').pop();
    if (base === 'figma-cli' || base === 'figma-ds-cli' || base === 'fig-start' || base === 'fig-status') {
      return true;
    }
    // `node src/index.js …` — the entry point, not just any script that mentions it.
    if ((base === 'node' || base === 'bun') && rest.some((arg) => /(^|\/)(src\/)?index\.js$/.test(arg))) {
      return true;
    }
  }
  return false;
}

/** The CLI's own markers, Commander's, and the tool's. Read from the RESPONSE, never the command. */
export function looksFailed(response) {
  if (response === null || response === undefined) return false;

  if (typeof response === 'object') {
    for (const key of ['exit_code', 'exitCode', 'returnCode', 'code']) {
      const value = response[key];
      if (typeof value === 'number' && value !== 0) return true;
    }
    if (response.is_error === true || response.isError === true) return true;
    if (response.interrupted === true) return true;
    const text = [response.stdout, response.stderr, response.output, response.error, response.message]
      .filter((part) => typeof part === 'string')
      .join('\n');
    return looksFailed(text);
  }

  const text = String(response);
  return /✗|⚠|(^|\s)error:|(^|\s)Error:/.test(text);
}

/**
 * @param {object} payload the PostToolUse hook payload
 * @returns {boolean} whether this deserves the one reminder a session gets
 */
export function shouldRemind(payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  if (data.tool_name && data.tool_name !== 'Bash') return false;
  const command = data.tool_input?.command;
  if (!isFigmaCliInvocation(command)) return false;
  return looksFailed(data.tool_response);
}
