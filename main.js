(function () {
  'use strict';

  var MOD_ID = 'Car Clicker';
  var DISPLAY_NAME = 'CrumbPilot';
  var sampleBlocks = [
    { type: 'buyBuilding', target: 'cheapest' },
    { type: 'wait', seconds: 10 },
    { type: 'loop' }
  ];
  var defaults = {
    autoCookie: true, golden: true, red: false, cps: 100,
    autoBuildings: false, autoUpgrades: false,
    buildingInterval: 60, upgradeInterval: 60,
    minimized: false, x: 12, y: 70,
    scripts: [{ id: 'starter', name: 'My first loop', blocks: sampleBlocks }],
    selectedScriptId: 'starter'
  };
  var settings = {};
  var stats = { cookieClicks: 0, goldenDetected: 0, goldenClicked: 0, wrathDetected: 0, wrathClicked: 0, buildingsBought: 0, upgradesBought: 0 };
  var ui = {};
  var runs = {};
  var carry = 0;
  var lastLogic = Date.now();
  var lastBuildingPurchase = 0;
  var lastUpgradePurchase = 0;
  var lastPaint = 0;
  var seen = new WeakSet();
  var popped = new WeakSet();
  var panelDrag = null;
  var draggedBlock = -1;
  var selectedBlock = -1;

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function reset() { settings = clone(defaults); }
  reset();
  function log(message) { console.log('[' + DISPLAY_NAME + '] ' + message); }
  function save() { if (typeof Game.WriteSave === 'function') Game.WriteSave(1); }
  function fmt(value) { return Number(value || 0).toLocaleString(); }
  function cleanNumber(value, min, max, fallback) {
    var parsed = Number(value);
    return isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  }
  function scriptById(id) {
    for (var i = 0; i < settings.scripts.length; i += 1) if (settings.scripts[i].id === id) return settings.scripts[i];
    return null;
  }
  function selectedScript() { return scriptById(settings.selectedScriptId); }
  function stateFor(id) {
    if (!runs[id]) runs[id] = { running: false, program: [], pc: 0, waitUntil: 0, error: '', nextTick: 0 };
    return runs[id];
  }
  function newId() { return 'script-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }
  function stopRun(id) { var run = stateFor(id); run.running = false; run.waitUntil = 0; }

  function isCookieShimmer(shimmer) { return !!(shimmer && (shimmer.type === 'golden' || shimmer.type === 'wrath' || shimmer.wrath)); }
  function clickShimmers() {
    var shimmers = (Game.shimmers || []).slice();
    for (var i = 0; i < shimmers.length; i += 1) {
      var shimmer = shimmers[i];
      if (!isCookieShimmer(shimmer)) continue;
      var wrath = !!shimmer.wrath || shimmer.type === 'wrath';
      if (!seen.has(shimmer)) {
        seen.add(shimmer);
        if (wrath) stats.wrathDetected += 1;
        else stats.goldenDetected += 1;
        log((wrath ? 'wrath' : 'golden') + ' cookie detected.');
      }
      if ((wrath ? !settings.red : !settings.golden) || popped.has(shimmer)) continue;
      try {
        shimmer.pop();
        popped.add(shimmer);
        if (wrath) stats.wrathClicked += 1;
        else stats.goldenClicked += 1;
        log((wrath ? 'wrath' : 'golden') + ' cookie clicked.');
      } catch (error) { console.error('[' + DISPLAY_NAME + '] shimmer click failed:', error); }
    }
  }

  function buyOneBuilding(target) {
    var buildings = (Game.ObjectsById || []).filter(function (building) {
      return building && building.unlocked && typeof building.buy === 'function' && typeof building.getPrice === 'function' && Game.cookies >= building.getPrice();
    });
    if (!buildings.length) return false;
    var chosen = null;
    if (!target || target === 'cheapest') {
      buildings.sort(function (a, b) { return a.getPrice() - b.getPrice(); });
      chosen = buildings[0];
    } else {
      for (var i = 0; i < buildings.length; i += 1) if (buildings[i].name === target) chosen = buildings[i];
    }
    if (!chosen) return false;
    var before = chosen.amount;
    chosen.buy(1);
    if (typeof before === 'number' && chosen.amount <= before) return false;
    stats.buildingsBought += 1;
    log('bought building: ' + chosen.name);
    return true;
  }

  function affordableUpgrades() {
    return (Game.UpgradesInStore || []).filter(function (upgrade) {
      return upgrade && (!upgrade.pool || upgrade.pool === '') && typeof upgrade.buy === 'function' && typeof upgrade.getPrice === 'function' && Game.cookies >= upgrade.getPrice();
    });
  }
  function buyOneUpgrade() {
    var upgrades = affordableUpgrades();
    if (!upgrades.length) return false;
    upgrades.sort(function (a, b) { return a.getPrice() - b.getPrice(); });
    var upgrade = upgrades[0];
    upgrade.buy();
    if (!upgrade.bought) return false;
    stats.upgradesBought += 1;
    log('bought upgrade: ' + upgrade.name);
    return true;
  }

  function autoBuy(now) {
    if (settings.autoBuildings && now - lastBuildingPurchase >= settings.buildingInterval * 1000) {
      lastBuildingPurchase = now;
      for (var i = 0; i < 100 && buyOneBuilding('cheapest'); i += 1) {}
    }
    if (settings.autoUpgrades && now - lastUpgradePurchase >= settings.upgradeInterval * 1000) {
      lastUpgradePurchase = now;
      for (var j = 0; j < 100 && buyOneUpgrade(); j += 1) {}
    }
  }

  function validateBlocks(blocks) {
    if (!Array.isArray(blocks) || blocks.length > 200) throw new Error('A script needs 0–200 blocks.');
    var program = [];
    var stack = [];
    for (var i = 0; i < blocks.length; i += 1) {
      var block = blocks[i] || {};
      var step = { type: block.type, index: i, jump: -1, block: block };
      if (block.type === 'if') {
        if (!/^(COOKIES|CPS)$/.test(block.metric) || !/^(>=|<=|==|>|<)$/.test(block.operator) || !isFinite(Number(block.value)) || Number(block.value) < 0) throw new Error('Block ' + (i + 1) + ': invalid condition.');
        stack.push({ ifIndex: i, elseIndex: -1 });
      } else if (block.type === 'else') {
        if (!stack.length || stack[stack.length - 1].elseIndex !== -1) throw new Error('Block ' + (i + 1) + ': ELSE needs one matching IF.');
        stack[stack.length - 1].elseIndex = i;
      } else if (block.type === 'end') {
        if (!stack.length) throw new Error('Block ' + (i + 1) + ': END needs an IF.');
        var branch = stack.pop();
        program[branch.ifIndex].jump = branch.elseIndex >= 0 ? branch.elseIndex + 1 : i + 1;
        if (branch.elseIndex >= 0) program[branch.elseIndex].jump = i + 1;
      } else if (block.type === 'wait') {
        if (!isFinite(Number(block.seconds)) || Number(block.seconds) < 0 || Number(block.seconds) > 86400) throw new Error('Block ' + (i + 1) + ': wait must be 0–86400 seconds.');
      } else if (block.type !== 'buyBuilding' && block.type !== 'buyUpgrade' && block.type !== 'loop') {
        throw new Error('Block ' + (i + 1) + ': unknown action.');
      }
      program.push(step);
    }
    if (stack.length) throw new Error('Block ' + (stack[0].ifIndex + 1) + ': add an END block.');
    return program;
  }
  function conditionTrue(block) {
    var value = block.metric === 'CPS' ? Number(Game.cookiesPs) : Number(Game.cookies);
    var target = Number(block.value);
    if (block.operator === '>=') return value >= target;
    if (block.operator === '<=') return value <= target;
    if (block.operator === '>') return value > target;
    if (block.operator === '<') return value < target;
    return value === target;
  }
  function toggleScript(id) {
    var script = scriptById(id);
    if (!script) return;
    var run = stateFor(id);
    if (run.running) { stopRun(id); log('stopped script: ' + script.name); }
    else {
      try {
        run.program = validateBlocks(script.blocks);
        if (!run.program.length) throw new Error('Add a block before running.');
        run.pc = 0;
        run.waitUntil = 0;
        run.nextTick = 0;
        run.error = '';
        run.running = true;
        log('started script: ' + script.name);
      } catch (error) { run.error = error.message; run.running = false; }
    }
    renderScriptList();
    paintStudio();
    paintPanel();
  }
  function runScripts(now) {
    for (var s = 0; s < settings.scripts.length; s += 1) {
      var script = settings.scripts[s];
      var run = stateFor(script.id);
      if (!run.running || now < run.waitUntil || now < run.nextTick) continue;
      try {
        for (var steps = 0; steps < 20 && run.running; steps += 1) {
          if (run.pc >= run.program.length) { run.running = false; break; }
          var step = run.program[run.pc];
          if (step.type === 'buyBuilding') { buyOneBuilding(step.block.target); run.pc += 1; }
          else if (step.type === 'buyUpgrade') { buyOneUpgrade(); run.pc += 1; }
          else if (step.type === 'wait') {
            run.pc += 1;
            run.waitUntil = now + Number(step.block.seconds) * 1000;
            break;
          } else if (step.type === 'if') run.pc = conditionTrue(step.block) ? run.pc + 1 : step.jump;
          else if (step.type === 'else') run.pc = step.jump;
          else if (step.type === 'end') run.pc += 1;
          else if (step.type === 'loop') { run.pc = 0; run.nextTick = now + 100; break; }
        }
        if (steps >= 20) run.nextTick = now + 100;
      } catch (error) {
        run.running = false;
        run.error = 'Block ' + (run.pc + 1) + ': ' + error.message;
        log(script.name + ': ' + run.error);
      }
    }
  }

  function logic() {
    var now = Date.now();
    var elapsed = Math.max(0, Math.min(2000, now - lastLogic));
    lastLogic = now;
    clickShimmers();
    autoBuy(now);
    runScripts(now);
    if (settings.autoCookie && settings.cps > 0 && typeof Game.ClickCookie === 'function') {
      carry += elapsed * settings.cps / 1000;
      var clicks = Math.min(200, Math.floor(carry));
      carry -= clicks;
      for (var i = 0; i < clicks; i += 1) { Game.ClickCookie(); stats.cookieClicks += 1; }
    }
    if (now - lastPaint > 300) { lastPaint = now; paintStatus(); }
  }

  function defaultBlock(type) {
    if (type === 'buyBuilding') return { type: type, target: 'cheapest' };
    if (type === 'wait') return { type: type, seconds: 10 };
    if (type === 'if') return { type: type, metric: 'COOKIES', operator: '>=', value: 1000000 };
    return { type: type };
  }
  function scriptChanged(script) {
    stopRun(script.id);
    stateFor(script.id).error = '';
    save();
    renderBlocks();
    renderScriptList();
    paintStudio();
  }
  function appendBlock(type) {
    var script = selectedScript();
    if (!script || script.blocks.length >= 198) return;
    var position = selectedBlock < 0 ? script.blocks.length : selectedBlock + 1;
    if (type !== 'loop' && position > 0 && script.blocks[position - 1].type === 'loop') position -= 1;
    var added = type === 'if' ? [defaultBlock('if'), defaultBlock('else'), defaultBlock('end')] : [defaultBlock(type)];
    script.blocks.splice.apply(script.blocks, [position, 0].concat(added));
    selectedBlock = position;
    scriptChanged(script);
    var row = ui.canvas.querySelector('[data-index="' + position + '"]');
    if (row) row.scrollIntoView({ block: 'nearest' });
  }
  function createScript(duplicate) {
    var source = selectedScript();
    if (settings.scripts.length >= 20) return;
    var script = { id: newId(), name: duplicate && source ? source.name + ' copy' : 'New script ' + (settings.scripts.length + 1), blocks: duplicate && source ? clone(source.blocks) : [] };
    settings.scripts.push(script);
    settings.selectedScriptId = script.id;
    selectedBlock = -1;
    save();
    renderScriptList();
    renderBlocks();
    paintStudio();
    ui.scriptName.focus();
    ui.scriptName.select();
  }
  function removeScript() {
    var script = selectedScript();
    if (!script || settings.scripts.length === 1 || !window.confirm('Delete "' + script.name + '"?')) return;
    stopRun(script.id);
    settings.scripts = settings.scripts.filter(function (item) { return item.id !== script.id; });
    delete runs[script.id];
    settings.selectedScriptId = settings.scripts[0].id;
    selectedBlock = -1;
    save();
    renderScriptList();
    renderBlocks();
    paintStudio();
  }

  function element(tag, className, label) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (label !== undefined) node.textContent = label;
    return node;
  }
  function menu(options, value, onChange) {
    var select = element('select', 'cc-field');
    for (var i = 0; i < options.length; i += 1) {
      var option = element('option', '', options[i].label);
      option.value = options[i].value;
      select.appendChild(option);
    }
    select.value = value;
    select.onchange = function () { onChange(this.value); };
    return select;
  }
  function amount(value, min, max, onChange) {
    var input = element('input', 'cc-field cc-number');
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.value = String(value);
    input.onchange = function () { onChange(cleanNumber(this.value, min, max, min)); };
    return input;
  }
  function toolButton(label, title, action, disabled) {
    var button = element('button', 'cc-tool', label);
    button.type = 'button';
    button.title = title;
    button.setAttribute('aria-label', title);
    button.disabled = !!disabled;
    button.onclick = function (event) { event.stopPropagation(); action(); };
    return button;
  }
  function renderScriptList() {
    if (!ui.scriptList) return;
    ui.scriptList.innerHTML = '';
    for (var i = 0; i < settings.scripts.length; i += 1) {
      (function (script) {
        var button = element('button', 'cc-script-item' + (script.id === settings.selectedScriptId ? ' selected' : ''));
        button.type = 'button';
        button.dataset.id = script.id;
        var dot = element('span', 'cc-script-dot' + (stateFor(script.id).running ? ' on' : ''));
        var name = element('span', 'cc-script-label', script.name);
        button.appendChild(dot);
        button.appendChild(name);
        button.onclick = function () {
          settings.selectedScriptId = script.id;
          selectedBlock = -1;
          save();
          renderScriptList();
          renderBlocks();
          paintStudio();
        };
        ui.scriptList.appendChild(button);
      })(settings.scripts[i]);
    }
  }
  function renderBlocks() {
    if (!ui.canvas) return;
    ui.canvas.innerHTML = '';
    var script = selectedScript();
    if (!script) return;
    if (!script.blocks.length) {
      var empty = element('div', 'cc-empty');
      empty.innerHTML = '<span class="cc-empty-icon">▤</span><strong>Your script starts here</strong><span>Choose an action on the left to add a block.</span>';
      ui.canvas.appendChild(empty);
      return;
    }
    var depth = 0;
    for (var i = 0; i < script.blocks.length; i += 1) {
      (function (index) {
        var block = script.blocks[index];
        if (block.type === 'else' || block.type === 'end') depth = Math.max(0, depth - 1);
        var row = element('div', 'cc-block cc-' + block.type + (selectedBlock === index ? ' selected' : ''));
        row.dataset.index = String(index);
        row.style.marginLeft = Math.min(depth * 20, 100) + 'px';
        row.setAttribute('role', 'group');
        row.setAttribute('aria-label', 'Block ' + (index + 1) + ': ' + block.type);
        row.onclick = function () { selectedBlock = index; ui.canvas.querySelectorAll('.cc-block').forEach(function (item) { item.classList.toggle('selected', item === row); }); };
        row.ondragover = function (event) { event.preventDefault(); row.classList.add('drop-target'); };
        row.ondragleave = function () { row.classList.remove('drop-target'); };
        row.ondrop = function (event) {
          event.preventDefault();
          row.classList.remove('drop-target');
          if (draggedBlock < 0 || draggedBlock === index) return;
          var moved = script.blocks.splice(draggedBlock, 1)[0];
          var destination = index;
          script.blocks.splice(destination, 0, moved);
          draggedBlock = -1;
          selectedBlock = destination;
          scriptChanged(script);
        };
        var grip = element('span', 'cc-grip', '⋮⋮');
        grip.title = 'Drag this block';
        grip.draggable = true;
        grip.ondragstart = function (event) { draggedBlock = index; event.dataTransfer.setData('text/plain', String(index)); event.dataTransfer.effectAllowed = 'move'; };
        grip.ondragend = function () { draggedBlock = -1; };
        row.appendChild(grip);
        var badge = element('span', 'cc-block-badge');
        var content = element('span', 'cc-block-content');
        if (block.type === 'buyBuilding') {
          badge.textContent = 'B';
          content.appendChild(document.createTextNode('Buy building'));
          var choices = [{ value: 'cheapest', label: 'cheapest' }];
          for (var b = 0; b < (Game.ObjectsById || []).length; b += 1) choices.push({ value: Game.ObjectsById[b].name, label: Game.ObjectsById[b].name });
          content.appendChild(menu(choices, block.target || 'cheapest', function (value) { block.target = value; scriptChanged(script); }));
        } else if (block.type === 'buyUpgrade') {
          badge.textContent = 'U';
          content.appendChild(document.createTextNode('Buy cheapest upgrade'));
        } else if (block.type === 'wait') {
          badge.textContent = '◷';
          content.appendChild(document.createTextNode('Wait'));
          content.appendChild(amount(block.seconds, 0, 86400, function (value) { block.seconds = value; scriptChanged(script); }));
          content.appendChild(document.createTextNode('seconds'));
        } else if (block.type === 'if') {
          badge.textContent = '?';
          content.appendChild(document.createTextNode('If'));
          content.appendChild(menu([{ value: 'COOKIES', label: 'cookies' }, { value: 'CPS', label: 'cookies/sec' }], block.metric, function (value) { block.metric = value; scriptChanged(script); }));
          content.appendChild(menu([{ value: '>=', label: '≥' }, { value: '<=', label: '≤' }, { value: '>', label: '>' }, { value: '<', label: '<' }, { value: '==', label: '=' }], block.operator, function (value) { block.operator = value; scriptChanged(script); }));
          content.appendChild(amount(block.value, 0, 1e300, function (value) { block.value = value; scriptChanged(script); }));
        } else if (block.type === 'else') { badge.textContent = '↳'; content.textContent = 'Else'; }
        else if (block.type === 'end') { badge.textContent = '✓'; content.textContent = 'End if'; }
        else if (block.type === 'loop') { badge.textContent = '↻'; content.textContent = 'Repeat from start'; }
        row.appendChild(badge);
        row.appendChild(content);
        var actions = element('span', 'cc-block-actions');
        actions.appendChild(toolButton('↑', 'Move block up', function () { var moved = script.blocks.splice(index, 1)[0]; script.blocks.splice(index - 1, 0, moved); selectedBlock = index - 1; scriptChanged(script); }, index === 0));
        actions.appendChild(toolButton('↓', 'Move block down', function () { var moved = script.blocks.splice(index, 1)[0]; script.blocks.splice(index + 1, 0, moved); selectedBlock = index + 1; scriptChanged(script); }, index === script.blocks.length - 1));
        actions.appendChild(toolButton('⧉', 'Duplicate block', function () { script.blocks.splice(index + 1, 0, clone(block)); selectedBlock = index + 1; scriptChanged(script); }, script.blocks.length >= 200));
        actions.appendChild(toolButton('×', 'Delete block', function () { script.blocks.splice(index, 1); selectedBlock = -1; scriptChanged(script); }));
        row.appendChild(actions);
        ui.canvas.appendChild(row);
        if (block.type === 'if' || block.type === 'else') depth += 1;
      })(i);
    }
  }

  function paintPanel() {
    if (!ui.panel) return;
    if (document.activeElement !== ui.buildingInterval) ui.buildingInterval.value = settings.buildingInterval;
    if (document.activeElement !== ui.upgradeInterval) ui.upgradeInterval.value = settings.upgradeInterval;
    ui.cps.value = settings.cps;
    ui.cpsValue.textContent = settings.cps + ' CPS';
    ui.autoCookie.checked = settings.autoCookie;
    ui.golden.checked = settings.golden;
    ui.red.checked = settings.red;
    ui.buildings.checked = settings.autoBuildings;
    ui.upgrades.checked = settings.autoUpgrades;
    ui.toggle.textContent = settings.autoCookie ? 'Stop autoclick' : 'Start autoclick';
    ui.toggle.className = settings.autoCookie ? 'cc-main-toggle stop' : 'cc-main-toggle start';
    ui.status.textContent = settings.autoCookie ? 'Autoclick running' : 'Autoclick stopped';
    ui.panel.classList.toggle('mini', settings.minimized);
    ui.open.style.display = settings.minimized ? 'block' : 'none';
  }
  function paintStatus() {
    if (!ui.panel) return;
    ui.stats.textContent = 'Big cookie: ' + fmt(stats.cookieClicks) + '  ·  Golden: ' + fmt(stats.goldenClicked) + '/' + fmt(stats.goldenDetected) + '  ·  Wrath: ' + fmt(stats.wrathClicked) + '/' + fmt(stats.wrathDetected) + '  ·  Buildings: ' + fmt(stats.buildingsBought) + '  ·  Upgrades: ' + fmt(stats.upgradesBought);
    var active = 0;
    for (var i = 0; i < settings.scripts.length; i += 1) if (stateFor(settings.scripts[i].id).running) active += 1;
    ui.scriptCount.textContent = active + ' / ' + settings.scripts.length + ' scripts running';
    if (!ui.studio.hidden) {
      var selected = selectedScript();
      var run = selected ? stateFor(selected.id) : null;
      ui.runButton.textContent = run && run.running ? '■ Stop this script' : '▶ Run this script';
      ui.runButton.className = run && run.running ? 'cc-run stop' : 'cc-run start';
      var validationError = '';
      if (selected) try { validateBlocks(selected.blocks); } catch (error) { validationError = error.message; }
      ui.runStatus.textContent = !run ? '' : run.error || validationError || (run.running ? 'Running · block ' + Math.min(run.pc + 1, run.program.length) + (run.waitUntil > Date.now() ? ' · waiting ' + Math.ceil((run.waitUntil - Date.now()) / 1000) + 's' : '') : selected && !selected.blocks.length ? 'Add your first block' : 'Ready');
      ui.runStatus.classList.toggle('error', !!(run && (run.error || validationError)));
      ui.canvas.querySelectorAll('.cc-block').forEach(function (row) { row.classList.toggle('active', !!(run && run.running && Number(row.dataset.index) === run.pc)); });
      ui.scriptList.querySelectorAll('.cc-script-item').forEach(function (row) {
        var script = scriptById(row.dataset.id);
        var indicator = row.querySelector('.cc-script-dot');
        if (indicator && script) indicator.classList.toggle('on', stateFor(script.id).running);
      });
    }
  }
  function paintStudio() {
    if (!ui.studio) return;
    var script = selectedScript();
    if (script && document.activeElement !== ui.scriptName) ui.scriptName.value = script.name;
    ui.deleteScript.disabled = settings.scripts.length <= 1;
    ui.addScript.disabled = settings.scripts.length >= 20;
    ui.copyScript.disabled = settings.scripts.length >= 20;
    ui.blockCount.textContent = script ? script.blocks.length + ' blocks' : '0 blocks';
    paintStatus();
  }
  function openStudio() { ui.studio.hidden = false; renderScriptList(); renderBlocks(); paintStudio(); ui.studioClose.focus(); }
  function closeStudio() { ui.studio.hidden = true; ui.studioOpen.focus(); }
  function setAutoclick(value) {
    settings.autoCookie = !!value;
    carry = 0;
    lastLogic = Date.now();
    paintPanel();
    save();
  }

  function addStyles() {
    var style = element('style');
    style.textContent = '\
#ccai-panel,#ccai-studio{color:#f4e8d1;font:13px Trebuchet MS,Arial,sans-serif;box-sizing:border-box} \
#ccai-panel button,#ccai-studio button,#ccai-studio input,#ccai-studio select{font:inherit} \
#ccai-panel button,#ccai-studio button{cursor:pointer} \
#ccai-panel{position:fixed;z-index:999990;left:12px;top:70px;width:310px;max-height:85vh;overflow:auto;background:#211710;border:3px solid #a77337;box-shadow:0 0 0 2px #301e10,0 8px 26px #000a} \
#ccai-panel.mini{display:none} \
#ccai-panel header{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#51341b;border-bottom:2px solid #a77337;font:bold 16px Georgia,serif;cursor:move} \
#ccai-panel header button{width:25px;height:23px;padding:0;border:1px solid #bb8851;background:#2d1e14;color:#fff} \
#ccai-panel .cc-body{padding:10px} \
#ccai-panel .cc-status{color:#b6ebae;font-weight:bold;margin-bottom:7px} \
#ccai-panel label{display:flex;align-items:center;gap:7px;margin:7px 0} \
#ccai-panel input[type=checkbox]{accent-color:#d59a42} \
#ccai-panel .cc-speed{display:grid;grid-template-columns:40px 1fr 68px;gap:6px;align-items:center} \
#ccai-panel .cc-speed input{min-width:0;width:100%} \
#ccai-panel .cc-speed strong{text-align:right;color:#ffcf79;font-size:11px} \
#ccai-panel .cc-buy-row{display:flex;justify-content:space-between;gap:5px;align-items:center} \
#ccai-panel .cc-buy-row input[type=number]{width:57px} \
#ccai-panel input[type=number]{padding:3px;background:#130e0b;color:#fff1d4;border:1px solid #9a7046} \
#ccai-panel .cc-section-title{margin:12px 0 7px;padding-top:9px;border-top:1px solid #5c422a;color:#eec786;font:bold 11px Arial;letter-spacing:1px} \
#ccai-panel .cc-main-toggle,#ccai-panel .cc-open-studio{width:100%;padding:7px;margin-top:7px;border:1px solid #c99b5b;color:#fff;font-weight:bold;background:#754c20} \
#ccai-panel .stop,#ccai-studio .stop{background:#873f34} \
#ccai-panel .start,#ccai-studio .start{background:#427446} \
#ccai-panel .cc-script-count{margin-top:5px;color:#d9c4a1;font-size:11px} \
#ccai-panel details{margin-top:10px;font-size:11px;color:#cbb596} \
#ccai-panel summary{cursor:pointer} \
#ccai-panel .cc-stats{margin-top:7px;line-height:1.5} \
#ccai-open{position:fixed;z-index:999991;left:8px;top:38px;width:28px;height:24px;padding:0;border:2px solid #b8874c;background:#39271d;color:#ffd27b;font:bold 16px monospace;cursor:pointer} \
#ccai-studio[hidden]{display:none!important} \
#ccai-studio{position:fixed;z-index:1000000;inset:0;display:flex;align-items:center;justify-content:center;padding:20px;background:#000b} \
#ccai-studio .cc-window{display:flex;flex-direction:column;width:min(1020px,96vw);height:min(720px,90vh);min-height:430px;background:#1e1711;border:4px solid #b37a3a;box-shadow:0 0 0 3px #392411,0 20px 60px #000} \
#ccai-studio .cc-top{display:flex;align-items:center;gap:10px;flex:none;padding:10px 14px;background:#51341b;border-bottom:3px solid #a77337} \
#ccai-studio .cc-brand{font:bold 20px Georgia,serif;color:#ffe1a5} \
#ccai-studio .cc-subtitle{font-size:11px;color:#ead0a4} \
#ccai-studio .cc-close{margin-left:auto;width:32px;height:30px;background:#392518;border:1px solid #bd8d53;color:#fff;font-size:20px} \
#ccai-studio .cc-layout{display:grid;grid-template-columns:180px 150px minmax(0,1fr);min-height:0;flex:1} \
#ccai-studio .cc-sidebar,#ccai-studio .cc-palette,#ccai-studio .cc-workspace{min-width:0;overflow:auto} \
#ccai-studio .cc-sidebar{background:#17120e;border-right:2px solid #684729;padding:12px} \
#ccai-studio .cc-palette{background:#211811;border-right:2px solid #684729;padding:12px} \
#ccai-studio .cc-workspace{display:flex;flex-direction:column;background:#241c15;padding:12px} \
#ccai-studio .cc-kicker{display:block;margin:0 0 8px;color:#edc88d;font:bold 11px Arial;letter-spacing:1.4px;text-transform:uppercase} \
#ccai-studio .cc-script-list{display:flex;flex-direction:column;gap:4px;margin-bottom:10px} \
#ccai-studio .cc-script-item{display:flex;align-items:center;gap:7px;width:100%;min-height:36px;padding:6px 8px;text-align:left;color:#edd8ba;background:#282018;border:1px solid #56412d;border-radius:4px} \
#ccai-studio .cc-script-item.selected{color:#fff4d5;background:#584024;border-color:#e0ac5c} \
#ccai-studio .cc-script-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap} \
#ccai-studio .cc-script-dot{flex:none;width:8px;height:8px;border-radius:50%;background:#7d756c} \
#ccai-studio .cc-script-dot.on{background:#8bde83;box-shadow:0 0 7px #8bde83} \
#ccai-studio .cc-script-actions{display:grid;grid-template-columns:1fr 1fr;gap:5px} \
#ccai-studio .cc-script-actions button{min-height:31px;padding:4px;color:#fff1d5;background:#46321f;border:1px solid #9e7241} \
#ccai-studio .cc-script-actions button:last-child{grid-column:span 2} \
#ccai-studio .cc-palette button{display:flex;align-items:center;gap:8px;width:100%;min-height:39px;margin:0 0 7px;padding:5px;text-align:left;color:#fff;border:2px solid #ffffff56;border-radius:6px 12px 12px 6px;font-weight:bold} \
#ccai-studio .cc-palette button.cc-buyBuilding,#ccai-studio .cc-palette button.cc-buyUpgrade{background:#a66122} \
#ccai-studio .cc-palette button.cc-wait{background:#3976a7} \
#ccai-studio .cc-palette button.cc-if,#ccai-studio .cc-palette button.cc-else,#ccai-studio .cc-palette button.cc-end{background:#a47b18} \
#ccai-studio .cc-palette button.cc-loop{background:#66489a} \
#ccai-studio .cc-palette .cc-hint{font-size:11px;line-height:1.5;color:#cfbfa6} \
#ccai-studio .cc-block-badge{display:inline-flex;align-items:center;justify-content:center;flex:none;width:22px;height:22px;border-radius:4px;background:#0004;font-weight:bold} \
#ccai-studio .cc-work-head{display:flex;align-items:center;gap:8px;flex:none;margin-bottom:10px} \
#ccai-studio .cc-script-name{min-width:0;flex:1;height:34px;padding:5px 8px;color:#fff3d6;background:#17100c;border:1px solid #9d7548;font:bold 15px Trebuchet MS,Arial,sans-serif} \
#ccai-studio .cc-block-count{color:#d8bc91;font-size:11px;white-space:nowrap} \
#ccai-studio .cc-canvas{flex:1;min-height:0;overflow:auto;padding:12px;background:#110e0b;border:2px dashed #674b32;border-radius:6px;scrollbar-color:#8b623a #17110e} \
#ccai-studio .cc-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;height:100%;color:#cfba9b;text-align:center} \
#ccai-studio .cc-empty-icon{font-size:35px;color:#d6a85e} \
#ccai-studio .cc-block{display:flex;align-items:center;gap:7px;min-height:46px;margin-bottom:6px;padding:5px 7px;color:#fff;border:2px solid #ffffff62;border-left-width:7px;border-radius:6px 13px 13px 6px;box-shadow:inset 0 -3px #0003} \
#ccai-studio .cc-block.selected{outline:3px solid #ffe2a0;outline-offset:1px} \
#ccai-studio .cc-block.active{box-shadow:0 0 0 3px #91df81,inset 0 -3px #0003} \
#ccai-studio .cc-block.drop-target{border-top:4px solid #fff7bd} \
#ccai-studio .cc-block.cc-buyBuilding,#ccai-studio .cc-block.cc-buyUpgrade{background:#9d5d1f} \
#ccai-studio .cc-block.cc-wait{background:#3976a7} \
#ccai-studio .cc-block.cc-if,#ccai-studio .cc-block.cc-else,#ccai-studio .cc-block.cc-end{background:#a47b18} \
#ccai-studio .cc-block.cc-loop{background:#66489a} \
#ccai-studio .cc-grip{flex:none;color:#fffbb9;cursor:grab;font-weight:bold;font-size:18px;letter-spacing:-4px;padding:4px} \
#ccai-studio .cc-block-content{display:flex;align-items:center;flex-wrap:wrap;gap:5px;min-width:0;flex:1;font-weight:bold} \
#ccai-studio .cc-field{min-width:0;max-width:130px;height:28px;padding:3px 5px;color:#fff7df;background:#251c15;border:1px solid #e0cba9;border-radius:4px;font-size:12px} \
#ccai-studio .cc-number{width:80px} \
#ccai-studio .cc-block-actions{display:flex;gap:3px;margin-left:auto} \
#ccai-studio .cc-tool{flex:none;width:26px;height:27px;padding:0;color:#fff;background:#0004;border:1px solid #ffffff71;border-radius:3px;font-size:16px} \
#ccai-studio .cc-bottom{display:flex;align-items:center;gap:10px;flex:none;margin-top:10px;padding-top:10px;border-top:1px solid #694d31} \
#ccai-studio .cc-run{min-width:160px;min-height:35px;padding:6px 10px;color:white;border:1px solid #ddd1ad;border-radius:4px;font-weight:bold} \
#ccai-studio .cc-run-status{color:#c6e8b6;font-size:12px} \
#ccai-studio .cc-run-status.error{color:#ffb2a4} \
#ccai-studio button:disabled{opacity:.45;cursor:not-allowed} \
#ccai-studio button:focus-visible,#ccai-studio input:focus-visible,#ccai-studio select:focus-visible,#ccai-panel button:focus-visible{outline:3px solid #fff2af;outline-offset:2px} \
@media(max-width:760px){#ccai-studio .cc-layout{grid-template-columns:130px minmax(0,1fr)}#ccai-studio .cc-palette{grid-column:1 / -1;grid-row:1;display:flex;flex-wrap:wrap;gap:5px;border-right:0;border-bottom:2px solid #684729;padding:7px}#ccai-studio .cc-palette .cc-kicker,#ccai-studio .cc-palette .cc-hint{display:none}#ccai-studio .cc-palette button{width:auto;min-height:31px;margin:0}#ccai-studio .cc-sidebar{grid-column:1;grid-row:2}#ccai-studio .cc-workspace{grid-column:2;grid-row:2}}';
    document.head.appendChild(style);
  }

  function buildUi() {
    if (document.getElementById('ccai-panel')) return;
    addStyles();
    var panel = element('div');
    panel.id = 'ccai-panel';
    panel.style.left = settings.x + 'px';
    panel.style.top = settings.y + 'px';
    panel.innerHTML = '<header><span>🍪 Car Clicker</span><button class="cc-minimize" aria-label="Minimize panel">—</button></header><div class="cc-body"><div class="cc-status">Autoclick running</div><label class="cc-speed"><span>Speed</span><input class="cc-cps" type="range" min="0" max="1000"><strong class="cc-cps-value">100 CPS</strong></label><label><input class="cc-auto" type="checkbox"> Big cookie autoclick</label><label><input class="cc-golden" type="checkbox"> Golden cookies</label><label><input class="cc-wrath" type="checkbox"> Wrath cookies</label><button class="cc-main-toggle">Stop autoclick</button><div class="cc-section-title">AUTO BUY</div><div class="cc-buy-row"><label><input class="cc-buildings" type="checkbox"> Buildings</label><label><input class="cc-building-seconds" type="number" min="1" max="86400"> sec</label></div><div class="cc-buy-row"><label><input class="cc-upgrades" type="checkbox"> Upgrades</label><label><input class="cc-upgrade-seconds" type="number" min="1" max="86400"> sec</label></div><div class="cc-section-title">SCRIPTS</div><button class="cc-open-studio">Open Script Studio</button><div class="cc-script-count"></div><details><summary>Statistics & shortcuts</summary><div class="cc-stats"></div><p>Alt+E: toggle autoclick · F7: stop autoclick</p></details></div>';
    panel.querySelector('header span').textContent = '🍪 ' + DISPLAY_NAME;
    document.body.appendChild(panel);
    var open = element('button', '', 'CP');
    open.id = 'ccai-open';
    open.title = 'Open ' + DISPLAY_NAME;
    document.body.appendChild(open);
    var studio = element('div');
    studio.id = 'ccai-studio';
    studio.hidden = true;
    studio.innerHTML = '<div class="cc-window" role="dialog" aria-modal="true" aria-label="Car Clicker Script Studio"><div class="cc-top"><div><div class="cc-brand">▦ Script Studio</div><div class="cc-subtitle">Build your own Cookie Clicker automation</div></div><button class="cc-close" aria-label="Close studio">×</button></div><div class="cc-layout"><aside class="cc-sidebar"><span class="cc-kicker">My scripts</span><div class="cc-script-list"></div><div class="cc-script-actions"><button class="cc-add-script">+ New</button><button class="cc-copy-script">⧉ Copy</button><button class="cc-delete-script">Delete selected</button></div></aside><aside class="cc-palette"><span class="cc-kicker">Add a block</span><button class="cc-buyBuilding" data-type="buyBuilding"><span class="cc-block-badge">B</span>Building</button><button class="cc-buyUpgrade" data-type="buyUpgrade"><span class="cc-block-badge">U</span>Upgrade</button><button class="cc-wait" data-type="wait"><span class="cc-block-badge">◷</span>Wait</button><button class="cc-if" data-type="if"><span class="cc-block-badge">?</span>If / Else</button><button class="cc-loop" data-type="loop"><span class="cc-block-badge">↻</span>Repeat</button><p class="cc-hint">Click a block in your script, then choose an action here to insert after it. Drag the dotted handle to reorder.</p></aside><main class="cc-workspace"><div class="cc-work-head"><input class="cc-script-name" aria-label="Script name" maxlength="40"><span class="cc-block-count"></span></div><div class="cc-canvas" aria-label="Script blocks"></div><div class="cc-bottom"><button class="cc-run start">▶ Run this script</button><span class="cc-run-status" role="status">Ready</span></div></main></div></div>';
    studio.querySelector('.cc-window').setAttribute('aria-label', DISPLAY_NAME + ' Script Studio');
    studio.querySelector('.cc-brand').textContent = '▦ ' + DISPLAY_NAME + ' Script Studio';
    document.body.appendChild(studio);

    ui.panel = panel;
    ui.open = open;
    ui.studio = studio;
    ui.status = panel.querySelector('.cc-status');
    ui.cps = panel.querySelector('.cc-cps');
    ui.cpsValue = panel.querySelector('.cc-cps-value');
    ui.autoCookie = panel.querySelector('.cc-auto');
    ui.golden = panel.querySelector('.cc-golden');
    ui.red = panel.querySelector('.cc-wrath');
    ui.buildings = panel.querySelector('.cc-buildings');
    ui.upgrades = panel.querySelector('.cc-upgrades');
    ui.buildingInterval = panel.querySelector('.cc-building-seconds');
    ui.upgradeInterval = panel.querySelector('.cc-upgrade-seconds');
    ui.toggle = panel.querySelector('.cc-main-toggle');
    ui.scriptCount = panel.querySelector('.cc-script-count');
    ui.stats = panel.querySelector('.cc-stats');
    ui.studioOpen = panel.querySelector('.cc-open-studio');
    ui.studioClose = studio.querySelector('.cc-close');
    ui.scriptList = studio.querySelector('.cc-script-list');
    ui.addScript = studio.querySelector('.cc-add-script');
    ui.copyScript = studio.querySelector('.cc-copy-script');
    ui.deleteScript = studio.querySelector('.cc-delete-script');
    ui.scriptName = studio.querySelector('.cc-script-name');
    ui.blockCount = studio.querySelector('.cc-block-count');
    ui.canvas = studio.querySelector('.cc-canvas');
    ui.runButton = studio.querySelector('.cc-run');
    ui.runStatus = studio.querySelector('.cc-run-status');

    panel.querySelector('.cc-minimize').onclick = function () { settings.minimized = true; paintPanel(); save(); };
    open.onclick = function () { settings.minimized = false; paintPanel(); save(); };
    ui.studioOpen.onclick = openStudio;
    ui.studioClose.onclick = closeStudio;
    studio.onclick = function (event) { if (event.target === studio) closeStudio(); };
    ui.addScript.onclick = function () { createScript(false); };
    ui.copyScript.onclick = function () { createScript(true); };
    ui.deleteScript.onclick = removeScript;
    ui.scriptName.onchange = function () {
      var script = selectedScript();
      if (!script) return;
      script.name = this.value.trim().slice(0, 40) || 'Untitled script';
      this.value = script.name;
      save();
      renderScriptList();
    };
    studio.querySelectorAll('.cc-palette button[data-type]').forEach(function (button) { button.onclick = function () { appendBlock(this.dataset.type); }; });
    ui.runButton.onclick = function () { var script = selectedScript(); if (script) toggleScript(script.id); };
    ui.cps.oninput = function () { settings.cps = cleanNumber(this.value, 0, 1000, 0); paintPanel(); save(); };
    ui.autoCookie.onchange = function () { setAutoclick(this.checked); };
    ui.golden.onchange = function () { settings.golden = this.checked; save(); };
    ui.red.onchange = function () { settings.red = this.checked; save(); };
    ui.buildings.onchange = function () { settings.autoBuildings = this.checked; lastBuildingPurchase = Date.now(); save(); };
    ui.upgrades.onchange = function () { settings.autoUpgrades = this.checked; lastUpgradePurchase = Date.now(); save(); };
    ui.buildingInterval.onchange = function () { settings.buildingInterval = cleanNumber(this.value, 1, 86400, 60); paintPanel(); save(); };
    ui.upgradeInterval.onchange = function () { settings.upgradeInterval = cleanNumber(this.value, 1, 86400, 60); paintPanel(); save(); };
    ui.toggle.onclick = function () { setAutoclick(!settings.autoCookie); };
    panel.querySelector('header').onmousedown = function (event) {
      if (event.target.tagName === 'BUTTON') return;
      panelDrag = { x: event.clientX - panel.offsetLeft, y: event.clientY - panel.offsetTop };
    };
    document.addEventListener('mousemove', function (event) {
      if (!panelDrag) return;
      panel.style.left = Math.max(0, event.clientX - panelDrag.x) + 'px';
      panel.style.top = Math.max(0, event.clientY - panelDrag.y) + 'px';
    });
    document.addEventListener('mouseup', function () {
      if (!panelDrag) return;
      settings.x = panel.offsetLeft;
      settings.y = panel.offsetTop;
      panelDrag = null;
      save();
    });
    paintPanel();
    renderScriptList();
    renderBlocks();
    paintStudio();
  }

  function normalizeSave(data) {
    reset();
    var loaded;
    try { loaded = JSON.parse(data || '{}'); } catch (error) { log('Could not read saved settings.'); return; }
    var source = loaded.settings || loaded;
    var keys = ['autoCookie', 'golden', 'red', 'cps', 'autoBuildings', 'autoUpgrades', 'buildingInterval', 'upgradeInterval', 'minimized', 'x', 'y'];
    for (var i = 0; i < keys.length; i += 1) if (Object.prototype.hasOwnProperty.call(source, keys[i])) settings[keys[i]] = source[keys[i]];
    if (Object.prototype.hasOwnProperty.call(source, 'clickCookie')) settings.autoCookie = source.clickCookie;
    if (Object.prototype.hasOwnProperty.call(source, 'enabled')) settings.autoCookie = source.enabled;
    settings.cps = cleanNumber(settings.cps, 0, 1000, 100);
    settings.buildingInterval = cleanNumber(settings.buildingInterval, 1, 86400, 60);
    settings.upgradeInterval = cleanNumber(settings.upgradeInterval, 1, 86400, 60);
    if (Array.isArray(source.scripts) && source.scripts.length) {
      settings.scripts = source.scripts.slice(0, 20).filter(function (script) { return script && typeof script.name === 'string' && Array.isArray(script.blocks); }).map(function (script) {
        return { id: String(script.id || newId()), name: script.name.slice(0, 40), blocks: script.blocks.slice(0, 200) };
      });
    } else if (Array.isArray(source.workflowBlocks)) {
      settings.scripts = [{ id: 'starter', name: 'My first loop', blocks: source.workflowBlocks.slice(0, 200) }];
    }
    if (!settings.scripts.length) settings.scripts = clone(defaults.scripts);
    settings.selectedScriptId = scriptById(source.selectedScriptId) ? source.selectedScriptId : settings.scripts[0].id;
    if (loaded.stats) for (var key in stats) if (Object.prototype.hasOwnProperty.call(loaded.stats, key)) stats[key] = cleanNumber(loaded.stats[key], 0, 1e300, 0);
    lastBuildingPurchase = Date.now();
    lastUpgradePurchase = Date.now();
    paintPanel();
    renderScriptList();
    renderBlocks();
    paintStudio();
  }

  Game.registerMod(MOD_ID, {
    init: function () {
      buildUi();
      Game.registerHook('logic', logic);
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && ui.studio && !ui.studio.hidden) { closeStudio(); return; }
        if (event.repeat) return;
        if (event.altKey && event.code === 'KeyE') { setAutoclick(!settings.autoCookie); event.preventDefault(); }
        else if (event.code === 'F7') setAutoclick(false);
      }, true);
      log('loaded.');
    },
    save: function () { return JSON.stringify({ settings: settings, stats: stats }); },
    load: function (data) { normalizeSave(data); }
  });
})();
