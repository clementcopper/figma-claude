// The extraction PIPELINE, lifted out of the `extract` command so more than one
// command can use it (`extract` writes markdown, `snapshot`/`check` build the
// canonical contract) without either duplicating the scaling logic — chunked
// variable reads, payload-driven chunk halving, depth retreat on huge pages.
//
// `evalFn` is injected rather than imported so the pipeline can be exercised
// against a fake Figma in tests. Before this existed, none of this orchestration
// had test coverage at all; the retry/degradation paths are exactly where a
// silent data loss would hide.

import {
  listPagesCode, walkerCode, variableCollectionsCode, variableChunkCode,
  remoteAliasTargetsCode, resolveBoundVars,
} from '../design-extract.js';

const DEPTH_FLOOR = 3;
// Variable values are fetched in bounded chunks so huge libraries (thousands of
// variables) never land in one oversized eval. On payload/timeout the chunk
// halves down to this floor before the rest of a collection is skipped.
const VAR_CHUNK = 200;
const VAR_CHUNK_FLOOR = 25;

/** Raised for user-facing preconditions so the CALLER decides how to exit. */
export class ExtractionError extends Error {}

/**
 * fastEval returns a string when the eval code uses JSON.stringify() (both
 * daemon and direct-connection paths pass the string value through), and an
 * object/primitive when the code returns a raw value. All walkers here
 * stringify, so results are almost always strings — guard against the object
 * case so the pipeline is robust to daemon changes.
 */
export function parseEvalResult(res) {
  if (typeof res === 'string') return JSON.parse(res);
  return res;
}

/**
 * Run a full extraction.
 *
 * @param {object}   o
 * @param {Function} o.evalFn        async (code) => result — the Figma bridge
 * @param {string[]} [o.sections]    section filter (only 'variables' matters here)
 * @param {string}   [o.pages]       comma list, case-insensitive substring match
 * @param {boolean}  [o.selection]   extract only the current selection
 * @param {boolean}  [o.resolveRemote] also capture aliased library primitives
 * @param {Function} [o.onProgress]  (text) => void, for a spinner
 * @returns {Promise<{extraction, droppedVars, remoteStats}>}
 */
