/* IRIS shared UI helpers: escaping, toasts, password show/hide. Used by the login page and the app. */
(function () {
  var EYE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10.7 10.7 0 0112 5c6.4 0 10 7 10 7a17.6 17.6 0 01-3.2 4M6.6 6.6A17.5 17.5 0 002 12s3.6 7 10 7c1.7 0 3.2-.4 4.5-1M9.9 9.9a3 3 0 004.2 4.2"/></svg>';
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /** Markup for a password box with a Show/Hide button. Every place a password is typed or revealed uses this. */
  function pwField(id, label, opts) {
    opts = opts || {};
    return '<div class="field"><label for="' + id + '">' + esc(label) + '</label><div class="pw-wrap">' +
      '<input type="password" id="' + id + '" autocomplete="' + (opts.autocomplete || 'current-password') + '"' + (opts.readonly ? ' readonly' : '') + (opts.value ? ' value="' + esc(opts.value) + '"' : '') + ' spellcheck="false" autocapitalize="off" autocorrect="off">' +
      '<button type="button" class="pw-toggle" data-pw-for="' + id + '" aria-label="Show password" aria-pressed="false" title="Show password">' + EYE + '</button></div>' +
      (opts.hint ? '<span class="hint">' + esc(opts.hint) + '</span>' : '') + '</div>';
  }
  /** Works for markup written by pwField AND for static markup that has the same classes. */
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.pw-toggle'); if (!b) return;
    var input = document.getElementById(b.getAttribute('data-pw-for')); if (!input) return;
    var show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    b.setAttribute('aria-pressed', show ? 'true' : 'false'); b.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); b.title = show ? 'Hide password' : 'Show password';
    b.innerHTML = show ? EYE_OFF : EYE; input.focus();
  });
  /** Put every password box back to hidden (called when a dialog closes or a form resets). */
  function hideAllPasswords(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('.pw-wrap input'), function (i) { i.type = 'password'; });
    Array.prototype.forEach.call((root || document).querySelectorAll('.pw-toggle'), function (b) { b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', 'Show password'); b.innerHTML = EYE; });
  }

  function toast(msg, kind) {
    var host = document.getElementById('toasts'); if (!host) return;
    var t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.setAttribute('role', kind === 'err' ? 'alert' : 'status');
    t.innerHTML = '<span>' + esc(msg) + '</span><button aria-label="Dismiss">×</button>'; host.appendChild(t);
    var kill = function () { if (t.parentNode) t.parentNode.removeChild(t); }; t.querySelector('button').onclick = kill; setTimeout(kill, kind === 'err' ? 9000 : 4500);
  }
  /** Password rules, shown the same everywhere. Returns '' when fine. */
  function passwordProblem(pw, username) {
    if (!pw || pw.length < 10) return 'Use at least 10 characters.';
    if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Include at least one letter and one number.';
    if (/^(.)\1+$/.test(pw)) return 'Choose a password that is not one repeated character.';
    if (username && pw.toLowerCase().indexOf(String(username).toLowerCase()) > -1) return 'Do not include your username in your password.';
    return '';
  }
  window.IRISUI = { esc: esc, pwField: pwField, hideAllPasswords: hideAllPasswords, toast: toast, passwordProblem: passwordProblem };
})();
