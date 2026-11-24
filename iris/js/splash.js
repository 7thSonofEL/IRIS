/* IRIS opening splash. About 2.6 seconds, tap or press a key to skip, plain fade if the device asks for reduced motion. */
(function () {
  function play(done) {
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var el = document.createElement('div'); el.id = 'splash'; el.setAttribute('role', 'presentation');
    el.innerHTML = '<div class="sp-rings" aria-hidden="true"><i></i><i></i><i></i></div><img class="sp-logo" alt="" src="img/logo.png"><div class="sp-word" aria-hidden="true">IRIS</div><div class="sp-sub">Intelligence Request Information System</div><div class="sp-skip">Tap to skip</div>';
    if (reduce) el.classList.add('reduce');
    document.body.appendChild(el);
    var finished = false;
    function end() { if (finished) return; finished = true; el.classList.add('out'); setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); if (done) done(); }, reduce ? 120 : 380); document.removeEventListener('keydown', end); }
    el.addEventListener('click', end); document.addEventListener('keydown', end);
    setTimeout(end, reduce ? 900 : 2600);
  }
  window.IRISSplash = { play: play };
})();