export async function runExtraction({
  evalFn,
  sections,
  pages: pageFilter,
  selection = false,
  resolveRemote = false,
  onProgress = () => {},
} = {}) {
  if (typeof evalFn !== 'function') throw new TypeError('runExtraction requires an evalFn');
  const ev = async (code) => parseEvalResult(await evalFn(code));

  onProgress('Reading file info...');

  let pages;
  if (selection) {
    // Wrap the selection in a synthetic single "page".
    const sel = await ev(`(async () => {
      const sel = figma.currentPage.selection;
      return JSON.stringify({ ids: sel.map(n => n.id), pageId: figma.currentPage.id, pageName: figma.currentPage.name });
    })()`);
    if (!sel || !sel.ids || !sel.ids.length) throw new ExtractionError('Nothing selected in Figma.');
    pages = [{ id: sel.pageId, name: sel.pageName, selectionIds: sel.ids }];
  } else {
    pages = await ev(listPagesCode());
    if (pageFilter) {
      const filters = pageFilter.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      pages = pages.filter(p => filters.some(f => p.name.toLowerCase().includes(f)));
      if (!pages.length) throw new ExtractionError(`No pages match "${pageFilter}".`);
    }
  }

  const fileName = await ev(`(async () => JSON.stringify(figma.root.name))()`);

  // Authoritative token layer: the file's real variable collections. Two-phase
  // + chunked so it scales to large systems. Best-effort — older Figma builds /
  // files without variables yield []. droppedVars counts any chunk skipped
  // after exhausting retries, so callers can tell "no variables" apart from
  // "some unreadable".
  const variables = [];
  let droppedVars = 0;
  let remoteStats = null;
  const wantsVariables = !sections || sections.includes('variables');

  // Fetch one collection's values in bounded, retryable chunks. Shared by the
  // local pass and the --resolve-remote pass so a library with thousands of
  // primitives is chunked exactly like a local collection.
  const fetchValues = async (label, ids, modes) => {
    const collected = [];
    let chunk = VAR_CHUNK;
    for (let i = 0; i < ids.length;) {
      onProgress(`Variables: ${label} (${i}/${ids.length})…`);
      const slice = ids.slice(i, i + chunk);
      try {
        const got = await ev(variableChunkCode(slice, modes)) || [];
        collected.push(...got);
        i += chunk;
      } catch (e) {
        if (/payload|too large|timeout/i.test(e.message) && chunk > VAR_CHUNK_FLOOR) {
          chunk = Math.floor(chunk / 2);
          continue;
        }
        droppedVars += slice.length;
        i += chunk; // skip this slice, keep going with the rest
      }
    }
    return collected;
  };

  if (wantsVariables) {
    onProgress('Reading variable collections…');
    let cols = [];
    try {
      cols = await ev(variableCollectionsCode()) || [];
    } catch {
      cols = [];
    }
    for (const col of cols) {
      const collected = await fetchValues(col.name, col.variableIds || [], col.modes);
      variables.push({ id: col.id, name: col.name, modes: col.modes, variables: collected });
    }

    // Library primitives this file aliases into. Without them the semantic
    // layer re-imports with empty values (everything renders white), since
    // `import` can only wire an alias whose target exists in the export.
    if (resolveRemote) {
      onProgress('Resolving library variables…');
      let remote = { collections: [], truncated: false };
      try {
        remote = await ev(remoteAliasTargetsCode()) || remote;
      } catch (e) {
        remote = { collections: [], truncated: false, error: e.message };
      }
      const localNames = new Set(variables.map(c => c.name));
      let remoteVarCount = 0;
      for (const col of remote.collections || []) {
        // A library collection may share its name with a local one; keep them
        // apart so import doesn't merge two different sources.
        const name = localNames.has(col.name) ? `${col.name} (library)` : col.name;
        const collected = await fetchValues(name, col.ids || [], col.modes);
        if (!collected.length) continue;
        remoteVarCount += collected.length;
        variables.push({ id: col.id, name, modes: col.modes, variables: collected, remote: true });
      }
      remoteStats = {
        collections: (remote.collections || []).length,
        variables: remoteVarCount,
        truncated: !!remote.truncated,
        error: remote.error,
      };
    }
  }

  const results = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    onProgress(`Page ${i + 1}/${pages.length}: ${page.name}…`);
    let depth = 8;
    let result = null;
    while (depth >= DEPTH_FLOOR) {
      try {
        const code = page.selectionIds
          ? walkerCode(page.id, { maxDepth: depth }).replace(
              'page.children.map',
              `page.children.filter(c => ${JSON.stringify(page.selectionIds)}.includes(c.id)).map`)
          : walkerCode(page.id, { maxDepth: depth });
        result = await ev(code);
        if (depth < 8) result.reducedDepth = depth;
        break;
      } catch (e) {
        // Payload-size / timeout errors → retry shallower. Anything else → skip page.
        if (/payload|too large|timeout/i.test(e.message) && depth > DEPTH_FLOOR) { depth -= 2; continue; }
        result = { id: page.id, name: page.name, nodeCount: 0, frames: [], error: e.message };
        break;
      }
    }
    if (!result) result = { id: page.id, name: page.name, nodeCount: 0, frames: [], error: `exceeded payload limit even at depth ${DEPTH_FLOOR}` };
    results.push(result);
  }

  return {
    extraction: {
      fileName,
      date: new Date().toISOString().slice(0, 10),
      // Bound-variable ids only become meaningful once the variable layer is
      // known, so the walker captures ids and they are named here — after both
      // passes have run.
      pages: resolveBoundVars(results, variables),
      variables,
    },
    droppedVars,
    remoteStats,
  };
}
