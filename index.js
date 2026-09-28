// UI 层：把触发按钮注入到输入框最左侧（#leftSendForm 左边），面板向上弹出。
// 按钮挂在 #nonQRFormItems 里，面板挂在 body 上 —— 面板用 fixed 定位，脱离酒馆自身的
// transform 祖先，才不会在手机上被 ST 的 mobile CSS 甩出视口。

import { KEY, isCompactPanelLayout, loadSettings, mergeInput, planAutoSuggest, planPanelPlacement, resolveContextEnd, safeError } from './core.js';
import { DEFAULT_EXPAND_PRESET, DEFAULT_SUGGEST_PRESET, SUGGEST_KINDS, SUGGEST_LABELS, migratePresets, previewMessages, suggestKind } from './assistant.js';
import { createService } from './service.js';

let mounted;
const getContext = () => globalThis.SillyTavern.getContext();

const ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M6.8 9.6h7.4"/><path d="M6.8 14h4.2"/><path d="m16 12.4.72 1.78 1.78.72-1.78.72L16 17.4l-.72-1.78-1.78-.72 1.78-.72z"/></svg>`;

const PANEL_HTML = `
  <header class="tia-head">
    <span class="tia-title">输入助手</span>
    <button type="button" class="tia-icon" data-action="close" aria-label="收起面板">×</button>
  </header>
  <div class="tia-tabs" role="tablist" aria-label="面板分区">
    <button type="button" class="tia-tab" role="tab" data-tab="suggest" aria-selected="true" aria-controls="tia-pane-suggest">选项</button>
    <button type="button" class="tia-tab" role="tab" data-tab="expand" aria-selected="false" aria-controls="tia-pane-expand">扩写</button>
    <button type="button" class="tia-tab" role="tab" data-tab="settings" aria-selected="false" aria-controls="tia-pane-settings">设置</button>
  </div>
  <div class="tia-body">
    <section id="tia-pane-suggest" class="tia-pane" role="tabpanel" aria-labelledby="tia-tab-suggest">
      <p class="tia-intro">按当前剧情生成 6 条可以接着发出去的方向：前 3 条是不同走向的正常分支，第 4 条偏新奇，第 5 条偏邪恶，第 6 条大幅推进时间线。点一条就送进输入框。</p>
      <div class="tia-row">
        <button type="button" data-action="suggest" class="tia-primary">生成选项</button>
        <button type="button" data-action="cancel" class="tia-secondary" hidden>取消</button>
      </div>
      <p id="tia-suggest-context" class="tia-hint"></p>
      <p id="tia-suggest-status" class="tia-status" role="status" aria-live="polite"></p>
      <div id="tia-suggest-list" class="tia-options"></div>
      <details class="tia-details"><summary>预览会发送的内容</summary><pre id="tia-suggest-preview"></pre></details>
    </section>
    <section id="tia-pane-expand" class="tia-pane" role="tabpanel" aria-labelledby="tia-tab-expand" hidden>
      <p class="tia-intro">写一句想做的事或想说的话，让模型补成一条完整的消息。</p>
      <label for="tia-expand-input">想写什么</label>
      <textarea id="tia-expand-input" rows="3" spellcheck="false" placeholder="例如：我犹豫了一下，还是问了她的名字"></textarea>
      <div class="tia-row">
        <button type="button" data-action="expand" class="tia-primary">扩写并注入</button>
        <button type="button" data-action="cancel" class="tia-secondary" hidden>取消</button>
      </div>
      <p id="tia-expand-status" class="tia-status" role="status" aria-live="polite">扩写结果会直接送进输入框，末尾也会留一份方便再取。</p>
      <div id="tia-expand-result" class="tia-result" hidden>
        <p id="tia-expand-text" class="tia-result-text"></p>
        <div class="tia-row">
          <button type="button" data-action="expand-reinject" class="tia-secondary">再注入一次</button>
          <button type="button" data-action="expand-retry" class="tia-secondary">重新扩写</button>
        </div>
      </div>
      <details class="tia-details"><summary>预览会发送的内容</summary><pre id="tia-expand-preview"></pre></details>
    </section>
    <section id="tia-pane-settings" class="tia-pane" role="tabpanel" aria-labelledby="tia-tab-settings" hidden>
      <div class="tia-section-label">连接</div>
      <label for="tia-transport">连接方式</label>
      <select id="tia-transport" data-setting="transport">
        <option value="server">酒馆后台转发（推荐）</option>
        <option value="direct">浏览器直连</option>
      </select>
      <p id="tia-transport-hint" class="tia-hint"></p>
      <label for="tia-url">API 地址</label>
      <input id="tia-url" data-setting="baseUrl" type="url" placeholder="http://127.0.0.1:8317/v1" spellcheck="false" autocomplete="off">
      <label for="tia-key">API Key</label>
      <input id="tia-key" data-setting="apiKey" type="password" placeholder="渠道的客户端密钥，可留空" autocomplete="off" spellcheck="false">
      <label class="tia-check"><input data-setting="rememberKey" type="checkbox">记住密钥<span>保存到酒馆设置</span></label>
      <label for="tia-model">文字模型</label>
      <input id="tia-model" data-setting="model" autocomplete="off" spellcheck="false" placeholder="例如 deepseek-v4.1-flash">
      <div class="tia-model-actions">
        <button type="button" data-action="model-list" class="tia-secondary" aria-expanded="false" aria-controls="tia-model-list">选择模型</button>
        <button type="button" data-action="models" class="tia-secondary">读取模型</button>
      </div>
      <p id="tia-model-hint" class="tia-hint">可以直接输入模型名，或点「读取模型」拉列表后点选。选项生成和扩写共用这一个模型。</p>
      <div id="tia-model-list" class="tia-model-list" role="group" aria-label="可用模型" hidden></div>
      <p id="tia-connect-status" class="tia-status" role="status" aria-live="polite"></p>

      <div class="tia-section-label">行为</div>
      <label for="tia-floors">上下文层数</label>
      <input id="tia-floors" data-setting="recentCount" type="number" min="1" max="100" step="1">
      <label class="tia-check"><input data-setting="worldInfoInject" type="checkbox">把世界书一起发过去<span>用酒馆当前激活的条目</span></label>
      <label for="tia-worldinfo">世界书字数上限</label>
      <input id="tia-worldinfo" data-setting="worldInfoMaxChars" type="number" min="200" max="20000" step="200">
      <p class="tia-hint">世界书交给酒馆自己的激活逻辑计算，和真正发给模型的那份一致；超过上限的部分会被截断。预设里想自己安排位置就写 {{worldinfo}}。</p>
      <p class="tia-hint">选项固定 6 条：前 3 条是不同走向的正常分支，第 4 条偏新奇，第 5 条偏邪恶，第 6 条大幅推进时间线。这个分工写在下面的预设里，想调整就改预设。</p>
      <label for="tia-timeout">最长等待（秒）</label>
      <input id="tia-timeout" data-setting="timeoutSeconds" type="number" min="10" max="600" step="10">
      <label for="tia-inject">点选项时怎么写入输入框</label>
      <select id="tia-inject" data-setting="injectMode">
        <option value="append">追加在已有内容后面</option>
        <option value="replace">替换输入框里已有内容</option>
      </select>
      <label class="tia-check"><input data-setting="autoSuggest" type="checkbox">模型回复结束后自动生成选项<span>按钮上会亮一个小圆点</span></label>
      <p id="tia-behavior-warning" class="tia-hint" hidden></p>

      <div class="tia-section-label">提示词</div>
      <label for="tia-suggest-preset">生成选项的预设</label>
      <textarea id="tia-suggest-preset" data-setting="suggestPreset" rows="9" spellcheck="false"></textarea>
      <p class="tia-hint">可用 {{chat}}、{{char}}、{{user}}、{{count}}。不写 {{chat}} 时聊天记录会自动补在末尾。</p>
      <label for="tia-expand-preset">扩写的预设</label>
      <textarea id="tia-expand-preset" data-setting="expandPreset" rows="9" spellcheck="false"></textarea>
      <p class="tia-hint">可用 {{input}}（扩写框里那句）、{{chat}}、{{char}}、{{user}}。</p>
      <div class="tia-row"><button type="button" data-action="restore-preset" class="tia-secondary">恢复默认预设</button></div>
    </section>
  </div>`;

