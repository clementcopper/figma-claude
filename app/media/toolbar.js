/*
 * Top bar.
 *
 * In VS Code these buttons were not part of the webview at all — the extension contributed them
 * to the view title bar (`contributes.menus["view/title"]`: New Tab, Resume, Continue, Restart).
 * A standalone window has no such host, so the same four actions are drawn here, in the same
 * order, plus the one thing a window needs that an editor supplied for free: which directory
 * Claude runs in.
 *
 * Deliberately outside `media/main.ts`, which stays byte-identical to the extension's.
 */
(function () {
  const vscode = acquireVsCodeApi();

  // Codicon shapes, redrawn as inline SVG: add, history, debug-continue, debug-restart.
  const ICONS = {
    folder:
      '<path d="M1.5 3h4l1 1.5h8V13H1.5V3z" fill="none" stroke="currentColor" stroke-width="1.2"/>',
    add: '<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
    history:
      '<path d="M8 4v4l2.5 1.5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/><path d="M2.6 8a5.4 5.4 0 1 0 1.6-3.8M2.5 3v2.4h2.4" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    continue:
      '<path d="M3 3v10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M6 3.5l7 4.5-7 4.5z" fill="currentColor"/>',
    restart:
      '<path d="M13.4 8a5.4 5.4 0 1 1-1.6-3.8M13.5 3v2.4h-2.4" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
  };

  function icon(name) {
    return `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${ICONS[name]}</svg>`;
  }

  function button(action, title, iconName) {
    const el = document.createElement('button');
    el.className = 'toolbar-button';
    el.type = 'button';
    el.title = title;
    el.setAttribute('aria-label', title);
    el.innerHTML = icon(iconName);
    el.addEventListener('click', () => {
      vscode.postMessage({ type: 'toolbar', action });
    });
    return el;
  }

  const toolbar = document.getElementById('toolbar');
  if (!toolbar) return;

  // Room for the traffic lights: the window is frameless, so nothing else reserves it.
  const lights = document.createElement('div');
  lights.className = 'toolbar-trafficlights';
  toolbar.appendChild(lights);

  // Working directory. Claude Code stores its session history per directory, so this is not
  // decoration — it decides which conversations `--resume` will offer.
  const cwdButton = document.createElement('button');
  cwdButton.className = 'toolbar-cwd';
  cwdButton.type = 'button';
  cwdButton.title = 'Choose the working directory for new tabs';
  cwdButton.innerHTML = `${icon('folder')}<span class="toolbar-cwd-label">…</span>`;
  cwdButton.addEventListener('click', () => {
    vscode.postMessage({ type: 'toolbar', action: 'pickCwd' });
  });
  toolbar.appendChild(cwdButton);

  const spacer = document.createElement('div');
  spacer.className = 'toolbar-spacer';
  toolbar.appendChild(spacer);

  // Same order as the extension's view/title group.
  toolbar.appendChild(button('newTab', 'New Terminal Tab', 'add'));
  toolbar.appendChild(button('resume', 'Resume Session in Current Tab…', 'history'));
  toolbar.appendChild(button('continue', 'Continue Last Session in Current Tab', 'continue'));
  toolbar.appendChild(button('restart', 'Restart Terminal', 'restart'));

  const label = cwdButton.querySelector('.toolbar-cwd-label');

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || message.type !== 'panelCwd') return;
    const cwd = message.cwd || '';
    // The bar is narrow: the last segment is what tells two projects apart, the full path
    // lives in the tooltip.
    const name = cwd.replace(/\/+$/, '').split('/').pop() || cwd || '—';
    label.textContent = name;
    cwdButton.title = cwd ? `${cwd}\nClick to choose the working directory` : cwdButton.title;
  });

  // Asking on startup would be a modal in the way; the host answers with the current one.
  vscode.postMessage({ type: 'toolbar', action: 'requestCwd' });
})();
