/* The guided tour uses an isolated synthetic-data iframe; the user's workspace is untouched. */
(() => {
  const trigger = document.getElementById('start-tutorial');
  if (!trigger) return;
  trigger.onclick = () => {
    // Clone markup so formatting and script-tag whitespace cannot break tutorial isolation.
    const tutorialRoot = document.documentElement.cloneNode(true);
    tutorialRoot.querySelector('#tutorial-script').remove();
    tutorialRoot.querySelector('#start-tutorial').hidden = true;
    tutorialRoot.querySelector('#mode3 option[value=voxels]')?.remove();
    const tutorialHTML = '<!doctype html>' + tutorialRoot.outerHTML;
    const overlay = document.createElement('div');
    overlay.className = 'tour';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '交互使用教程');
    overlay.innerHTML = `<iframe title="教程示例工作台" tabindex="-1"></iframe><div class="tour-focus"></div><section class="tour-card"><button class="tour-close">退出教程 ×</button><div class="tour-badge">示例工作区 · 可直接操作</div><h2></h2><div class="tour-text"></div><div class="tour-actions"><button class="tour-prev">上一步</button><button class="tour-next primary">下一步</button></div></section>`;
    const main = document.querySelector('main');
    const previousInert = main.inert;
    main.inert = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = overlay.querySelector('iframe'),
      card = overlay.querySelector('.tour-card'),
      focus = overlay.querySelector('.tour-focus');
    let index = 0,
      active = false,
      timer,
      target;
    const close = () => {
      clearTimeout(timer);
      window.removeEventListener('resize', position);
      document.removeEventListener('keydown', keys);
      document.body.style.overflow = previousOverflow;
      main.inert = previousInert;
      overlay.remove();
      trigger.focus();
    };
    const keys = e => {
      if (e.key === 'Escape') close();
      // A shortcut pressed while the tutorial card has focus belongs to its
      // example workspace. Key events in the iframe are handled there once.
      if (active && !e.defaultPrevented && isUndoShortcut(e)) {
        e.preventDefault();
        demoWindow().undoWorkspace();
      }
    };
    overlay.querySelector('.tour-close').onclick = close;
    document.addEventListener('keydown', keys);
    const demoDocument = () => frame.contentDocument,
      demoWindow = () => frame.contentWindow;
    function set(id, value, event = 'input') {
      const e = demoDocument().getElementById(id);
      e.value = value;
      e.dispatchEvent(new Event(event, {
        bubbles: true
      }));
    }
    function details(n) {
      const es = demoDocument().querySelectorAll('details');
      es.forEach((e, i) => e.open = i === n);
    }
    const steps = [{
      "target": "#drop",
      "title": "导入与文件名",
      "description": "这里已经载入一个示例。你可以在此导入XY./XZ.文件或.bfslice文件。"
    }, {
      "target": "#planar",
      "title": "框选、缩放与平移",
      "gestures": [
        { "button": "left", "label": "左键", "text": "框选显示范围" },
        { "button": "wheel", "label": "滚轮", "text": "缩放选区" },
        { "button": "right", "label": "右键", "text": "拖动选区" }
      ]
    }, {
      "target": "#plane-controls",
      "title": "左图选层",
      "description": "拖动滑块选择不同层观察"
    }, {
      "target": "#volume-controls",
      "title": "右图连续层范围",
      "description": "拖动左右滑块选择起止层，选择“仅左图层”可只显示左图对应图层"
    }, {
      "target": "#controls details:nth-child(1)",
      "title": "范围与恢复",
      "description": "这里可以手动输入显示范围"
    }, {
      "target": "#controls details:nth-child(2)",
      "title": "配色与色标",
      "description": "这里是有关于颜色条的设置"
    }, {
      "target": "#controls details:nth-child(3)",
      "title": "箭头样式",
      "description": "这里可以设置箭头的样式"
    }, {
      "target": "#left-view",
      "title": "切换 XY / XZ 平面",
      "description": "在3D切片下这里可以设置XY切面与XZ切面"
    }, {
      "target": "#mode3",
      "title": "切换三维视图",
      "description": "这里可以设置不同的3D视图"
    }, {
      "target": "#plots",
      "title": "撤回上一步操作",
      "description": "可使用Ctrl+Z （Mac 使用 ⌘Z）撤回上一步"
    }];
    function renderDescription(step) {
      const body = card.querySelector('.tour-text');
      body.replaceChildren();
      if (!step.gestures) {
        body.textContent = step.description;
        return;
      }
      const list = document.createElement('ul');
      list.className = 'tour-gestures';
      const highlights = {
        left: '<path d="M14 2C8.5 2 4 6.5 4 12v3h10Z"/>',
        right: '<path d="M14 2c5.5 0 10 4.5 10 10v3H14Z"/>',
        wheel: '<rect x="12" y="6" width="4" height="8" rx="2"/>'
      };
      for (const gesture of step.gestures) {
        const row = document.createElement('li');
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('viewBox', '0 0 28 36');
        icon.setAttribute('role', 'img');
        icon.setAttribute('aria-label', gesture.label);
        icon.innerHTML = `<g fill="currentColor" stroke="none">${highlights[gesture.button]}</g><rect x="4" y="2" width="20" height="32" rx="10"/><path d="M4 15h20M14 2v13"/>`;
        const text = document.createElement('span');
        text.textContent = gesture.text;
        row.append(icon, text);
        list.append(row);
      }
      body.append(list);
    }
    function position() {
      if (!active || !target) return;
      const r = target.getBoundingClientRect(),
        vw = innerWidth,
        vh = innerHeight;
      const x = Math.max(4, r.left - 4),
        y = Math.max(4, r.top - 4),
        rw = Math.min(vw - 8, r.right + 4) - x,
        rh = Math.min(vh - 8, r.bottom + 4) - y;
      Object.assign(focus.style, {
        left: x + 'px',
        top: y + 'px',
        width: Math.max(1, rw) + 'px',
        height: Math.max(1, rh) + 'px'
      });
      const cw = card.offsetWidth,
        ch = card.offsetHeight;
      let cx, cy;
      if (vw - x - rw > cw + 24 || x > cw + 24) {
        const right = vw - x - rw > cw + 24;
        cx = right ? x + rw + 18 : x - cw - 18;
        cy = Math.max(52, Math.min(vh - ch - 12, y + rh / 2 - ch / 2));
      } else {
        cy = y > ch + 28 ? y - ch - 18 : y + rh + ch + 28 < vh ? y + rh + 18 : Math.max(48, vh - ch - 18);
        cx = Math.min(vw - cw - 12, Math.max(12, x + rw / 2 - cw / 2));
        if (rw > vw * .7) {
          cx = vw - cw - 18;
          cy = 48;
        }
      }
      Object.assign(card.style, {
        left: cx + 'px',
        top: Math.max(12, cy) + 'px'
      });
    }
    function resetExample() {
      set('left-view', 'XY', 'change');
      set('mode3', 'arrows', 'change');
      demoDocument().getElementById('full').click();
      set('stride-x', 4);
      set('stride-y', 4);
      set('stride-z', 2);
      set('scale', 4);
      set('head-size', 1);
      set('shaft-size', 1);
      set('palette', 'diverging', 'change');
      demoDocument().getElementById('autoColor').click();
      demoDocument().getElementById('all').click();
      set('plane', 8);
      demoWindow().apply();
      demoWindow().resetWorkspaceHistory();
    }
    function show() {
      details(index >= 4 && index <= 6 ? index - 4 : -1);
      const step = steps[index];
      card.querySelector('h2').textContent = `${index + 1} / ${steps.length} · ${step.title}`;
      renderDescription(step);
      card.querySelector('.tour-prev').disabled = index === 0;
      card.querySelector('.tour-next').textContent = index === steps.length - 1 ? '完成教程' : '下一步';
      target = demoDocument().querySelector(step.target);
      (index === 1 || index === 2 || index === 3 || index >= 7 ? demoDocument().getElementById('plots') : target).scrollIntoView({
        block: index === 0 || index >= 4 && index <= 6 ? 'center' : 'start',
        behavior: 'instant'
      });
      position();
      clearTimeout(timer);
      timer = setTimeout(position, 120);
    }
    card.querySelector('.tour-prev').onclick = () => {
      if (index > 0) {
        index--;
        show();
      }
    };
    card.querySelector('.tour-next').onclick = () => {
      if (index === steps.length - 1) close();else {
        index++;
        show();
      }
    };
    frame.onload = async () => {
      if (demoDocument().URL === 'about:blank') return;
      try {
        if (typeof demoWindow().importFile !== 'function') throw Error('示例脚本未能载入，请确认文件夹完整，若使用本地服务请确认服务仍在运行。');
        await demoWindow().importFile(createTutorialExampleFile());
        resetExample();
        demoDocument().addEventListener('keydown', keys);
        demoDocument().addEventListener('scroll', position, true);
        demoDocument().addEventListener('input', () => requestAnimationFrame(position));
        demoDocument().addEventListener('change', () => requestAnimationFrame(position));
        active = true;
        show();
        card.querySelector('.tour-next').disabled = false;
        card.querySelector('.tour-next').focus();
      } catch (error) {
        card.querySelector('h2').textContent = '示例加载失败';
        card.querySelector('.tour-text').textContent = error.message;
        overlay.querySelector('.tour-close').focus();
      }
    };
    window.addEventListener('resize', position);
    card.querySelector('h2').textContent = '正在载入示例…';
    card.querySelector('.tour-next').disabled = true;
    card.querySelector('.tour-prev').disabled = true;
    frame.srcdoc = tutorialHTML;
    // Attach only after setting srcdoc and its handler, avoiding an about:blank load race.
    document.body.append(overlay);
  };
})();