function mount() {
    if (mounted || !globalThis.SillyTavern?.getContext) return;
    const context = getContext();
    const settings = loadSettings(context.extensionSettings[KEY] || {});
    if (!settings.suggestPreset) settings.suggestPreset = DEFAULT_SUGGEST_PRESET;
    if (!settings.expandPreset) settings.expandPreset = DEFAULT_EXPAND_PRESET;
    // 设置里留着的若是旧版本的出厂预设，自动升级到当前版本；用户自己改过的保持不动。
    const upgraded = migratePresets(settings);
    if (upgraded.suggestPreset !== settings.suggestPreset || upgraded.expandPreset !== settings.expandPreset) {
        Object.assign(settings, upgraded);
        persistSettings();
    }
    const lifetime = new AbortController();
    const service = createService(getContext);

    let job = null, clock = null, startedAt = 0, stoppedAt = 0;
    let lastSuggest = null, suggestions = [], injected = new Set(), expandResult = '';
    let opened = false, lastFocus = null, models = [];

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.id = 'tia-trigger';
    trigger.className = 'tia-trigger interactable';
    trigger.title = '酒馆输入助手';
    trigger.setAttribute('aria-label', '打开酒馆输入助手');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', 'tia-panel');
    trigger.innerHTML = `${ICON}<span class="tia-badge" hidden></span>`;

    const panel = document.createElement('section');
    panel.id = 'tia-panel';
    panel.hidden = true;
    panel.tabIndex = -1;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-label', '酒馆输入助手');
    panel.innerHTML = PANEL_HTML;
    document.body.append(panel);
    const $ = selector => panel.querySelector(selector);
    const listen = (element, event, fn) => element.addEventListener(event, fn, { signal: lifetime.signal });

    // 触发按钮必须在 #nonQRFormItems 的第一个位置：那里是 flex 行，DOM 第一 + 默认 order:0
    // 就落在 order:1 的 #leftSendForm 左边，也就是整个输入框的最左侧。
    function ensureTrigger() {
        const holder = document.querySelector('#nonQRFormItems');
        if (!holder) return false;
        // 已经不在这个容器里（酒馆重渲染过输入区）才插回去，避免每次调用都动 DOM。
        if (trigger.parentElement !== holder || holder.firstElementChild !== trigger) {
            holder.insertBefore(trigger, holder.firstElementChild);
        }
        return true;
    }

    // 万一扩展脚本比输入区先就绪，盯着 DOM 直到 #nonQRFormItems 出现；插好就立刻断开。
    let domWatcher = null;
    function ensureTriggerRetry() {
        if (ensureTrigger()) { domWatcher?.disconnect(); domWatcher = null; return; }
        if (domWatcher) return;
        domWatcher = new MutationObserver(() => ensureTriggerRetry());
        domWatcher.observe(document.body, { childList: true, subtree: true });
    }

    function persistSettings() {
        getContext().extensionSettings[KEY] = { ...settings, apiKey: settings.rememberKey ? settings.apiKey : '' };
        getContext().saveSettingsDebounced();
    }

    function setStatus(where, text, type = '') {
        const node = where === 'expand' ? $('#tia-expand-status') : where === 'settings' ? $('#tia-connect-status') : $('#tia-suggest-status');
        node.textContent = text;
        node.dataset.type = type;
    }

    function setBusy(value) {
        for (const node of panel.querySelectorAll('[data-action="suggest"], [data-action="expand"], [data-action="models"], [data-action="expand-retry"], [data-action="expand-reinject"]')) node.disabled = value;
        for (const node of panel.querySelectorAll('[data-action="cancel"]')) node.hidden = !value;
        panel.setAttribute('aria-busy', String(value));
        trigger.classList.toggle('tia-busy', value);
        if (!value) clearInterval(clock);
    }

    function startClock(where, label) {
        clearInterval(clock);
        startedAt = Date.now();
        const tick = () => setStatus(where, `${label}… ${Math.floor((Date.now() - startedAt) / 1000)} 秒`);
        tick();
        clock = setInterval(tick, 1000);
    }

    function refreshHints() {
        $('#tia-transport-hint').textContent = settings.transport === 'server'
            ? '由酒馆服务器访问 API：需要在酒馆的 config.yaml 里设置 enableCorsProxy: true 后重启。127.0.0.1 指酒馆服务器；Docker 部署时指酒馆容器。'
            : '由当前设备直接访问 API，要求渠道允许跨域。127.0.0.1 指当前设备；手机上就是手机自己，建议改用后台转发。';
        const warning = $('#tia-behavior-warning');
        if (settings.autoSuggest && !String(settings.model ?? '').trim()) {
            warning.textContent = '自动生成已开启，但还没填模型，所以不会有请求发出去。';
            warning.dataset.type = 'warning';
            warning.hidden = false;
        } else {
            warning.hidden = true;
        }
    }

    function refreshContext() {
        try {
            const ctx = getContext();
            const endIndex = resolveContextEnd(ctx.chat);
            if (endIndex === -1) { $('#tia-suggest-context').textContent = '当前聊天还没有可用内容。'; return; }
            const floors = Math.min(Number(settings.recentCount) || 8, endIndex + 1);
            const name = ctx.chat[endIndex].is_user ? (ctx.name1 || '用户') : (ctx.chat[endIndex].name || ctx.name2 || '角色');
            $('#tia-suggest-context').textContent = `会读取截至第 ${endIndex + 1} 层（${name}）的最近 ${floors} 层内容。`;
        } catch (error) {
            $('#tia-suggest-context').textContent = safeError(error);
        }
    }

    // 世界书要现取，所以预览是异步的；用递增令牌丢弃过期结果，避免快速改动设置时后发先至。
    let previewToken = 0;
    async function refreshPreview() {
        const token = ++previewToken;
        try {
            const preview = await service.previewSuggest(settings);
            if (token === previewToken) $('#tia-suggest-preview').textContent = previewMessages(preview.messages);
        } catch (error) {
            if (token === previewToken) $('#tia-suggest-preview').textContent = safeError(error);
        }
        try {
            const value = $('#tia-expand-input').value.trim();
            const preview = value ? await service.previewExpand(settings, value) : null;
            if (token !== previewToken) return;
            $('#tia-expand-preview').textContent = preview ? previewMessages(preview.messages) : '先在扩写框里写一句内容。';
        } catch (error) {
            if (token === previewToken) $('#tia-expand-preview').textContent = safeError(error);
        }
    }

    // ---- 写入酒馆输入框 ----
    // 与酒馆自己给输入框赋值的方式一致：改 value 后派发原生 input 事件，让 ST 的高度
    // 自适应、草稿保存、发送按钮状态全部照常跑一遍。
    function injectIntoInput(text) {
        const textarea = document.querySelector('#send_textarea');
        if (!textarea) return '找不到酒馆的输入框，可能页面还没加载完。';
        const next = mergeInput(textarea.value, text, settings.injectMode);
        textarea.value = next;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        try {
            textarea.focus({ preventScroll: true });
            textarea.setSelectionRange(next.length, next.length);
        } catch { /* 焦点或选区失败不影响内容已写入 */ }
        return '';
    }

    function renderOptions() {
        const list = $('#tia-suggest-list');
        if (!suggestions.length) { list.replaceChildren(); return; }
        list.replaceChildren(...suggestions.map((text, index) => {
            const kind = suggestKind(index);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'tia-option';
            button.dataset.option = String(index);
            button.dataset.kind = kind;
            button.setAttribute('aria-pressed', String(injected.has(index)));
            const number = document.createElement('span');
            number.className = 'tia-option-index';
            number.textContent = injected.has(index) ? '✓' : String(index + 1);
            const body = document.createElement('span');
            body.className = 'tia-option-text';
            body.textContent = text;
            const label = document.createElement('span');
            label.className = 'tia-option-label';
            label.textContent = SUGGEST_LABELS[kind];
            button.append(number, body, label);
            return button;
        }));
    }

    // ---- 面板定位：向上弹出 ----
    function viewportHeight() {
        const visual = globalThis.visualViewport?.height;
        return Number.isFinite(visual) && visual > 0 ? Math.min(innerHeight, visual) : innerHeight;
    }
    function placePanel() {
        if (panel.hidden || !trigger.isConnected) return;
        const rect = trigger.getBoundingClientRect();
        const { top, left, maxHeight } = planPanelPlacement({
            top: rect.top,
            left: rect.left,
            width: panel.offsetWidth,
            height: panel.offsetHeight,
            viewportWidth: innerWidth,
            viewportHeight: viewportHeight(),
            compact: isCompactPanelLayout(innerWidth),
        });
        // maxHeight 由按钮上方的可用空间决定：面板再高也长不到输入区那排按钮上，
        // 也不会伸到屏幕外，只会自己滚。只在值变了才写，避免 ResizeObserver 反复触发。
        const capped = `${Math.round(maxHeight)}px`;
        if (panel.style.maxHeight !== capped) panel.style.maxHeight = capped;
        panel.style.top = `${Math.round(top)}px`;
        panel.style.left = `${Math.round(left)}px`;
    }

    function markBadge(on) {
        const node = trigger.querySelector('.tia-badge');
        node.hidden = !on;
        trigger.classList.toggle('tia-has-new', on);
    }

    function setTab(name) {
        const tab = ['suggest', 'expand', 'settings'].includes(name) ? name : 'suggest';
        settings.activeTab = tab;
        persistSettings();
        for (const button of panel.querySelectorAll('[data-tab]')) button.setAttribute('aria-selected', String(button.dataset.tab === tab));
        for (const section of panel.querySelectorAll('.tia-pane')) section.hidden = section.id !== `tia-pane-${tab}`;
        if (tab === 'suggest') refreshContext();
        if (tab === 'settings') refreshHints();
        placePanel();
    }

    function open() {
        if (!ensureTrigger()) return;
        opened = true;
        lastFocus = document.activeElement;
        panel.hidden = false;
        setTab(settings.activeTab);
        renderOptions();
        markBadge(false);
        trigger.setAttribute('aria-expanded', 'true');
        placePanel();
        void refreshPreview();
        // 焦点给面板本身而不是第一个输入框：手机上打开面板时不该直接弹出软键盘。
        panel.focus({ preventScroll: true });
    }
    function close() {
        opened = false;
        panel.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        if (panel.contains(document.activeElement)) (lastFocus?.isConnected ? lastFocus : trigger).focus({ preventScroll: true });
    }

    // ---- 自动生成 ----
    async function autoSuggest() {
        if (!mounted) return;
        const plan = planAutoSuggest(settings, {
            chat: getContext().chat,
            running: Boolean(job),
            stopped: Date.now() - stoppedAt < 1500,
            last: lastSuggest,
        });
        if (!plan.run) return;
        await run('suggest', { automatic: true });
    }

    async function run(action, { automatic = false, input = '' } = {}) {
        if (job) return;
        const config = { ...settings };
        const controller = new AbortController();
        job = controller;
        setBusy(true);
        const seconds = Number(config.timeoutSeconds);
        const timeout = setTimeout(() => controller.abort('timeout'), (Number.isFinite(seconds) && seconds >= 10 ? seconds : 120) * 1000);
        try {
            if (action === 'models') {
                setStatus('settings', '正在读取模型列表…');
                models = await service.listModels(config, controller.signal);
                $('#tia-model-list').replaceChildren(...models.map(name => {
                    const item = document.createElement('button');
                    item.type = 'button';
                    item.className = 'tia-model-item';
                    item.dataset.model = name;
                    item.textContent = name;
                    item.setAttribute('aria-pressed', String(name === settings.model));
                    return item;
                }));
                $('#tia-model-hint').textContent = models.length ? '点一个模型即可选用；也可以直接在输入框里改写。' : '这个渠道没有返回任何模型。';
                toggleModelList(true);
                setStatus('settings', `已读取 ${models.length} 个模型。列表不保证都能做对话补全。`, 'success');
            } else if (action === 'suggest') {
                startClock('suggest', automatic ? '模型回复已结束，正在生成选项' : '正在生成选项');
                const result = await service.suggest(config, controller.signal);
                suggestions = result.items;
                injected = new Set();
                lastSuggest = { index: result.index, text: result.text };
                renderOptions();
                const expected = SUGGEST_KINDS.length;
                const short = result.items.length < expected;
                const source = `读了 ${result.count} 层${result.worldInfoLength ? `，世界书 ${result.worldInfoLength} 字` : ''}`;
                setStatus('suggest', short
                    ? `只拿到 ${result.items.length}/${expected} 条（${source}）。模型没按格式给满，可以点「生成选项」再来一次。`
                    : `已生成 ${expected} 条选项（${source}）。点一条就送进输入框。`, short ? 'warning' : 'success');
                if (!opened) markBadge(true);
            } else if (action === 'expand') {
                startClock('expand', '正在扩写');
                const result = await service.expand(config, input, controller.signal);
                expandResult = result.text;
                $('#tia-expand-text').textContent = result.text;
                $('#tia-expand-result').hidden = false;
                const problem = injectIntoInput(result.text);
                setStatus('expand', problem || `已扩写 ${result.text.length} 字并送进输入框。`, problem ? 'warning' : 'success');
            }
        } catch (error) {
            const aborted = controller.signal.aborted;
            const message = aborted
                ? (controller.signal.reason === 'timeout' ? '等待超时。渠道可能还在处理，可以再点一次。' : '已取消。')
                : safeError(error, config.apiKey);
            const where = action === 'models' ? 'settings' : action;
            setStatus(where, message, aborted ? 'warning' : 'error');
        } finally {
            clearTimeout(timeout);
            job = null;
            setBusy(false);
        }
    }

    function toggleModelList(force) {
        const list = $('#tia-model-list');
        const show = typeof force === 'boolean' ? force : list.hidden;
        if (show && !list.childElementCount) { setStatus('settings', '还没有模型列表，先点「读取模型」。', 'warning'); return; }
        list.hidden = !show;
        $('[data-action="model-list"]').setAttribute('aria-expanded', String(show));
        if (show) list.querySelector('[aria-pressed="true"]')?.scrollIntoView?.({ block: 'nearest' });
    }

    for (const input of panel.querySelectorAll('[data-setting]')) {
        const key = input.dataset.setting;
        if (input.type === 'checkbox') input.checked = Boolean(settings[key]);
        else input.value = settings[key] ?? '';
        const onInput = () => {
            settings[key] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
            persistSettings();
            refreshHints();
            if (key === 'model') { toggleModelList(false); for (const item of $('#tia-model-list').children) item.setAttribute('aria-pressed', String(item.dataset.model === settings.model)); }
            if (key === 'suggestPreset' || key === 'expandPreset' || key === 'recentCount' || key === 'worldInfoInject' || key === 'worldInfoMaxChars') void refreshPreview();
            if (key === 'recentCount') refreshContext();
        };
        listen(input, 'input', onInput);
        listen(input, 'change', onInput);
    }
    listen($('#tia-expand-input'), 'input', refreshPreview);
    listen($('#tia-pane-suggest').querySelector('details'), 'toggle', refreshPreview);
    listen($('#tia-pane-expand').querySelector('details'), 'toggle', refreshPreview);

    listen(panel, 'click', event => {
        const tab = event.target.closest('[data-tab]')?.dataset.tab;
        if (tab) { setTab(tab); return; }
        const option = event.target.closest('.tia-option');
        if (option) {
            const index = Number(option.dataset.option);
            const text = suggestions[index];
            if (typeof text === 'string') {
                const problem = injectIntoInput(text);
                if (problem) { setStatus('suggest', problem, 'warning'); return; }
                injected.add(index);
                renderOptions();
                setStatus('suggest', `第 ${index + 1} 条已送进输入框，可以直接发送。`, 'success');
                close();
            }
            return;
        }
        const model = event.target.closest('.tia-model-item')?.dataset.model;
        if (model) {
            settings.model = model;
            $('#tia-model').value = model;
            persistSettings();
            refreshHints();
            toggleModelList(false);
            setStatus('settings', `已选用模型 ${model}。`, 'success');
            return;
        }
        const action = event.target.closest('[data-action]')?.dataset.action;
        if (action === 'close') close();
        if (action === 'cancel') job?.abort('user');
        if (action === 'model-list') toggleModelList();
        if (action === 'models') void run('models');
        if (action === 'suggest') void run('suggest');
        if (action === 'expand') { const value = $('#tia-expand-input').value.trim(); if (value) void run('expand', { input: value }); else setStatus('expand', '先写一句想让模型扩写的内容。', 'warning'); }
        if (action === 'expand-retry') { const value = $('#tia-expand-input').value.trim(); if (value) void run('expand', { input: value }); }
        if (action === 'expand-reinject' && expandResult) {
            const problem = injectIntoInput(expandResult);
            setStatus('expand', problem || '已再注入一次。', problem ? 'warning' : 'success');
        }
        if (action === 'restore-preset') {
            settings.suggestPreset = DEFAULT_SUGGEST_PRESET;
            settings.expandPreset = DEFAULT_EXPAND_PRESET;
            $('#tia-suggest-preset').value = DEFAULT_SUGGEST_PRESET;
            $('#tia-expand-preset').value = DEFAULT_EXPAND_PRESET;
            persistSettings();
            void refreshPreview();
            setStatus('settings', '已恢复默认预设。', 'success');
        }
    });

    listen(trigger, 'click', () => { opened ? close() : open(); });
    listen(document, 'keydown', event => { if (event.key === 'Escape' && opened) { close(); event.stopPropagation(); } });
    listen(document, 'pointerdown', event => {
        if (opened && !panel.contains(event.target) && !trigger.contains(event.target)) close();
    });
    listen(window, 'resize', () => { ensureTrigger(); placePanel(); });
    // 手机软键盘弹出/收起改的是视觉视口，不一定触发 window resize。跟着重算一次，
    // 免得面板底边压到输入区、或者高度超出可视区域。
    if (globalThis.visualViewport) listen(globalThis.visualViewport, 'resize', placePanel);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(placePanel) : null;
    observer?.observe(panel);

    const listeners = [];
    for (const name of ['CHAT_CHANGED', 'MESSAGE_RECEIVED', 'MESSAGE_SENT', 'MESSAGE_DELETED', 'MESSAGE_UPDATED', 'MESSAGE_SWIPED', 'GENERATION_ENDED', 'GENERATION_STOPPED']) {
        const type = context.eventTypes?.[name];
        if (!type) continue;
        const handler = () => {
            if (name === 'CHAT_CHANGED') { suggestions = []; injected = new Set(); lastSuggest = null; expandResult = ''; renderOptions(); markBadge(false); }
            if (name === 'GENERATION_STOPPED') stoppedAt = Date.now();
            // ST 的 GENERATION_ENDED 由 hideStopButton() 发出，stopGeneration() 也会走它，
            // 且同一 tick 紧跟 GENERATION_STOPPED —— 推迟一拍，让手动停止优先。
            if (name === 'GENERATION_ENDED') setTimeout(() => { void autoSuggest(); }, 0);
            // 切换 swipe / 手改楼层不会触发生成，内容变了就让去重记录失效，下一轮可以重新生成。
            if (name === 'MESSAGE_SWIPED' || name === 'MESSAGE_UPDATED') lastSuggest = null;
            if (opened) { refreshContext(); if (settings.activeTab === 'suggest') refreshPreview(); }
        };
        context.eventSource.on(type, handler);
        listeners.push([type, handler]);
    }

    ensureTriggerRetry();
    refreshHints();
    refreshContext();
    void refreshPreview();
    setTab(settings.activeTab);

    mounted = {
        destroy() {
            job?.abort('disabled');
            lifetime.abort();
            clearInterval(clock);
            domWatcher?.disconnect();
            observer?.disconnect();
            for (const [type, handler] of listeners) context.eventSource.removeListener?.(type, handler);
            panel.remove();
            trigger.remove();
            mounted = null;
        },
    };
}

export function onDisable() { mounted?.destroy(); }
export function onEnable() { mount(); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
else mount();
