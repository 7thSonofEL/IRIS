/* Sign-in page: username and password, lockout messages, forced first password change. */
(function () {
  var $ = function (s) { return document.querySelector(s); }, A = IRISAPI, U = IRISUI;
  var q = new URLSearchParams(location.search), tempPw = '', who = '';
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () { });

  function show(box, text, info) { box.textContent = text; box.hidden = !text; box.classList.toggle('info', !!info); }
  if (q.get('expired')) show($('#msg'), 'Your session ended. Please sign in again.', true);
  if (q.get('out')) show($('#msg'), 'You have been signed out.', true);

  function go() { location.replace('index.html'); }
  function openChange() {
    $('#p-login').hidden = true; $('#p-change').hidden = false;
    $('#changeForm').innerHTML = (tempPw ? '' : U.pwField('op', 'Temporary password', { autocomplete: 'current-password' })) + U.pwField('np1', 'New password', { autocomplete: 'new-password' }) + U.pwField('np2', 'Type it again', { autocomplete: 'new-password' }) +
      '<ul class="pw-rules"><li>At least 10 characters</li><li>At least one letter and one number</li><li>Not your username</li></ul><button class="btn btn-primary" id="changeBtn" type="submit">Save and continue</button>';
    (tempPw ? $('#np1') : $('#op')).focus();
  }

  // already signed in?
  var ti = A.tokenInfo();
  if (ti && ti.exp > Date.now() && ti.scope === 'full' && !q.get('expired') && !q.get('out')) { go(); return; }
  if (ti && ti.exp > Date.now() && ti.scope === 'pwd') { who = (A.getUser() || {}).username || ''; openChange(); }

  if (!sessionStorage.getItem('iris_splashed')) { sessionStorage.setItem('iris_splashed', '1'); IRISSplash.play(function () { var u = $('#username'); if (u && !$('#p-login').hidden) u.focus(); }); }
  else $('#username').focus();

  $('#loginForm').addEventListener('submit', function (e) {
    e.preventDefault(); show($('#msg'), '');
    var u = $('#username').value.trim(), p = $('#password').value;
    if (!u || !p) { show($('#msg'), 'Enter your username and password.'); return; }
    var b = $('#loginBtn'); b.disabled = true; b.textContent = 'Signing in…';
    A.call('login', [u, p]).then(function (r) {
      b.disabled = false; b.textContent = 'Sign in';
      if (!r.success) { show($('#msg'), r.error || 'Could not sign in.'); $('#password').value = ''; U.hideAllPasswords($('#loginForm')); $('#password').focus(); return; }
      A.setSession(r.token, r.sk, r.user); who = r.user.username; tempPw = p;
      $('#password').value = ''; U.hideAllPasswords($('#loginForm'));
      if (r.mustChange) openChange(); else { tempPw = ''; go(); }
    }).catch(function (err) { b.disabled = false; b.textContent = 'Sign in'; show($('#msg'), err.code === 'offline' ? 'You are offline. Connect to the internet to sign in.' : err.message); });
  });

  $('#changeForm').addEventListener('submit', function (e) {
    e.preventDefault(); show($('#msg2'), '');
    var a = $('#np1').value, b2 = $('#np2').value;
    var bad = U.passwordProblem(a, who); if (bad) { show($('#msg2'), bad); return; }
    if (a !== b2) { show($('#msg2'), 'The two passwords do not match.'); return; }
    if (a === tempPw) { show($('#msg2'), 'Choose a different password from the temporary one.'); return; }
    var btn = $('#changeBtn'); btn.disabled = true; btn.textContent = 'Saving…';
    // after a page reload the temporary password is gone from memory, so ask for it
    var old = tempPw || ($('#op') ? $('#op').value : '');
    A.call('changePassword', [old, a]).then(function (r) {
      btn.disabled = false; btn.textContent = 'Save and continue';
      if (!r.success) { show($('#msg2'), r.error || 'Could not change the password.'); return; }
      A.setSession(r.token, r.sk, r.user); tempPw = ''; go();
    }).catch(function (err) { btn.disabled = false; btn.textContent = 'Save and continue'; show($('#msg2'), err.message); });
  });
})();
