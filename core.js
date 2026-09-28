// 纯逻辑层：不碰 DOM，可用 `node --test` 直接覆盖。
// 连接、校验、请求路由的写法沿用 tavern-image-bridge（同一套 CLIProxyAPI 踩坑经验）。

export const KEY = 'tavern_input_assist';

export const DEFAULTS = Object.freeze({
    transport: 'server',
    baseUrl: 'http://127.0.0.1:8317/v1',
    apiKey: '',
    rememberKey: false,
    model: '',
    recentCount: 8,
    timeoutSeconds: 120,
    worldInfoInject: true,
    worldInfoMaxChars: 4000,
    injectMode: 'append',
    autoSuggest: false,
    activeTab: 'suggest',
});

export function loadSettings(stored = {}) {
    const transport = stored.transport ?? (Object.keys(stored).length ? 'direct' : DEFAULTS.transport);
    return {
        ...DEFAULTS,
        ...stored,
        transport,
        apiKey: stored.rememberKey ? stored.apiKey || '' : '',
    };
}

export function endpoints(input) {
    let url;
    try { url = new URL(String(input).trim()); } catch { throw new Error('请输入完整的 API 地址，例如 http://127.0.0.1:8317/v1'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error('API 地址只支持 HTTP/HTTPS，不能包含账号、密码、查询参数或 #。');
    }
    let path = url.pathname.replace(/\/+$/, '');
    if (/\/chat\/completions$/.test(path)) path = path.slice(0, -'/chat/completions'.length);
    else if (/\/models$/.test(path)) path = path.slice(0, -'/models'.length);
    else if (/\/(?:responses|completions)$/.test(path)) throw new Error('请填写 API 基础地址（例如 .../v1），而不是某个具体接口。');
    if (!path) path = '/v1';
    return { chat: `${url.origin}${path}/chat/completions`, models: `${url.origin}${path}/models` };
}

export function validateSettings(settings) {
    if (!['server', 'direct'].includes(settings.transport)) throw new Error('请选择酒馆后台转发或浏览器直连。');
    return validateConnection(settings);
}

// 地址与连接方式的校验：读取模型列表只需要这些，不需要模型名本身。
export function validateEndpoint(settings) {
    if (!['server', 'direct'].includes(settings.transport)) throw new Error('请选择酒馆后台转发或浏览器直连。');
    endpoints(settings.baseUrl);
    return settings;
}

export function validateConnection(settings) {
    validateEndpoint(settings);
    if (!String(settings.model ?? '').trim()) throw new Error('还没有填文字模型名称。点「读取模型」可以列出这个渠道的模型，再点选一个。');
    const floors = Number(settings.recentCount);
    if (!Number.isInteger(floors) || floors < 1 || floors > 100) throw new Error('上下文层数必须是 1–100 的整数。');
    const seconds = Number(settings.timeoutSeconds);
    if (!Number.isFinite(seconds) || seconds < 10 || seconds > 600) throw new Error('最长等待必须是 10–600 秒。');
    const chars = Number(settings.worldInfoMaxChars);
    if (!Number.isInteger(chars) || chars < 200 || chars > 20000) throw new Error('世界书字数上限必须是 200–20000 的整数。');
    if (!['append', 'replace'].includes(settings.injectMode)) throw new Error('注入方式无效。');
    return settings;
}

export function cleanMessage(value) {
    return String(value ?? '')
        .replace(/<(script|style|think|thinking)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/<br\s*\/?\s*>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/data:image\/[^;\s]+;base64,[A-Za-z0-9+/=]+/g, '[图片]')
        .trim();
}

export function eligibleMessages(chat, endIndex = chat.length - 1) {
    return chat.slice(0, endIndex + 1)
        .map((message, index) => ({ message, index, text: cleanMessage(message.mes) }))
        .filter(row => !row.message.is_system && row.text);
}

// 取「最后一条有内容的楼层」作为上下文末尾；没有内容时返回 -1。
export function resolveContextEnd(chat) {
    return eligibleMessages(chat).at(-1)?.index ?? -1;
}

export function chatIdentity(context) {
    return JSON.stringify([context.groupId ?? null, context.characters?.[context.characterId]?.avatar ?? context.characterId ?? null, context.getCurrentChatId?.() ?? context.chatId ?? null]);
}

// 自动生成选项的守卫：每条都能挡住一次白花的请求。
export function planAutoSuggest(settings, { chat = [], running = false, stopped = false, last = null } = {}) {
    if (!settings?.autoSuggest) return { run: false, reason: '自动生成选项未开启' };
    if (running) return { run: false, reason: '已有请求正在进行' };
    if (stopped) return { run: false, reason: '本次回复已被用户停止' };
    const row = eligibleMessages(chat).at(-1);
    if (!row) return { run: false, reason: '没有可用的聊天楼层' };
    if (row.message.is_user) return { run: false, reason: '最新楼层是用户自己的消息' };
    if (last && last.index === row.index && last.text === row.text) return { run: false, reason: '这一层已经生成过选项' };
    return { run: true, index: row.index };
}

// 输入框内容与新文本的合并规则：空则直接填入，否则按设置追加或替换。
export function mergeInput(current, text, mode = 'append') {
    const body = String(text ?? '').trim();
    if (!body) return String(current ?? '');
    const existing = String(current ?? '');
    if (mode === 'replace' || !existing.trim()) return body;
    return `${existing.replace(/\s+$/, '')}\n${body}`;
}

// ---- 面板定位与限高 ----
// 面板挂在 body 上、用 fixed + top/left 定位，从触发按钮上方弹出。这里是纯计算，
// 位置和最大高度都能单测；viewport 传视觉视口高度（手机上工具栏会改它）。
export const PANEL_GAP = 10;             // 面板底边与触发按钮顶边之间的默认间距
export const PANEL_LIFT = 50;            // 窄屏再往上抬这么多，别压住输入区那排开关按钮
export const PANEL_MARGIN = 8;           // 视口四边留白
export const PANEL_HEIGHT_RESERVE = 132; // 最大高度 = 视口高度 - 这个值（上下留白 32 + 再收 100）
export const PANEL_MIN_HEIGHT = 140;     // 再挤也留这么高，免得面板被压成一条缝
export const PANEL_COMPACT_WIDTH = 600;  // 与 style.css 里移动端断点保持一致

export function planPanelPlacement({ top = 0, left = 0, width = 0, height = 0, viewportWidth = 0, viewportHeight = 0, compact = false } = {}) {
    const triggerTop = Number(top) || 0;
    const gap = PANEL_GAP + (compact ? PANEL_LIFT : 0);
    const bottomLimit = triggerTop - gap;                 // 面板底边不得低过这里，否则会盖住按钮
    const room = bottomLimit - PANEL_MARGIN;              // 按钮上方真正能用的高度
    const cap = viewportHeight > 0 ? viewportHeight - PANEL_HEIGHT_RESERVE : room; // 视口兜底，别伸到屏幕外
    const maxHeight = Math.max(PANEL_MIN_HEIGHT, Math.min(room, cap));
    // 面板会被 max-height 截断，所以按截断后的高度反推顶边，底边就永远落在 bottomLimit 上。
    const drawn = Math.min(Number(height) || maxHeight, maxHeight);
    const panelTop = Math.max(PANEL_MARGIN, bottomLimit - drawn);
    let panelLeft = Number(left) || 0;
    if (width > 0 && viewportWidth > 0 && panelLeft + width > viewportWidth - PANEL_MARGIN) {
        panelLeft = viewportWidth - PANEL_MARGIN - width;
    }
    return { top: panelTop, left: Math.max(PANEL_MARGIN, panelLeft), maxHeight };
}

export function isCompactPanelLayout(viewportWidth = 0) {
    return Number(viewportWidth) > 0 && Number(viewportWidth) <= PANEL_COMPACT_WIDTH;
}

export function safeError(error, secret = '') {
    let text = String(error?.message || error || '未知错误');
    if (secret) text = text.split(secret).join('[已隐藏密钥]');
    return text.replace(/Bearer\s+[^\s"',;<>]+/gi, 'Bearer [已隐藏]').slice(0, 650);
}

export async function readJson(response, { transport = 'direct' } = {}) {
    const text = await response.text();
    if (transport === 'server') {
        if (response.status === 401 && /\bbasic\b/i.test(response.headers.get('www-authenticate') || '')) {
            throw new Error('酒馆或前置反代要求 HTTP Basic Auth，但这次 /proxy/ 请求没有带上酒馆登录凭据。请在浏览器中重新登录或刷新酒馆页面，并确认前置反代没有拦掉 /proxy/；不要关闭登录保护。');
        }
        if (response.status === 404 && /CORS proxy is disabled/i.test(text)) {
            throw new Error('酒馆后台代理尚未启用。请在酒馆实际使用的 config.yaml 中设置 enableCorsProxy: true，然后重启酒馆。');
        }
        if (response.redirected || /^\s*(?:<!doctype html|<html)/i.test(text)) {
            throw new Error(`HTTP ${response.status}：酒馆后台返回了网页。请检查登录状态、/proxy/ 路由及前置反代配置。`);
        }
    }
    let body;
    try { body = JSON.parse(text); } catch {
        if (transport === 'server') throw new Error(`HTTP ${response.status}：酒馆后台未返回 JSON。请检查 enableCorsProxy、酒馆服务器到 API 的连接及反代日志。`);
        throw new Error(`HTTP ${response.status}：接口没有返回 JSON。请检查 API 地址、反向代理和登录状态。`);
    }
    if (!body || typeof body !== 'object') throw new Error('接口返回了无效的 JSON 内容。');
    if (!response.ok || body.error) {
        const detail = typeof body.error === 'string' ? body.error : body.error?.message;
        const tips = { 401: '请检查渠道的客户端 API Key。', 403: '访问被拒绝，请检查渠道权限或该模型是否可见。', 404: '请检查 API 地址与渠道版本。', 429: '额度或速率受限，请稍后重试。' };
        throw new Error(`HTTP ${response.status}：${detail || body.message || tips[response.status] || '请求失败'}${detail && tips[response.status] ? `\n${tips[response.status]}` : ''}`);
    }
    return body;
}

export function routeRequest(settings, target, { signal, method = 'GET', body, requestHeaders = {}, withApiKey = true, accept = 'application/json' } = {}) {
    const transport = settings.transport ?? DEFAULTS.transport;
    if (!['server', 'direct'].includes(transport)) throw new Error('无效的连接方式。');
    const url = new URL(target);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('转发目标必须是无内嵌账号密码的 HTTP/HTTPS 地址。');
    const headers = { Accept: accept };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    // /proxy/ 挂在酒馆自己的 Basic 认证后面，浏览器会把酒馆登录塞进同一个 Authorization 头，
    // 所以后台转发模式下上游密钥走 x-api-key（CLIProxyAPI 两种都收），直连模式才用 Bearer。
    if (withApiKey && settings.apiKey?.trim()) {
        if (transport === 'server') headers['x-api-key'] = settings.apiKey.trim();
        else headers.Authorization = `Bearer ${settings.apiKey.trim()}`;
    }
    if (transport === 'server') {
        const csrf = new Headers(requestHeaders).get('X-CSRF-Token');
        if (csrf) headers['X-CSRF-Token'] = csrf;
    }
    const options = {
        method, headers, signal,
        credentials: transport === 'server' ? 'same-origin' : 'omit',
        cache: 'no-store', referrerPolicy: 'no-referrer',
    };
    if (body !== undefined) options.body = body;
    if (transport === 'server') options.redirect = 'error';
    return { url: transport === 'server' ? `/proxy/${encodeURIComponent(url.href)}` : url.href, options };
}

export function makeChatPayload(settings, messages) {
    // 不主动发送 max_tokens / temperature：不同渠道对这些字段的默认值与上限不一致。
    return { model: String(settings.model).trim(), messages, stream: false };
}

export async function apiRequest(settings, kind, { signal, messages, fetchImpl = fetch, requestHeaders = {} } = {}) {
    if (!['models', 'chat'].includes(kind)) throw new Error('无效的 API 请求类型。');
    const transport = settings.transport ?? DEFAULTS.transport;
    const { url, options } = routeRequest(settings, endpoints(settings.baseUrl)[kind], {
        signal, requestHeaders, method: kind === 'models' ? 'GET' : 'POST',
        body: kind === 'models' ? undefined : JSON.stringify(makeChatPayload(settings, messages)),
    });
    let response;
    try { response = await fetchImpl(url, options); } catch (error) {
        if (signal?.aborted) throw error;
        if (transport === 'server') throw new Error('无法连接酒馆后台代理。请检查酒馆登录、/proxy/ 转发配置和服务器日志。不会自动切换到浏览器直连。');
        throw new Error('无法连接 API。请检查地址、渠道是否运行、CORS，以及 HTTPS 页面是否拦截了 HTTP 请求。手机上的 127.0.0.1 指向手机本身。');
    }
    return readJson(response, { transport });
}
