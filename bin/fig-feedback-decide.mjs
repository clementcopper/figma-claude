#!/usr/bin/env node
/**
 * The I/O half of the feedback trigger: read the hook payload, ask `feedback-trigger.js`, latch.
 *
 * Node rather than shell pattern matching, which is what the first version tried. That version
 * matched the raw payload and fired on `tail LEARNINGS.md`, because the file's contents mention
 * figma-cli — the command and the response have to be told apart, and that needs a parser.
 */
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { shouldRemind } from '../src/lib/feedback-trigger.js';

let payload;
try {
  payload = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0); // Not our business to complain about a payload we cannot read
}

if (!shouldRemind(payload)) process.exit(0);

// One per session — and the latch is set HERE, after a real hit, not on every firing. A false
// positive used to burn it and silence the friction that came later; missing one silently is
// worse than reminding twice.
const session = typeof payload.session_id === 'string' ? payload.session_id.replace(/[^\w.-]/g, '') : 'unknown';
const latch = join(tmpdir(), `figma-cli-feedback-reminded-${session}`);
if (existsSync(latch)) process.exit(0);
try {
  writeFileSync(latch, '');
} catch {
  // A latch we cannot write means reminding again later, which is the harmless direction
}

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext:
        'That figma-cli call reported a failure or a warning. If the fault is figma-cli’s or the ' +
        'panel’s rather than the design’s, write it into FEEDBACK.md under ## Open now, while the ' +
        'command and its output are still in front of you — read that file’s Format section first. ' +
        'This reminder fires once per session.'
    }
  }) + '\n'
);
