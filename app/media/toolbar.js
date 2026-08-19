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

  // Figma connection: two dots, because the two halves fail separately — the daemon can be up
  // with no Figma behind it, which is the state that otherwise looks like "commands do nothing".
  //
  // A button, but disabled while the connection is up: then there is nothing to press, and an
  // element that invites a click it cannot honour is worse than a plain readout. `disabled`
  // takes the click, the focus and the keyboard with it in one attribute.
  const figma = document.createElement('button');
  figma.className = 'toolbar-figma';
  figma.type = 'button';
  figma.title = 'Figma connection';
  figma.innerHTML =
    '<span class="toolbar-dot" data-role="daemon"></span>' +
    '<span class="toolbar-dot" data-role="figma"></span>' +
    '<span class="toolbar-figma-label">—</span>';
  figma.addEventListener('click', () => {
    if (menu.hidden) openMenu();
    else closeMenu();
  });
  toolbar.appendChild(figma);

  // Session actions, in the order the extension's view/title group had them. "New Terminal Tab"
  // is deliberately absent: the tab strip already carries a `+` that sends the same message, and
  // two identical buttons forty pixels apart is not two features.
  toolbar.appendChild(button('resume', 'Resume Session in Current Tab…', 'history'));
  toolbar.appendChild(button('continue', 'Continue Last Session in Current Tab', 'continue'));
  toolbar.appendChild(button('restart', 'Restart Terminal', 'restart'));

  const label = cwdButton.querySelector('.toolbar-cwd-label');

  const daemonDot = figma.querySelector('[data-role="daemon"]');
  const figmaDot = figma.querySelector('[data-role="figma"]');
  const figmaLabel = figma.querySelector('.toolbar-figma-label');

  // A message from the host takes the label for a moment, then the file name comes back. The
  // button has no other way to answer — and an answer is the point of pressing it.
  let toastTimer;
  let lastLabel = '—';

  window.addEventListener('message', (event) => {
    const message = event.data;

    if (message && message.type === 'panelWindow') {
      // In full screen macOS hides the traffic lights, so the space kept for them is dead.
      document.body.classList.toggle('is-fullscreen', message.fullScreen === true);
      return;
    }

    if (message && message.type === 'panelToast') {
      clearTimeout(toastTimer);
      figmaLabel.textContent = message.text;
      figmaLabel.classList.add('toast');
      figma.title = message.text;
      toastTimer = setTimeout(() => {
        figmaLabel.textContent = lastLabel;
        figmaLabel.classList.remove('toast');
      }, 2600);
      return;
    }

    if (message && message.type === 'panelFigma') {
      daemonDot.className = 'toolbar-dot ' + (message.daemon === 'ok' ? 'on' : 'off');
      figmaDot.className = 'toolbar-dot ' + (message.figma === 'ok' ? 'on' : 'off');
      // Built host-side (`figmaButtonLabel`) so the states are unit-tested, not eyeballed here.
      lastLabel = message.label || '—';
      if (!figmaLabel.classList.contains('toast')) {
        figmaLabel.textContent = lastLabel;
      }
      const lines = [message.tooltip];
      if (message.page) lines.push(`Page: ${message.page}`);
      lines.push('Click for connection, files and actions');
      figma.title = lines.join('\n');
      // An open menu shows counts and states that just changed underneath it.
      if (!menu.hidden) send('refresh');
      return;
    }

    if (message && message.type === 'panelTheme') {
      // A class, not a data attribute: media/main.ts watches `class` on <html> and hands xterm
      // the new palette when it changes. Nothing in that ported file had to be touched.
      document.documentElement.classList.toggle('theme-light', message.theme === 'light');
      return;
    }

    if (message && message.type === 'panelFigmaMenu') {
      renderMenu(message);
      return;
    }

    if (message && message.type === 'panelFigmaMessage') {
      note(message.text);
      return;
    }

    if (message && message.type === 'panelFigmaPermission') {
      // Patching Figma is gated behind a macOS permission the app cannot grant itself.
      parts.note.replaceChildren();
      parts.note.hidden = false;
      const text = document.createElement('div');
      text.textContent = 'FigmaClaude needs "App Management" to patch Figma.';
      parts.note.appendChild(text);
      parts.note.appendChild(
        menuButton('Open System Settings', 'openPermissions', undefined, { keepOpen: true })
      );
      return;
    }

    if (!message || message.type !== 'panelCwd') return;
    const cwd = message.cwd || '';
    // The bar is narrow: the last segment is what tells two projects apart, the full path
    // lives in the tooltip.
    const name = cwd.replace(/\/+$/, '').split('/').pop() || cwd || '—';
    label.textContent = name;
    cwdButton.title = cwd ? `${cwd}\nClick to choose the working directory` : cwdButton.title;
    // The menu names the folder it would write the agent rules into — that folder just changed.
    if (!menu.hidden) send('refresh');
  });

  // --- The Figma menu ---
  //
  // Everything the figma-CLI does for the user lives here, so the terminal below stays Claude's.
  // The host owns the state: this file draws what `panelFigmaMenu` describes and sends back which
  // entry was pressed. No command text, no shell, nothing typed into a prompt.

  const menu = document.createElement('div');
  menu.className = 'figma-menu';
  menu.hidden = true;
  menu.innerHTML =
    '<div class="figma-menu-status" data-role="status"></div>' +
    '<div class="figma-menu-section" data-role="files"></div>' +
    '<div class="figma-menu-section" data-role="actions"></div>' +
    '<div class="figma-menu-section" data-role="modes"></div>' +
    '<div class="figma-menu-note" data-role="note" hidden></div>';
  document.body.appendChild(menu);

  const parts = {
    status: menu.querySelector('[data-role="status"]'),
    files: menu.querySelector('[data-role="files"]'),
    actions: menu.querySelector('[data-role="actions"]'),
    modes: menu.querySelector('[data-role="modes"]'),
    note: menu.querySelector('[data-role="note"]')
  };

  function send(action, value) {
    vscode.postMessage({ type: 'figmaMenu', action, value });
  }

  function menuButton(label, action, value, options) {
    const settings = options || {};
    const el = document.createElement('button');
    el.className = 'figma-menu-item';
    el.type = 'button';
    el.textContent = label;
    el.disabled = settings.disabled === true;
    if (settings.selected) el.classList.add('is-selected');
    if (settings.hint) el.title = settings.hint;
    el.addEventListener('click', () => {
      if (settings.keepOpen !== true) note('');
      send(action, value);
    });
    return el;
  }

  function note(text) {
    parts.note.textContent = text || '';
    parts.note.hidden = !text;
  }

  function openMenu() {
    const rect = figma.getBoundingClientRect();
    // Anchored to the button, but never past the window edge — the bar sits at the very top.
    const left = Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    menu.hidden = false;
    send('refresh');
  }

  function closeMenu() {
    menu.hidden = true;
    note('');
  }

  document.addEventListener('mousedown', (event) => {
    if (menu.hidden) return;
    if (menu.contains(event.target) || figma.contains(event.target)) return;
    closeMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) closeMenu();
  });

  function renderMenu(data) {
    parts.status.replaceChildren();
    for (const row of data.rows || []) {
      const line = document.createElement('div');
      line.className = 'figma-menu-row';
      line.innerHTML =
        `<span class="figma-menu-key"></span>` +
        `<span class="toolbar-dot ${row.state === 'ok' ? 'on' : row.state === 'off' ? 'off' : ''}"></span>` +
        `<span class="figma-menu-value"></span>`;
      line.querySelector('.figma-menu-key').textContent = row.label;
      line.querySelector('.figma-menu-value').textContent = row.value;
      parts.status.appendChild(line);
    }

    // Which open file the daemon talks to. One entry means there is nothing to decide.
    parts.files.replaceChildren();
    if ((data.files || []).length > 1) {
      parts.files.appendChild(heading('Bound file'));
      for (const file of data.files) {
        parts.files.appendChild(
          menuButton(file.title, 'bindFile', file.title, {
            selected: file.bound,
            disabled: data.busy,
            hint: 'Point the daemon at this file'
          })
        );
      }
    }

    parts.actions.replaceChildren();
    parts.actions.appendChild(heading('Connection'));
    parts.actions.appendChild(
      menuButton(data.busy ? 'Working…' : 'Connect', 'connect', undefined, {
        disabled: data.busy || !data.cliFound,
        hint: 'Patch, start Figma if needed, and bring the daemon up'
      })
    );
    parts.actions.appendChild(
      menuButton('Restart daemon', 'daemonRestart', undefined, { disabled: data.busy || !data.cliFound })
    );
    parts.actions.appendChild(
      menuButton('Stop daemon', 'daemonStop', undefined, { disabled: data.busy || !data.cliFound })
    );

    parts.actions.appendChild(heading('Canvas'));
    parts.actions.appendChild(
      menuButton(data.undo.label, 'undo', undefined, {
        disabled: data.busy || !data.undo.enabled,
        hint: 'Removes only what the last render created'
      })
    );

    parts.actions.appendChild(heading('Working directory'));
    parts.actions.appendChild(
      menuButton(data.agentsReady ? 'Rules up to date' : 'Prepare this folder', 'initAgent', undefined, {
        disabled: data.busy || data.agentsReady || !data.cliFound,
        hint: 'Writes AGENTS.md and the Cursor rule so Claude knows the CLI'
      })
    );
    const where = document.createElement('div');
    where.className = 'figma-menu-path';
    where.textContent = data.cwd || 'no folder chosen yet';
    parts.actions.appendChild(where);

    parts.modes.replaceChildren();
    parts.modes.appendChild(heading('Mode'));
    const modes = [
      ['yolo', 'Yolo — patched app, CDP'],
      ['safe', 'Safe — plugin, no patching'],
      ['browser', 'Browser — Chromium profile']
    ];
    for (const [value, label] of modes) {
      parts.modes.appendChild(
        menuButton(label, 'setMode', value, { selected: data.mode === value, disabled: data.busy })
      );
    }

    parts.modes.appendChild(heading('Appearance'));
    const themes = [
      ['system', 'System — follow macOS'],
      ['light', 'Light'],
      ['dark', 'Dark']
    ];
    for (const [value, label] of themes) {
      parts.modes.appendChild(
        menuButton(label, 'setTheme', value, { selected: (data.theme || 'system') === value })
      );
    }

    if (!data.cliFound) {
      note('figma-cli not found — set "figmaCli" in ~/.figma-ds-cli/panel.json');
    }
  }

  function heading(text) {
    const el = document.createElement('div');
    el.className = 'figma-menu-heading';
    el.textContent = text;
    return el;
  }

  // Asking on startup would be a modal in the way; the host answers with the current one.
  vscode.postMessage({ type: 'toolbar', action: 'requestCwd' });

})();
