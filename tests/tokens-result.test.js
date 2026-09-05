import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resultOrThrow, validateTokenInput, parseTokensFile } from '../src/commands/tokens.js';

// `figmaUse(code, { silent: true })` answers null for any error, and the tokens presets did
// `result?.trim() || 'Created spacing scale'`: against a disconnected Figma, `tokens ds`
// printed five green checkmarks and "~74 variables across 5 collections" having created
// nothing, exit 0. Null is a failure, and the failure has a message.

describe('resultOrThrow', () => {
  it('passes a real result through, trimmed', () => {
    assert.strictEqual(resultOrThrow('  12 variables\n'), '12 variables');
    assert.strictEqual(resultOrThrow(''), '');
  });

  it('throws on null, carrying the eval error when there is one', () => {
    assert.throws(() => resultOrThrow(null, new Error('Plugin not connected')), /Plugin not connected/);
    assert.throws(() => resultOrThrow(null), /no result/i);
  });
});

// `tokens add lab/bad "#zz" -t COLOR` and `-t NOPE` reached Figma and came back as a
// twelve-line validation dump ("Expected boolean, received null …"). The two inputs the
// command controls — the value against its type, the type against the four it offers — are
// checked here first, in the words the neighbours use ("Unknown type … Use: …").
describe('validateTokenInput', () => {
  it('accepts a hex colour, a number, a boolean and a string for their types', () => {
    assert.strictEqual(validateTokenInput('#ff0000', 'COLOR'), null);
    assert.strictEqual(validateTokenInput('12', 'FLOAT'), null);
    assert.strictEqual(validateTokenInput('true', 'BOOLEAN'), null);
    assert.strictEqual(validateTokenInput('anything', 'STRING'), null);
    assert.strictEqual(validateTokenInput('anything', ''), null); // auto-detected later
  });
  it('names a bad colour', () => {
    assert.match(validateTokenInput('#zz', 'COLOR'), /#zz/);
  });
  it('names a bad number and a bad boolean', () => {
    assert.match(validateTokenInput('abc', 'FLOAT'), /FLOAT/);
    assert.match(validateTokenInput('yes', 'BOOLEAN'), /true or false/);
  });
  it('rejects an unknown type with the choices', () => {
    assert.match(validateTokenInput('1', 'NOPE'), /Unknown type "NOPE"\. Use: COLOR, FLOAT, STRING, BOOLEAN/);
  });
});

// `printf '{nope' > bad.json; tokens import bad.json` said "Could not read file" — the file was
// read fine, the JSON was not. Reading and parsing are two failures with two messages.
describe('parseTokensFile', () => {
  it('parses valid JSON', () => {
    assert.deepStrictEqual(parseTokensFile('{"colors":{"primary":"#fff"}}', 'a.json'), { colors: { primary: '#fff' } });
  });
  it('names the file and the JSON problem for invalid JSON', () => {
    assert.throws(() => parseTokensFile('{nope', 'bad.json'), /Invalid JSON in bad\.json: .*/);
  });
});
