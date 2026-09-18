(function () {
  'use strict';

  var MOD_ID = 'Car Clicker';
  var settings = { enabled: true, clickCookie: true, golden: true, red: false, cps: 100 };
  var ui = {};
  var clickCarry = 0;
  var lastLogic = Date.now();
  var seen = typeof WeakSet !== 'undefined' ? new WeakSet() : [];
  var clicked = typeof WeakSet !== 'undefined' ? new WeakSet() : [];
  var detected = 0;
  var clickedCount = 0;

  function has(collection, item) { return collection instanceof Array ? collection.indexOf(item) !== -1 : collection.has(item); }
  function add(collection, item) { if (collection instanceof Array) collection.push(item); else collection.add(item); }
  function log(message) { console.log('[Car Clicker] ' + message); }
  function save() { if (typeof Game.WriteSave === 'function') Game.WriteSave(1); }

  function refresh() {
    if (!ui.panel) return;
    ui.cps.value = settings.cps;
    ui.cpsValue.textContent = settings.cps + ' CPS';
    ui.cookie.checked = settings.clickCookie;
    ui.golden.checked = settings.golden;
    ui.red.checked = settings.red;
    ui.toggle.textContent = settings.enabled ? 'Stop' : 'Start';
    ui.toggle.className = settings.enabled ? 'ccai-stop' : 'ccai-start';
    ui.status.textContent = settings.enabled ? 'Running' : 'Paused';
    ui.stats.textContent = 'Golden detected: ' + detected + ' | clicked: ' + clickedCount;
  }

  function setEnabled(value) {
    settings.enabled = !!value;
    clickCarry = 0;
    lastLogic = Date.now();
    log(settings.enabled ? 'enabled.' : 'disabled.');
    refresh();
    save();
  }

  function toggle() { setEnabled(!settings.enabled); }

  function clickShimmers() {
    var shimmers = (Game.shimmers || []).slice();
    for (var i = 0; i < shimmers.length; i += 1) {
      var shimmer = shimmers[i];
      if (!shimmer || shimmer.type !== 'golden') continue;
      var isRed = !!shimmer.wrath;
      if ((!isRed && !settings.golden) || (isRed && !settings.red)) continue;
      if (!has(seen, shimmer)) {
        add(seen, shimmer);
        detected += 1;
        log((isRed ? 'wrath cookie' : 'golden cookie') + ' detected.');
      }
      if (has(clicked, shimmer)) continue;
      try {
        shimmer.pop();
        add(clicked, shimmer);
        clickedCount += 1;
        log((isRed ? 'wrath cookie' : 'golden cookie') + ' clicked.');
      } catch (error) {
        console.error('[Car Clicker] shimmer click failed:', error);
      }
    }
    refresh();
  }

  function logic() {
    var current = Date.now();
    var elapsed = Math.max(0, Math.min(2000, current - lastLogic));
    lastLogic = current;
    if (!settings.enabled) return;
    clickCarry += elapsed * settings.cps / 1000;
    var clicks = Math.min(200, Math.floor(clickCarry));
    clickCarry -= clicks;
    if (settings.clickCookie && typeof Game.ClickCookie === 'function') {
      for (var i = 0; i < clicks; i += 1) Game.ClickCookie();
    }
    clickShimmers();
  }

  function addStyles() {
    var style = document.createElement('style');
    style.textContent = '#ccai-panel{position:fixed;z-index:999999;left:12px;top:70px;width:245px;padding:12px;background:rgba(24,18,16,.96);border:2px solid #b8874c;border-radius:8px;color:#f3e0b0;font:13px Arial,sans-serif;box-shadow:0 3px 14px #000;}#ccai-panel h3{margin:0 0 8px;font-size:16px;color:#ffd27b;display:flex;justify-content:space-between;align-items:center;}#ccai-panel .ccai-collapse{width:auto;margin:0;padding:2px 6px;background:#5c4630;font-size:11px;}#ccai-panel.ccai-mini{width:auto;padding:8px;}#ccai-panel.ccai-mini h3{margin:0;}#ccai-panel.ccai-mini .ccai-body{display:none;}#ccai-panel label{display:block;margin:7px 0;}#ccai-panel input[type=range]{width:150px;vertical-align:middle;}#ccai-panel button{width:100%;padding:6px;margin-top:8px;border:1px solid #c99b5b;border-radius:4px;color:#fff;font-weight:bold;cursor:pointer;}#ccai-panel .ccai-start{background:#39723c;}#ccai-panel .ccai-stop{background:#8b3b32;}#ccai-panel .ccai-status{margin:6px 0;color:#9ee59e;}#ccai-panel .ccai-stats{margin-top:8px;font-size:11px;color:#d7c19c;}#ccai-panel .ccai-help{margin-top:7px;font-size:11px;color:#bba88c;}'
    document.head.appendChild(style);
  }

  function buildUi() {
    if (document.getElementById('ccai-panel')) return;
    addStyles();
    var panel = document.createElement('div');
    panel.id = 'ccai-panel';
    panel.innerHTML = '<h3>Car Clicker <button id="ccai-collapse" class="ccai-collapse">Minimize</button></h3><div class="ccai-body"><div class="ccai-status">Running</div><label>Speed: <input id="ccai-cps" type="range" min="1" max="1000" value="100"> <span id="ccai-cps-value">100 CPS</span></label><label><input id="ccai-cookie" type="checkbox" checked> Big cookie</label><label><input id="ccai-golden" type="checkbox" checked> Golden cookies</label><label><input id="ccai-red" type="checkbox"> Wrath cookies</label><button id="ccai-toggle" class="ccai-stop">Stop</button><div class="ccai-stats">Golden detected: 0 | clicked: 0</div><div class="ccai-help">Alt+E: start/stop · F7: stop</div></div>';
    document.body.appendChild(panel);
    ui.panel = panel;
    ui.collapse = panel.querySelector('#ccai-collapse');
    ui.status = panel.querySelector('.ccai-status');
    ui.cps = panel.querySelector('#ccai-cps');
    ui.cpsValue = panel.querySelector('#ccai-cps-value');
    ui.cookie = panel.querySelector('#ccai-cookie');
    ui.golden = panel.querySelector('#ccai-golden');
    ui.red = panel.querySelector('#ccai-red');
    ui.toggle = panel.querySelector('#ccai-toggle');
    ui.stats = panel.querySelector('.ccai-stats');
    ui.collapse.addEventListener('click', function () { panel.classList.toggle('ccai-mini'); ui.collapse.textContent = panel.classList.contains('ccai-mini') ? 'Open' : 'Minimize'; });
    ui.cps.addEventListener('input', function () { settings.cps = Math.max(1, Math.min(1000, Number(ui.cps.value) || 100)); refresh(); save(); });
    ui.cookie.addEventListener('change', function () { settings.clickCookie = ui.cookie.checked; save(); });
    ui.golden.addEventListener('change', function () { settings.golden = ui.golden.checked; save(); });
    ui.red.addEventListener('change', function () { settings.red = ui.red.checked; save(); });
    ui.toggle.addEventListener('click', toggle);
    refresh();
  }

  Game.registerMod(MOD_ID, {
    init: function () {
      buildUi();
      Game.registerHook('logic', logic);
      document.addEventListener('keydown', function (event) { if (event.repeat) return; if (event.altKey && event.code === 'KeyE') { toggle(); event.preventDefault(); } else if (event.code === 'F7') setEnabled(false); }, true);
      log('loaded and running automatically.');
    },
    save: function () { return JSON.stringify(settings); },
    load: function (data) {
      if (data) {
        try {
          var loaded = JSON.parse(data);
          for (var key in settings) if (Object.prototype.hasOwnProperty.call(loaded, key)) settings[key] = loaded[key];
        } catch (error) {}
      }
      settings.enabled = true;
    }
  });
})();
