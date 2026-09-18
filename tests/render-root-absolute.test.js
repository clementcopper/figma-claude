import { describe, it } from 'node:test';
import assert from 'node:assert';
import { FigmaClient } from '../src/figma-client.js';

// A panel session rendered an overlay into a VERTICAL auto-layout frame with `--parent` and got
// it appended as the last flow child, at y 2960 in an 812px clipped frame (FEEDBACK.md,
// 16 Sep 2026). `position` was in the accepted prop list for Frame but the ROOT never read it,
// so `position="absolute"` was taken without a warning and dropped in silence.
describe('root position="absolute" with --parent', () => {
  const client = new FigmaClient();
  const overlay = '<Frame name="Overlay" position="absolute" x={0} y={0} w={375} h={812} />';

  it('sets layoutPositioning in an auto-layout parent, after the append', async () => {
    const code = await client.parseJSX(overlay, { parent: '16572:401075' });
    assert.match(code, /frame\.layoutPositioning = 'ABSOLUTE'/);
    // Only inside auto-layout: setting it anywhere else throws in the Plugin API.
    assert.match(code, /if \(__p\.layoutMode && __p\.layoutMode !== 'NONE'\) \{ frame\.layoutPositioning = 'ABSOLUTE'; \}/);
    // After the append, because appending re-homes the coordinates set further up.
    assert.ok(code.indexOf('__p.appendChild(frame)') < code.indexOf("frame.layoutPositioning = 'ABSOLUTE'"));
    assert.ok(code.lastIndexOf('frame.x = 0;') > code.indexOf('__p.appendChild(frame)'));
  });

  it('keeps the x/y the caller asked for, not the smart position', async () => {
    const code = await client.parseJSX('<Frame name="O" position="absolute" x={12} y={34} w={10} h={10} />',
      { parent: '1:2' });
    assert.match(code, /frame\.x = 12;/);
    assert.match(code, /frame\.y = 34;/);
  });

  it('says so instead of doing nothing when there is no parent to overlay', async () => {
    const code = await client.parseJSX(overlay);
    assert.doesNotMatch(code, /layoutPositioning/);
    // The message is JSON.stringify'd into the generated source, so its quotes are escaped.
    assert.match(code, /has position=\\"absolute\\" but no --parent/);
  });

  it('leaves a root without the prop exactly as it was', async () => {
    const code = await client.parseJSX('<Frame name="O" w={10} h={10} />', { parent: '1:2' });
    assert.doesNotMatch(code, /layoutPositioning/);
    assert.doesNotMatch(code, /no --parent/);
  });

  it('looks the parent up again after loadAllPagesAsync, like the other two commands', async () => {
    // render was the only one that did not, so a parent on an unloaded page answered
    // "Parent not found" for a node that exists.
    const code = await client.parseJSX('<Frame name="O" w={10} h={10} />', { parent: '1:2' });
    assert.match(code, /await figma\.loadAllPagesAsync\(\)/);
    assert.ok(code.indexOf('loadAllPagesAsync') < code.indexOf('Parent not found'));
  });
});
