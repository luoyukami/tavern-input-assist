// UI 层：把触发按钮注入到输入框最左侧（#leftSendForm 左边），面板向上弹出。
// 按钮挂在 #nonQRFormItems 里，面板挂在 body 上 —— 面板用 fixed 定位，脱离酒馆自身的
// transform 祖先，才不会在手机上被 ST 的 mobile CSS 甩出视口。

import { KEY, eligibleMessages, isCompactPanelLayout, loadSettings, mergeInput, planAutoSuggest, planPanelPlacement, resolveContextEnd, safeError } from './core.js';
import { DEFAULT_EXPAND_PRESET, DEFAULT_SUGGEST_PRESET, SUGGEST_KINDS, SUGGEST_LABELS, migratePresets, previewMessages, suggestKind } from './assistant.js';
import { DEFAULT_POLISH_PRESET, adoptEdited, cleanForPrompt, composePolished, findRecord, hashText, inheritRecords, lastAssistantIndex, loadRegexEngine, migratePolishPreset, planAutoPolish, planPolishApplication, polishModelFor, polishViewFor, readArchive, readRecords, regexEngine, regexPreservedRanges, splitProse, upsertRecord, writeArchive } from './polish.js';
import { createService } from './service.js';

let mounted;
const getContext = () => globalThis.SillyTavern.getContext();

const ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M6.8 9.6h7.4"/><path d="M6.8 14h4.2"/><path d="m16 12.4.72 1.78 1.78.72-1.78.72L16 17.4l-.72-1.78-1.78-.72 1.78-.72z"/></svg>`;
// 消息按钮行里的润色按钮：一支笔 + 一道下划线，和酒馆自己的图标同尺寸同风格。
const POLISH_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20.2c.5-2.6 1.9-4.4 4-5.7"/><path d="M9.2 13.1 15.6 6.1a2.6 2.6 0 0 1 3.8 3.5l-6.5 6.9"/><path d="M12.6 19.6h7.2"/></svg>`;

