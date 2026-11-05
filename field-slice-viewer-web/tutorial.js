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
    overlay.innerHTML = `<iframe title="教程示例工作台" tabindex="-1"></iframe><div class="tour-focus"></div><section class="tour-card"><button class="tour-close">退出教程 ×</button><div class="tour-badge">示例工作区 · 可直接操作</div><h2></h2><p class="tour-text"></p><div class="tour-actions"><button class="tour-prev">上一步</button><button class="tour-next primary">下一步</button></div></section>`;
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
      "description": "这里已经载入一个示例。你可以点击文件框或拖入自己的文件试试。教程内的操作不会替换原工作区。"
    }, {
      "target": "#planar",
      "title": "拖动矩形选择范围",
      "description": "在左图按住鼠标拖出一个矩形，松开即可选定范围。框选会吸附到最近的整数格点，并同步上方坐标输入框；左右两图随选区更新。左图下方的“恢复完整范围”可撤销裁剪。"
    }, {
      "target": "#plane-controls",
      "title": "左图选层",
      "description": "试着拖动左图下方的滑块，观察层号和图像变化。右图的层范围独立控制。"
    }, {
      "target": "#volume-controls",
      "title": "右图连续层范围",
      "description": "试着左右拖动两个圆圈，改变三维起止层；也可以点击“全部层”或“仅左图层”。"
    }, {
      "target": "#controls details:nth-child(1)",
      "title": "范围与恢复",
      "description": "可以直接修改 x、y、z 范围，继续调整第二步的选区。输入会实时更新两图；点击“恢复完整范围”可以恢复切面范围。"
    }, {
      "target": "#controls details:nth-child(2)",
      "title": "配色与色标",
      "description": "试着选择 Viridis、Rainbow 或自定义双色，再调整色标上下限。颜色会实时更新；超界格点用端点色显示并计数。点击“自动对称色标”可恢复覆盖数据的范围。"
    }, {
      "target": "#controls details:nth-child(3)",
      "title": "箭头间隔与大小",
      "description": "试着修改 X/Y/Z 间隔、箭头长度，或拖动头部与柄部滑块。间隔越小越密，默认 X=4、Y=4、Z=2；这些设置只影响显示，不改变原始数据。"
    }, {
      "target": "#left-view",
      "title": "切换 XY / XZ 平面",
      "description": "试着用左图上方的选框切换 XY 和 XZ，再拖动左图选层滑块。单切面文本只支持文件提供的方向，当前示例可以自由切换。"
    }, {
      "target": "#mode3",
      "title": "切换三维视图",
      "description": "试着在“体内箭头”和“边界长方体”之间切换，再拖动右图旋转，观察内部矢量与边界热图。"
    }, {
      "target": ".spatial-footer",
      "title": "保存图片与结束",
      "description": "保存平面 / 三维 PNG 会输出当前视图，并附竖向色条；重置视角恢复默认方向。完成后返回原工作区。可以导入自己的切片文件继续使用。"
    }];
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
    }
    function show() {
      details(index >= 4 && index <= 6 ? index - 4 : -1);
      const step = steps[index];
      card.querySelector('h2').textContent = `${index + 1} / ${steps.length} · ${step.title}`;
      card.querySelector('.tour-text').textContent = step.description;
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