const PANEL_HTML = `
  <header class="tia-head">
    <span class="tia-title">输入助手</span>
    <button type="button" class="tia-icon" data-action="close" aria-label="收起面板">×</button>
  </header>
  <div class="tia-tabs" role="tablist" aria-label="面板分区">
    <button type="button" class="tia-tab" role="tab" data-tab="suggest" aria-selected="true" aria-controls="tia-pane-suggest">选项</button>
    <button type="button" class="tia-tab" role="tab" data-tab="expand" aria-selected="false" aria-controls="tia-pane-expand">扩写</button>
    <button type="button" class="tia-tab" role="tab" data-tab="polish" aria-selected="false" aria-controls="tia-pane-polish">润色</button>
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
    <section id="tia-pane-polish" class="tia-pane" role="tabpanel" aria-labelledby="tia-tab-polish" hidden>
      <p class="tia-intro">把某一层角色回复的正文重新润色一遍，直接替换酒馆里的这条消息。每层都会留一份原版，消息按钮行里的笔可以随时切回原版。</p>
      <label for="tia-polish-floor">润色哪一层</label>
      <select id="tia-polish-floor"></select>
      <div class="tia-row">
        <button type="button" data-action="polish-run" class="tia-primary">润色这一层</button>
        <button type="button" data-action="cancel" class="tia-secondary" hidden>取消</button>
      </div>
      <p id="tia-polish-target" class="tia-hint"></p>
      <p id="tia-polish-status" class="tia-status" role="status" aria-live="polite"></p>
      <div id="tia-polish-compare" class="tia-compare" hidden>
        <div class="tia-compare-col">
          <span class="tia-compare-label">原版</span>
          <p id="tia-polish-original" class="tia-result-text"></p>
        </div>
        <div class="tia-compare-col">
          <span class="tia-compare-label">润色版</span>
          <p id="tia-polish-polished" class="tia-result-text"></p>
        </div>
      </div>
      <div class="tia-row tia-polish-actions" id="tia-polish-actions" hidden>
        <button type="button" data-action="polish-apply" class="tia-secondary">仍然应用这份结果</button>
        <button type="button" data-action="polish-revert" class="tia-secondary">恢复原版</button>
        <button type="button" data-action="polish-retry" class="tia-secondary">重新润色</button>
        <button type="button" data-action="polish-discard" class="tia-secondary">放弃这份结果</button>
      </div>
      <button type="button" data-action="polish-inherit" class="tia-secondary" id="tia-polish-inherit" hidden>从主聊天继承润色记录</button>

      <label class="tia-check"><input data-setting="polishAuto" type="checkbox">角色回复结束后自动润色<span>只跑最新一层</span></label>
      <p id="tia-polish-warning" class="tia-hint" hidden></p>
      <label for="tia-polish-model">润色模型</label>
      <input id="tia-polish-model" data-setting="polishModel" autocomplete="off" spellcheck="false" placeholder="留空就跟主模型一样">
      <div class="tia-model-actions">
        <button type="button" data-action="polish-model-list" class="tia-secondary" aria-expanded="false" aria-controls="tia-polish-model-list">选择模型</button>
        <button type="button" data-action="models" class="tia-secondary">读取模型</button>
      </div>
      <p id="tia-polish-model-hint" class="tia-hint">留空就用上面设置里的主模型。润色和主流程共用同一套连接方式、地址与密钥，只是模型名可以单独指定。</p>
      <div id="tia-polish-model-list" class="tia-model-list" role="group" aria-label="润色可用模型" hidden></div>
      <p id="tia-polish-source" class="tia-hint"></p>
      <label class="tia-check"><input data-setting="polishBuiltinStrip" type="checkbox">启用内置剔除名单<span>见下方说明</span></label>
      <label for="tia-polish-strip">额外剔除的块名</label>
      <input id="tia-polish-strip" data-setting="polishStrip" autocomplete="off" spellcheck="false" placeholder="例如 my_panel、extra_meta*">
      <p class="tia-hint">正文的取法优先用酒馆自己的正则管线（预设里「只改发送」的那些规则），拿到什么就当正文 —— 那才是真正发给模型的内容。内置剔除名单是兜底：think/reasoning/analysis、update*/json_patch、*status*/*state*/*panel*、*option*、image*/pic、图片与 base64，还有内容像文件名/JSON/[键|值] 的块；不想用就把上面的开关关掉，只留正则脚本和下面补的名字。这些块不送去改写、不进对照，替换时原位保留。块名用逗号或空格分隔，支持 * 通配。</p>
      <label for="tia-polish-context">润色时附带的上下文层数</label>
      <input id="tia-polish-context" data-setting="polishContext" type="number" min="0" max="20" step="1">
      <p class="tia-hint">只用来让模型知道人称、语气和当前处境，这些楼层不会被润色。0 表示只发要润色的那段正文。</p>
      <label for="tia-polish-preset">润色的预设</label>
      <textarea id="tia-polish-preset" data-setting="polishPreset" rows="10" spellcheck="false"></textarea>
      <p class="tia-hint">可用 {{text}}（要润色的正文）、{{chat}}、{{char}}、{{user}}、{{worldinfo}}。不写 {{text}} 时正文会自动补在末尾。</p>
      <div class="tia-row"><button type="button" data-action="restore-polish-preset" class="tia-secondary">恢复默认预设</button></div>
      <details class="tia-details"><summary>预览会发送的内容</summary><pre id="tia-polish-preview"></pre></details>
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
    if (!settings.polishPreset) settings.polishPreset = DEFAULT_POLISH_PRESET;
    // 设置里留着的若是旧版本的出厂预设，自动升级到当前版本；用户自己改过的保持不动。
    const upgraded = migratePresets(settings);
    const polishPreset = migratePolishPreset(settings);
    if (upgraded.suggestPreset !== settings.suggestPreset || upgraded.expandPreset !== settings.expandPreset || polishPreset !== settings.polishPreset) {
        Object.assign(settings, upgraded, { polishPreset });
        persistSettings();
    }
    const lifetime = new AbortController();
    const service = createService(getContext);

    let job = null, clock = null, startedAt = 0, stoppedAt = 0;
    let lastSuggest = null, suggestions = [], injected = new Set(), expandResult = '';
    let opened = false, lastFocus = null, models = [];
    // 润色：记录存在聊天自己的 metadata 里（跟着聊天文件走），另在扩展设置里留一份按聊天 ID 的镜像，
    // 给分支聊天做继承用。draft 是没能自动应用、等人工确认的那一份结果。
    let polishRecords = readPolishRecords();
    let polishTarget = lastAssistantIndex(getContext().chat);
    let polishDraft = null;
    const polishTried = new Set();
    // 楼层 -> 记录键、记录键 -> 上一次显示的是哪一版。用来判断手改楼层改的是哪一版。
    const polishFloorRecord = new Map();
    const polishLastView = new Map();

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

    const STATUS_NODES = {
        suggest: '#tia-suggest-status', expand: '#tia-expand-status',
        polish: '#tia-polish-status', settings: '#tia-connect-status',
    };
    function setStatus(where, text, type = '') {
        const node = $(STATUS_NODES[where] ?? STATUS_NODES.suggest);
        node.textContent = text;
        node.dataset.type = type;
    }

    function setBusy(value) {
        for (const node of panel.querySelectorAll('[data-action="suggest"], [data-action="expand"], [data-action="polish-run"], [data-action="polish-retry"], [data-action="models"], [data-action="expand-retry"], [data-action="expand-reinject"]')) node.disabled = value;
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
        // 润色模型留空时沿用主模型，所以两个都空才算没配置。
        const polishWarning = $('#tia-polish-warning');
        if (settings.polishAuto && !polishModelFor(settings)) {
            polishWarning.textContent = '自动润色已开启，但润色模型和主模型都是空的，所以不会有请求发出去。';
            polishWarning.dataset.type = 'warning';
            polishWarning.hidden = false;
        } else {
            polishWarning.hidden = true;
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
        try {
            const preview = polishTarget >= 0 ? await service.previewPolish(settings, polishTarget) : null;
            if (token !== previewToken) return;
            $('#tia-polish-preview').textContent = preview ? previewMessages(preview.messages) : '没有可以润色的楼层。';
        } catch (error) {
            if (token === previewToken) $('#tia-polish-preview').textContent = safeError(error);
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

    // ---- 正文润色 ----
    // 记录跟着聊天文件走（chat_metadata），另在扩展设置里按聊天 ID 留一份镜像给分支聊天继承用。
    function readPolishRecords() {
        try { return readRecords(getContext().chatMetadata?.[KEY]); } catch { return []; }
    }

    function currentChatId() {
        const ctx = getContext();
        return String(ctx.getCurrentChatId?.() ?? ctx.chatId ?? '');
    }

    function savePolishRecords(records) {
        polishRecords = records;
        try {
            const ctx = getContext();
            const existing = ctx.chatMetadata?.[KEY];
            ctx.updateChatMetadata?.({ [KEY]: { ...(existing && typeof existing === 'object' ? existing : {}), records } }, false);
            ctx.saveMetadataDebounced?.();
        } catch { /* 元数据写不进去不影响本次替换，只是切回原版要靠下一次请求 */ }
        try {
            const ctx = getContext();
            const stored = ctx.extensionSettings[KEY] ?? {};
            ctx.extensionSettings[KEY] = { ...stored, polishArchive: writeArchive(readArchive(stored), currentChatId(), records) };
            ctx.saveSettingsDebounced();
        } catch { /* 镜像失败只影响跨分支继承 */ }
    }

    // 某一层的「正文」：先过酒馆自己的正则管线（预设的只改发送/只改显示规则），再用内置名单兜底。
    // depth 是这一层离末尾的层数，和酒馆拼提示词时传的一致。
    function proseOf(text, index) {
        const chat = getContext().chat ?? [];
        const depth = Math.max(0, chat.length - 1 - (Number.isInteger(index) ? index : 0));
        return splitProse(cleanForPrompt(text, depth), settings.polishStrip, [], settings.polishBuiltinStrip !== false).prose;
    }

    function polishState(index) {
        const message = getContext().chat?.[index];
        const record = message ? findRecord(polishRecords, message.mes) : null;
        return { message, record, view: polishViewFor(record, message?.mes) };
    }

    // 把正文换成另一版：改 mes、作废 token 计数缓存、重渲染、落盘，最后补发 MESSAGE_UPDATED，
    // 让隔壁扩展（生图插件等）知道这一层的内容变了。
    function applyPolishText(index, text) {
        const ctx = getContext();
        const message = ctx.chat?.[index];
        if (!message) { setStatus('polish', '这一层已经不在了，可能刚被删除。', 'warning'); return false; }
        if (String(message.mes ?? '') === text) return true;
        message.mes = text;
        if (message.extra && typeof message.extra === 'object') delete message.extra.token_count;
        try { ctx.updateMessageBlock?.(index, message); } catch { /* 重渲染失败也不该把内容改回去 */ }
        void ctx.saveChat?.();
        try { ctx.eventSource?.emit?.(ctx.eventTypes?.MESSAGE_UPDATED, index); } catch { /* 事件发不出去不影响替换 */ }
        const record = findRecord(polishRecords, text);
        if (record) polishLastView.set(record.key, text === record.polished ? 'polished' : 'original');
        injectPolishButtons();
        if (opened) refreshPolishPane();
        return true;
    }

    function polishButtonTitle(state) {
        if (!state.record) return '润色这一层正文';
        if (state.view === 'polished') return '正在显示润色版 · 点一下切回原版';
        if (state.view === 'edited') return '这一层手改过 · 点一下切到润色版（原版还在记录里）';
        return '正在显示原版 · 点一下切到润色版';
    }

    function syncPolishButton(button, index) {
        const state = polishState(index);
        if (state.record) {
            polishFloorRecord.set(index, state.record.key);
            // 从正文本身就能看出当前显示的是哪一版；刷新页面后也能靠这一步重新认出来。
            if (state.view === 'polished' || state.view === 'original') polishLastView.set(state.record.key, state.view);
        } else {
            polishFloorRecord.delete(index);
        }
        button.classList.toggle('tia-active', state.view === 'polished');
        button.classList.toggle('tia-record', Boolean(state.record));
        button.title = polishButtonTitle(state);
    }

    // 每条角色消息的按钮行里插一个图标；用户楼层和系统楼层不插。
    // 酒馆重渲染楼层（swipe、编辑、切聊天）后按钮会没，所以凡是楼层变动的事件都调一次。
    function injectPolishButtons() {
        const chat = document.querySelector('#chat');
        if (!chat) return;
        const rows = getContext().chat ?? [];
        for (const node of chat.querySelectorAll('.mes')) {
            const index = Number(node.getAttribute('mesid'));
            const message = rows[index];
            const existing = node.querySelector('.tia-polish-btn');
            if (!message || message.is_system || message.is_user) { existing?.remove(); continue; }
            const holder = node.querySelector('.mes_buttons');
            if (!holder) continue;
            let button = existing;
            if (!button) {
                button = document.createElement('div');
                button.className = 'mes_button tia-polish-btn';
                button.innerHTML = POLISH_ICON;
                const edit = holder.querySelector('.mes_edit');
                if (edit) holder.insertBefore(button, edit); else holder.append(button);
            }
            button.dataset.index = String(index);
            syncPolishButton(button, index);
        }
    }

    // 手改楼层：改完的正文和记录里的两版都不一样时，按「改之前显示的是哪一版」接过去，
    // 这样原版和润色版两个方向都还是无损的。
    function adoptEditedFloor(index) {
        const id = Number(index);
        if (!Number.isInteger(id)) return;
        const key = polishFloorRecord.get(id);
        if (!key) return;
        const next = adoptEdited(polishRecords, {
            key,
            text: getContext().chat?.[id]?.mes,
            side: polishLastView.get(key) ?? null,
        });
        if (next === polishRecords) return;
        polishLastView.delete(key);
        savePolishRecords(next);
        if (opened) refreshPolishPane();
    }

    function refreshPolishFloors() {
        const select = $('#tia-polish-floor');
        const rows = eligibleMessages(getContext().chat ?? []).filter(row => !row.message.is_user).slice(-20).reverse();
        if (!rows.length) {
            select.replaceChildren(new Option('这层聊天还没有角色回复', ''));
            select.disabled = true;
            return;
        }
        select.disabled = false;
        if (!rows.some(row => row.index === polishTarget)) polishTarget = rows[0].index;
        select.replaceChildren(...rows.map(row => {
            const name = String(row.message.name || '角色');
            const head = row.text.length > 16 ? `${row.text.slice(0, 16)}…` : row.text;
            return new Option(`第 ${row.index + 1} 层 · ${name}：${head}`, String(row.index));
        }));
        select.value = String(polishTarget);
    }

    // 人工确认后应用 draft（只可能是没能自动应用的那份结果）。
    function applyDraft() {
        const draft = polishDraft;
        if (!draft) return;
        const message = getContext().chat?.[draft.index];
        if (!message || String(message.mes ?? '') !== draft.original) {
            polishDraft = null;
            setStatus('polish', '这一层的内容已经变了，这份结果不再适用，已丢弃。', 'warning');
            refreshPolishPane();
            return;
        }
        // 手动确认也走拼回：思维链、面板、图片这些块照样原位留着。
        const composed = composePolished(draft.original, splitProse(draft.original, settings.polishStrip, regexPreservedRanges(draft.original), settings.polishBuiltinStrip !== false), draft.polished) || draft.polished;
        savePolishRecords(upsertRecord(polishRecords, { original: draft.original, polished: composed, model: draft.model }));
        polishDraft = null;
        applyPolishText(draft.index, composed);
        setStatus('polish', `已应用这份结果：正文 ${draft.prose.length} → ${draft.polished.length} 字。消息按钮行里的笔可以切回原版。`, 'success');
    }

    // 分支聊天只带得走 main_chat，父聊天的 metadata 不会跟过来 —— 本地镜像里能找到就能补回来。
    function inheritSource() {
        try {
            const ctx = getContext();
            const main = ctx.chatMetadata?.main_chat;
            if (!main) return null;
            const records = inheritRecords(readArchive(ctx.extensionSettings[KEY]), main);
            return records.length ? records : null;
        } catch { return null; }
    }

    function refreshPolishPane() {
        refreshPolishFloors();
        const ctx = getContext();
        const index = polishTarget;
        const state = polishState(index);
        const target = $('#tia-polish-target');
        if (!state.message) {
            target.textContent = '当前聊天还没有可润色的角色回复。';
        } else {
            const name = state.message.name || (state.message.is_user ? (ctx.name1 || '用户') : (ctx.name2 || '角色'));
            const kept = splitProse(state.message.mes, settings.polishStrip, regexPreservedRanges(state.message.mes), settings.polishBuiltinStrip !== false).dropped;
            const note = kept.length ? ` · 另有 ${kept.length} 块非正文（${kept.slice(0, 3).join('、')}）原样保留` : '';
            target.textContent = `目标：第 ${index + 1} 层（${name}）· 正文 ${proseOf(state.message.mes, index).length} 字 / 整条 ${String(state.message.mes ?? '').length} 字${note}${state.record ? ' · 已有润色记录' : ''}`;
        }
        const draft = polishDraft && polishDraft.index === index ? polishDraft : null;
        const shown = draft ?? state.record;
        const compare = $('#tia-polish-compare');
        compare.hidden = !shown;
        compare.dataset.mode = draft ? 'draft' : (state.record ? 'record' : '');
        if (shown) {
            // 对照里只放正文：思维链与面板数据既不是被改写的对象，也不该拿来比。
            $('#tia-polish-original').textContent = draft ? draft.prose : proseOf(shown.original, index);
            $('#tia-polish-polished').textContent = draft ? draft.polished : proseOf(shown.polished, index);
        }
        $('#tia-polish-actions').hidden = !shown;
        $('[data-action="polish-apply"]').hidden = !draft;
        $('[data-action="polish-discard"]').hidden = !draft;
        $('[data-action="polish-revert"]').hidden = !(state.record && state.view === 'polished');
        $('#tia-polish-inherit').hidden = !(!polishRecords.length && inheritSource());
        $('[data-action="polish-run"]').textContent = state.record ? '重新润色这一层' : '润色这一层';
        // 让用户能一眼看出正文是从哪来的：正则管线（真机正常）还是内置名单（拿不到引擎时兜底）。
        $('#tia-polish-source').textContent = regexEngine()
            ? '正文取自酒馆的正则管线：预设里「只改发送」的规则会先过一遍，和真正发给模型的内容一致。'
            : '正则管线当前不可用（读不到 regex/engine.js），这一版只按下面的名单取正文。';
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
        const tab = ['suggest', 'expand', 'polish', 'settings'].includes(name) ? name : 'suggest';
        settings.activeTab = tab;
        persistSettings();
        for (const button of panel.querySelectorAll('[data-tab]')) button.setAttribute('aria-selected', String(button.dataset.tab === tab));
        for (const section of panel.querySelectorAll('.tia-pane')) section.hidden = section.id !== `tia-pane-${tab}`;
        if (tab === 'suggest') refreshContext();
        if (tab === 'polish') refreshPolishPane();
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

    // ---- 自动任务 ----
    // 两个自动开关都开着时先润色：选项要基于润色之后的正文来想，顺序反了就白想一轮。
    async function autoAfterGeneration() {
        if (!mounted) return;
        if (settings.polishAuto) await autoPolish();
        await autoSuggest();
    }

    async function autoPolish() {
        if (!mounted) return;
        const plan = planAutoPolish(settings, {
            chat: getContext().chat,
            running: Boolean(job),
            stopped: Date.now() - stoppedAt < 1500,
            records: polishRecords,
            tried: polishTried,
        });
        if (!plan.run) return;
        await run('polish', { index: plan.index, automatic: true });
    }

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

    async function run(action, { automatic = false, input = '', index = null } = {}) {
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
                renderModelLists();
                $('#tia-model-hint').textContent = models.length ? '点一个模型即可选用；也可以直接在输入框里改写。' : '这个渠道没有返回任何模型。';
                toggleModelList('model-list', true);
                setStatus('settings', `已读取 ${models.length} 个模型。列表不保证都能做对话补全；主模型与润色模型共用这一份列表。`, 'success');
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
            } else if (action === 'polish') {
                const target = Number.isInteger(index) ? index : polishTarget;
                polishTarget = target;
                startClock('polish', automatic ? '模型回复已结束，正在润色' : '正在润色');
                const result = await service.polish(config, target, controller.signal);
                const current = getContext().chat?.[target];
                // 请求期间那一层可能被 swipe / 重新生成 / 手改过：正文对不上就丢弃，绝不覆盖新内容。
                if (!current || String(current.mes ?? '') !== result.original) {
                    setStatus('polish', '这一层在润色期间被改动过（swipe、重新生成或手改），这次结果已丢弃。', 'warning');
                } else {
                    // 判定拿正文比（思维链、面板数据不参与），通过后再拼回原楼层文本。
                    const verdict = planPolishApplication({ original: result.prose, polished: result.text });
                    const composed = verdict.apply ? composePolished(result.original, result.split, verdict.text) : '';
                    const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
                    const kept = result.split.dropped.length ? `，另有 ${result.split.dropped.length} 块非正文原样保留` : '';
                    const source = `读了 ${result.count} 层${result.worldInfoLength ? `，世界书 ${result.worldInfoLength} 字` : ''}，用时 ${seconds} 秒${kept}`;
                    if (composed) {
                        polishDraft = null;
                        savePolishRecords(upsertRecord(polishRecords, { original: result.original, polished: composed, model: result.model }));
                        applyPolishText(target, composed);
                        setStatus('polish', `已润色并替换正文：${result.prose.length} → ${verdict.text.length} 字（${source}）。消息按钮行里的笔可以随时切回原版。`, 'success');
                    } else {
                        polishDraft = { index: target, original: result.original, prose: result.prose, polished: verdict.text, model: result.model, reason: verdict.reason || '改写结果没能拼回原文' };
                        setStatus('polish', `没有自动替换：${polishDraft.reason}。下面是对照（只比正文），确认没问题可以点「仍然应用这份结果」。`, 'warning');
                    }
                }
                if (opened) refreshPolishPane();
            }
        } catch (error) {
            const aborted = controller.signal.aborted;
            const message = aborted
                ? (controller.signal.reason === 'timeout' ? '等待超时。渠道可能还在处理，可以再点一次。' : '已取消。')
                : safeError(error, config.apiKey);
            const where = action === 'models' ? 'settings' : action;
            setStatus(where, message, aborted ? 'warning' : 'error');
            // 自动润色失败后不再对同一版正文自动重试（手动点按钮不受影响）。
            if (action === 'polish') {
                const node = getContext().chat?.[Number.isInteger(index) ? index : polishTarget];
                if (node) {
                    polishTried.add(hashText(String(node.mes ?? '')));
                    if (polishTried.size > 50) polishTried.delete(polishTried.values().next().value);
                }
            }
        } finally {
            clearTimeout(timeout);
            job = null;
            setBusy(false);
        }
    }

    // 两个模型输入框共用同一套列表组件：两个模型都跑在同一个渠道上，所以一次「读取模型」
    // 就填满两份列表，点选时按列表所在的那个输入框回写。
    const PICKERS = [
        { key: 'model', input: '#tia-model', list: '#tia-model-list', action: 'model-list', where: 'settings' },
        { key: 'polishModel', input: '#tia-polish-model', list: '#tia-polish-model-list', action: 'polish-model-list', where: 'polish' },
    ];
    function pickerByAction(action) { return PICKERS.find(picker => picker.action === action) ?? null; }
    function pickerByList(list) { return PICKERS.find(picker => `#${list?.id}` === picker.list) ?? null; }

    function renderModelLists() {
        for (const picker of PICKERS) {
            const chosen = String(settings[picker.key] ?? '').trim();
            $(picker.list).replaceChildren(...models.map(name => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'tia-model-item';
                item.dataset.model = name;
                item.textContent = name;
                item.setAttribute('aria-pressed', String(name === chosen));
                return item;
            }));
        }
    }

    function markChosenModels() {
        for (const picker of PICKERS) {
            const chosen = String(settings[picker.key] ?? '').trim();
            for (const item of $(picker.list).children) item.setAttribute('aria-pressed', String(item.dataset.model === chosen));
        }
    }

    function toggleModelList(action, force) {
        const picker = pickerByAction(action);
        if (!picker) return;
        const list = $(picker.list);
        const show = typeof force === 'boolean' ? force : list.hidden;
        if (show && !list.childElementCount) { setStatus(picker.where, '还没有模型列表，先点「读取模型」。', 'warning'); return; }
        list.hidden = !show;
        $(`[data-action="${picker.action}"]`).setAttribute('aria-expanded', String(show));
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
            if (key === 'model' || key === 'polishModel') {
                const picker = PICKERS.find(entry => entry.key === key);
                if (picker) { toggleModelList(picker.action, false); markChosenModels(); }
            }
            if (key === 'suggestPreset' || key === 'expandPreset' || key === 'polishPreset' || key === 'polishContext' || key === 'polishStrip' || key === 'polishBuiltinStrip' || key === 'recentCount' || key === 'worldInfoInject' || key === 'worldInfoMaxChars') void refreshPreview();
            if (key === 'recentCount') refreshContext();
            if (key === 'polishContext' || key === 'polishStrip' || key === 'polishBuiltinStrip') void refreshPolishPane();
        };
        listen(input, 'input', onInput);
        listen(input, 'change', onInput);
    }
    listen($('#tia-expand-input'), 'input', refreshPreview);
    listen($('#tia-polish-floor'), 'change', () => {
        polishTarget = Number($('#tia-polish-floor').value);
        refreshPolishPane();
        void refreshPreview();
    });
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
        const item = event.target.closest('.tia-model-item');
        if (item) {
            const picker = pickerByList(item.closest('.tia-model-list'));
            if (picker) {
                settings[picker.key] = item.dataset.model;
                $(picker.input).value = item.dataset.model;
                persistSettings();
                refreshHints();
                toggleModelList(picker.action, false);
                setStatus(picker.where, `已选用模型 ${item.dataset.model}。`, 'success');
                void refreshPreview();
            }
            return;
        }
        const action = event.target.closest('[data-action]')?.dataset.action;
        if (action === 'close') close();
        if (action === 'cancel') job?.abort('user');
        if (action === 'model-list' || action === 'polish-model-list') toggleModelList(action);
        if (action === 'models') void run('models');
        if (action === 'suggest') void run('suggest');
        if (action === 'polish-run' || action === 'polish-retry') void run('polish', { index: polishTarget });
        if (action === 'polish-apply') applyDraft();
        if (action === 'polish-discard') {
            polishDraft = null;
            setStatus('polish', '已放弃这份结果，正文没有改动。');
            refreshPolishPane();
        }
        if (action === 'polish-revert') {
            const state = polishState(polishTarget);
            if (state.record) {
                applyPolishText(polishTarget, state.record.original);
                setStatus('polish', `已恢复第 ${polishTarget + 1} 层的原版正文。润色版还在记录里，随时可以切回去。`, 'success');
            }
        }
        if (action === 'polish-inherit') {
            const records = inheritSource();
            if (!records) {
                setStatus('polish', '本地镜像里没有这个聊天的记录，先在主聊天里用一次润色再回来。', 'warning');
            } else {
                savePolishRecords(records);
                refreshPolishPane();
                injectPolishButtons();
                setStatus('polish', `已从主聊天继承 ${records.length} 条润色记录。`, 'success');
            }
        }
        if (action === 'restore-polish-preset') {
            settings.polishPreset = DEFAULT_POLISH_PRESET;
            $('#tia-polish-preset').value = DEFAULT_POLISH_PRESET;
            persistSettings();
            void refreshPreview();
            setStatus('polish', '已恢复默认预设。', 'success');
        }
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

    // 消息按钮行里的润色按钮：还没记录就润色这一层，已有记录就在原版 / 润色版之间切。
    listen(document, 'click', event => {
        const button = event.target.closest?.('.tia-polish-btn');
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        const index = Number(button.dataset.index);
        const state = polishState(index);
        if (!state.message) return;
        if (!state.record) {
            polishTarget = index;
            void run('polish', { index });
            return;
        }
        // 手改过的楼层以润色版为目标版；原版始终留在记录里，来回切都是无损的。
        applyPolishText(index, state.view === 'polished' ? state.record.original : state.record.polished);
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
    for (const name of ['CHAT_CHANGED', 'MESSAGE_RECEIVED', 'MESSAGE_SENT', 'MESSAGE_DELETED', 'MESSAGE_UPDATED', 'MESSAGE_SWIPED', 'MESSAGE_EDITED', 'CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'GENERATION_ENDED', 'GENERATION_STOPPED']) {
        const type = context.eventTypes?.[name];
        if (!type) continue;
        const handler = (...args) => {
            if (name === 'MESSAGE_EDITED') adoptEditedFloor(args[0]);
            if (name === 'CHAT_CHANGED') {
                suggestions = []; injected = new Set(); lastSuggest = null; expandResult = '';
                // 润色记录是存在聊天自己的 metadata 里的，换聊天必须重新读一遍。
                polishRecords = readPolishRecords(); polishDraft = null; polishTried.clear();
                polishFloorRecord.clear(); polishLastView.clear();
                polishTarget = lastAssistantIndex(getContext().chat);
                renderOptions(); markBadge(false); refreshPolishPane();
            }
            if (name === 'GENERATION_STOPPED') stoppedAt = Date.now();
            // ST 的 GENERATION_ENDED 由 hideStopButton() 发出，stopGeneration() 也会走它，
            // 且同一 tick 紧跟 GENERATION_STOPPED —— 推迟一拍，让手动停止优先。
            if (name === 'GENERATION_ENDED') {
                polishTarget = lastAssistantIndex(getContext().chat);
                setTimeout(() => { void autoAfterGeneration(); }, 0);
            }
            // 切换 swipe / 手改楼层不会触发生成，内容变了就让去重记录失效，下一轮可以重新生成。
            if (name === 'MESSAGE_SWIPED' || name === 'MESSAGE_UPDATED' || name === 'MESSAGE_EDITED') lastSuggest = null;
            // 酒馆重渲染楼层（swipe、编辑、切聊天、新回复）会把注入的按钮冲掉，凡是楼层变动都补一次。
            if (name !== 'GENERATION_ENDED' && name !== 'GENERATION_STOPPED') injectPolishButtons();
            if (opened) {
                refreshContext();
                if (settings.activeTab === 'suggest') refreshPreview();
                if (settings.activeTab === 'polish') { refreshPolishPane(); refreshPreview(); }
            }
        };
        context.eventSource.on(type, handler);
        listeners.push([type, handler]);
    }

    // 正则管线是异步加载的：加载完刷新一次（预设里「只改发送」的规则会改变正文的内容）。
    void loadRegexEngine().then(() => { if (opened) { refreshPolishPane(); void refreshPreview(); } });
    ensureTriggerRetry();
    injectPolishButtons();
    refreshHints();
    refreshContext();
    refreshPolishPane();
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
            for (const node of document.querySelectorAll('.tia-polish-btn')) node.remove();
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
