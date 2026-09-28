// 提示词构建与模型输出的解析。除了取世界书那一步要问酒馆，其余都是纯函数，
// 模型输出一律当作不可信文本处理。

import { cleanMessage, eligibleMessages } from './core.js';

// 六个选项的位置是固定的，每个位置有自己的角色；UI 按序号给它们上色和贴标签。
export const SUGGEST_KINDS = Object.freeze(['branch', 'branch', 'branch', 'novel', 'dark', 'skip']);
export const SUGGEST_LABELS = Object.freeze({ branch: '分支', novel: '新奇', dark: '邪恶', skip: '跳跃' });

export function suggestKind(index) {
    return SUGGEST_KINDS[index] ?? 'branch';
}

export const DEFAULT_SUGGEST_PRESET = `你在协助用户（{{user}}）推进一段角色扮演对话。

请阅读下面的聊天记录，替用户想出 6 个接下来可以发送的消息。这 6 条的位置是固定的，每条扮演不同的角色，顺序不能变：

第 1–3 条 · 正常分支：符合当前情境、语气自然的下一步。三条之间要有明显区别（例如态度不同、行动方向不同），不要只是换几个词。
第 4 条 · 新奇：意想不到、脑洞大开、跳出常规的方向，但仍然接得住当前场景。
第 5 条 · 邪恶：更阴暗、更放肆、更自私或更具侵略性的选择，符合 {{user}} 的处境但不圣洁。
第 6 条 · 跳跃：大幅推进时间线，跳过眼前的细节，把剧情直接推到之后的某个时刻或结果。

共同的写法要求：
1. 每一条都是 {{user}} 本人将要说出或做出的一句话，用第一人称，写成一个可以直接发送的完整句子。
2. 不要写成旁白说明、选项标签或对别人的指示，也不要替对方说话或行动。
3. 第 4、5、6 条必须和前三条的走向明显不同，让人一眼看出来。
4. 只输出一个 JSON 字符串数组，正好 6 个元素，顺序严格对应上面的第 1–6 条，例如 ["……", "……"]。不要输出解释、标题、编号或代码围栏。

{{worldinfo}}
【聊天记录】
{{chat}}`;

export const DEFAULT_EXPAND_PRESET = `你在协助用户（{{user}}）把一句简短的想法扩写成一条可以直接发送的角色扮演消息。

用户的想法：
{{input}}

要求：
1. 保持用户的意图和立场不变，不要替用户做出新的重大决定，也不要替对方说话或行动。
2. 写成 {{user}} 将要发送的一条完整消息：可以包含动作、神态、对白和内心活动，长度 1–3 段。
3. 沿用下面聊天记录里的称呼、语气与当前场景，让内容自然接得上。
4. 只输出这条消息本身，不要解释、不要加标题、不要用代码围栏包裹。

{{worldinfo}}
【聊天记录】
{{chat}}`;

export function fillTemplate(template, vars = {}) {
    return String(template ?? '').replace(/\{\{\s*([A-Za-z_][\w]*)\s*\}\}/g, (match, name) => (name in vars ? String(vars[name] ?? '') : match));
}

// 历史版本的出厂预设。用来分辨「用户没动过默认值」和「用户自己改过」：
// 存下来的文本只要与其中某一版逐字一致，就说明还是出厂默认，可以安全升级到当前默认值。
export const LEGACY_SUGGEST_PRESETS = Object.freeze([
    // 1.0.0
    `你在协助用户（{{user}}）推进一段角色扮演对话。

请阅读下面的聊天记录，替用户想出 {{count}} 个接下来可以发送的消息。

要求：
1. 每一条都是用户本人将要说出或做出的一句话，用第一人称，写成一个可以直接发送的句子。
2. 语气、长度和称呼方式要贴近这段对话既有的氛围，符合 {{user}} 当下的处境。
3. {{count}} 条之间要有明显区别，例如态度不同（试探、直白、回避、开玩笑）、行动方向不同，不要只是换几个词。
4. 只输出一个 JSON 字符串数组，例如 ["……", "……"]，不要输出解释、标题、编号或代码围栏。

角色：{{char}}
用户：{{user}}

【聊天记录】
{{chat}}`,
    // 1.1.0 / 1.1.1
    `你在协助用户（{{user}}）推进一段角色扮演对话。

请阅读下面的聊天记录，替用户想出 6 个接下来可以发送的消息。这 6 条的位置是固定的，每条扮演不同的角色，顺序不能变：

第 1–3 条 · 正常分支：符合当前情境、语气自然的下一步。三条之间要有明显区别（例如态度不同、行动方向不同），不要只是换几个词。
第 4 条 · 新奇：意想不到、脑洞大开、跳出常规的方向，但仍然接得住当前场景。
第 5 条 · 邪恶：更阴暗、更放肆、更自私或更具侵略性的选择，符合 {{user}} 的处境但不圣洁。
第 6 条 · 跳跃：大幅推进时间线，跳过眼前的细节，把剧情直接推到之后的某个时刻或结果。

共同的写法要求：
1. 每一条都是 {{user}} 本人将要说出或做出的一句话，用第一人称，写成一个可以直接发送的完整句子。
2. 不要写成旁白说明、选项标签或对 {{char}} 的指示，也不要替 {{char}} 说话。
3. 第 4、5、6 条必须和前三条的走向明显不同，让人一眼看出来。
4. 只输出一个 JSON 字符串数组，正好 6 个元素，顺序严格对应上面的第 1–6 条，例如 ["……", "……"]。不要输出解释、标题、编号或代码围栏。

角色：{{char}}
用户：{{user}}

【聊天记录】
{{chat}}`,
    // 1.2.0 之前的一版（把 {{char}} 去掉了，但还没有世界书）
    `你在协助用户（{{user}}）推进一段角色扮演对话。

请阅读下面的聊天记录，替用户想出 6 个接下来可以发送的消息。这 6 条的位置是固定的，每条扮演不同的角色，顺序不能变：

第 1–3 条 · 正常分支：符合当前情境、语气自然的下一步。三条之间要有明显区别（例如态度不同、行动方向不同），不要只是换几个词。
第 4 条 · 新奇：意想不到、脑洞大开、跳出常规的方向，但仍然接得住当前场景。
第 5 条 · 邪恶：更阴暗、更放肆、更自私或更具侵略性的选择，符合 {{user}} 的处境但不圣洁。
第 6 条 · 跳跃：大幅推进时间线，跳过眼前的细节，把剧情直接推到之后的某个时刻或结果。

共同的写法要求：
1. 每一条都是 {{user}} 本人将要说出或做出的一句话，用第一人称，写成一个可以直接发送的完整句子。
2. 不要写成旁白说明、选项标签或对别人的指示，也不要替对方说话或行动。
3. 第 4、5、6 条必须和前三条的走向明显不同，让人一眼看出来。
4. 只输出一个 JSON 字符串数组，正好 6 个元素，顺序严格对应上面的第 1–6 条，例如 ["……", "……"]。不要输出解释、标题、编号或代码围栏。

【聊天记录】
{{chat}}`,
]);

export const LEGACY_EXPAND_PRESETS = Object.freeze([
    // 1.2.0 之前的一版（把 {{char}} 去掉了，但还没有世界书）
    `你在协助用户（{{user}}）把一句简短的想法扩写成一条可以直接发送的角色扮演消息。

用户的想法：
{{input}}

要求：
1. 保持用户的意图和立场不变，不要替用户做出新的重大决定，也不要替对方说话或行动。
2. 写成 {{user}} 将要发送的一条完整消息：可以包含动作、神态、对白和内心活动，长度 1–3 段。
3. 沿用下面聊天记录里的称呼、语气与当前场景，让内容自然接得上。
4. 只输出这条消息本身，不要解释、不要加标题、不要用代码围栏包裹。

【聊天记录】
{{chat}}`,
    // 1.0.0 – 1.1.1
    `你在协助用户（{{user}}）把一句简短的想法扩写成一条可以直接发送的角色扮演消息。

用户的想法：
{{input}}

要求：
1. 保持用户的意图和立场不变，不要替用户做出新的重大决定，也不要替 {{char}} 说话或行动。
2. 写成 {{user}} 将要发送的一条完整消息：可以包含动作、神态、对白和内心活动，长度 1–3 段。
3. 沿用下面聊天记录里的称呼、语气与当前场景，让内容自然接得上。
4. 只输出这条消息本身，不要解释、不要加标题、不要用代码围栏包裹。

角色：{{char}}
用户：{{user}}

【聊天记录】
{{chat}}`,
]);

function normalizePreset(value) {
    return String(value ?? '').replace(/\r\n/g, '\n').trim();
}

// 出厂默认值自动升级到当前版本；用户自己写过的预设一个字都不动。
export function migratePresets(settings) {
    const next = { ...settings };
    if (LEGACY_SUGGEST_PRESETS.some(old => normalizePreset(old) === normalizePreset(settings.suggestPreset))) {
        next.suggestPreset = DEFAULT_SUGGEST_PRESET;
    }
    if (LEGACY_EXPAND_PRESETS.some(old => normalizePreset(old) === normalizePreset(settings.expandPreset))) {
        next.expandPreset = DEFAULT_EXPAND_PRESET;
    }
    return next;
}

// 角色名优先从聊天记录里取：`name2` / 角色卡上的名字有可能只是卡片名或文件名，
// 剧情里到底怎么称呼，以消息自带的 name 为准。
export function names(context) {
    const rows = Array.isArray(context?.chat) ? context.chat : [];
    const lastNamed = predicate => {
        for (let i = rows.length - 1; i >= 0; i--) {
            if (!predicate(rows[i])) continue;
            const name = String(rows[i]?.name ?? '').trim();
            if (name) return name;
        }
        return '';
    };
    return {
        char: lastNamed(row => !row?.is_user && !row?.is_system)
            || String(context?.name2 || context?.characters?.[context?.characterId]?.name || '角色'),
        user: lastNamed(row => row?.is_user) || String(context?.name1 || '用户'),
    };
}

// 把若干楼层拼成「说话人：内容」的纯文本。
function renderHistory(rows, context) {
    const { char, user } = names(context);
    return rows.map(row => `${row.message.name || (row.message.is_user ? user : char)}：${row.text}`).join('\n');
}

// 取最近 N 层有效聊天。
export function buildHistory(context, settings, endIndex) {
    const floors = Number(settings.recentCount) || 8;
    return renderHistory(eligibleMessages(context.chat, endIndex).slice(-floors), context);
}

// 世界书的上下文预算。酒馆用它按比例裁剪激活条目，这里给一个常见上下文长度即可，
// 真正的长度控制在下面的 maxChars。
const WORLD_INFO_MAX_CONTEXT = 8192;

// 告诉世界书扫描器当前的角色卡内容，让「限定角色」的条目也能按酒馆自己的规则命中。
function worldInfoScanData(context) {
    const character = context?.characters?.[context?.characterId] ?? {};
    return {
        personaDescription: '',
        characterDescription: String(character.description ?? ''),
        characterPersonality: String(character.personality ?? ''),
        characterDepthPrompt: String(character.charDepthPrompt ?? character.depth_prompt?.prompt ?? ''),
        scenario: String(character.scenario ?? ''),
        creatorNotes: String(character.creator_notes ?? ''),
    };
}

// 用酒馆自己的激活逻辑取世界书，这样和真正发给模型的内容一致。
// 拿不到（旧版本没有这个接口、没有世界书、抛错）就静默返回空串，选项生成照常跑。
export async function buildWorldInfoBlock(context, { maxChars = 4000 } = {}) {
    if (typeof context?.getWorldInfoPrompt !== 'function') return '';
    let result;
    try {
        result = await context.getWorldInfoPrompt(context.chat, WORLD_INFO_MAX_CONTEXT, true, worldInfoScanData(context));
    } catch {
        return '';
    }
    const parts = [];
    if (typeof result?.worldInfoString === 'string' && result.worldInfoString.trim()) parts.push(result.worldInfoString.trim());
    // @Depth 位置的条目不会进 worldInfoString，要单独补上。
    for (const group of Array.isArray(result?.worldInfoDepth) ? result.worldInfoDepth : []) {
        for (const text of Array.isArray(group?.entries) ? group.entries : []) {
            if (typeof text === 'string' && text.trim()) parts.push(text.trim());
        }
    }
    const text = parts.join('\n');
    if (!text) return '';
    return text.length > maxChars ? `${text.slice(0, maxChars)}\n（世界书较长，以上为截断内容）` : text;
}

export function buildSuggestMessages(context, settings, endIndex, worldInfo = '') {
    const floors = eligibleMessages(context.chat, endIndex).slice(-(Number(settings.recentCount) || 8));
    if (!floors.length) throw new Error('当前聊天还没有可用内容，先聊几句再生成选项。');
    const { char, user } = names(context);
    const history = renderHistory(floors, context);
    const preset = settings.suggestPreset || DEFAULT_SUGGEST_PRESET;
    // {{worldinfo}} 展开成「【世界设定】+ 内容 + 换行」，没有世界书时就是空串，不会留下空标题。
    const worldBlock = worldInfo ? `【世界设定】\n${worldInfo}\n` : '';
    const hasWorldInfo = /\{\{\s*worldinfo\s*\}\}/.test(preset);
    const hasChat = /\{\{\s*chat\s*\}\}/.test(preset);
    // 预设没写 {{worldinfo}} 时把世界设定贴在聊天记录前面 —— 背景先给，模型读起来顺序才对。
    const chatValue = !hasWorldInfo && worldBlock ? `${worldBlock}\n${history}` : history;
    const prompt = fillTemplate(preset, { chat: chatValue, char, user, count: String(SUGGEST_KINDS.length), worldinfo: worldBlock });
    // 预设里连 {{chat}} 也没写时，两段一起补在末尾，顺序同样是世界设定在前。
    const suffix = [
        !hasWorldInfo && !hasChat && worldBlock ? worldBlock.trimEnd() : '',
        !hasChat ? `【聊天记录】\n${history}` : '',
    ].filter(Boolean).join('\n\n');
    return { messages: [{ role: 'system', content: suffix ? `${prompt}\n\n${suffix}` : prompt }], count: floors.length, worldInfoLength: worldInfo.length };
}

export function buildExpandMessages(context, settings, input, worldInfo = '') {
    const text = String(input ?? '').trim();
    if (!text) throw new Error('先在面板里写一句想让模型扩写的内容。');
    const endIndex = eligibleMessages(context.chat).at(-1)?.index ?? -1;
    const { char, user } = names(context);
    const history = endIndex === -1 ? '' : buildHistory(context, settings, endIndex);
    const preset = settings.expandPreset || DEFAULT_EXPAND_PRESET;
    const worldBlock = worldInfo ? `【世界设定】\n${worldInfo}\n` : '';
    const hasWorldInfo = /\{\{\s*worldinfo\s*\}\}/.test(preset);
    const hasChat = /\{\{\s*chat\s*\}\}/.test(preset);
    const worldInChat = !hasWorldInfo && Boolean(worldBlock && history);
    const chatValue = worldInChat ? `${worldBlock}\n${history}` : history;
    const prompt = fillTemplate(preset, { input: text, chat: chatValue, char, user, worldinfo: worldBlock });
    // 世界书没能跟着 {{chat}} 进去时（没有聊天记录，或预设压根没写 {{chat}}）再补一段。
    const suffix = [
        !hasWorldInfo && worldBlock && !worldInChat ? worldBlock.trimEnd() : '',
        !hasChat && history ? `【聊天记录】\n${history}` : '',
    ].filter(Boolean).join('\n\n');
    return { messages: [{ role: 'system', content: suffix ? `${prompt}\n\n${suffix}` : prompt }], input: text, count: history ? history.split('\n').length : 0, worldInfoLength: worldInfo.length };
}

export function stripWrappers(text) {
    return String(text ?? '')
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/<(think|thinking|reasoning|analysis|scratchpad)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
        // 未闭合的思维块：从这里一直截到结尾
        .replace(/<(think|thinking|reasoning|analysis|scratchpad)\b[^>]*>[\s\S]*$/i, '')
        .replace(/^\s*(?:思考|分析|推理)\s*[:：][\s\S]*?(?=\n\s*\n|$)/, '')
        .trim();
}

export function stripFence(text) {
    const value = String(text ?? '').trim();
    // 围栏必须自带换行才算代码块，否则一行 ```NoUpdate``` 会被当成语言标签（生图插件踩过这个坑）。
    const match = value.match(/^```[A-Za-z0-9_+-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/);
    return match ? match[1].trim() : value;
}

// 取第一个「括号配平」的 JSON 数组：从第一个 [ 起算，跳过字符串内部与转义。
export function firstBalancedArray(text) {
    const source = String(text ?? '');
    const start = source.indexOf('[');
    if (start === -1) return null;
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < source.length; i++) {
        const char = source[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') { inString = true; continue; }
        if (char === '[') depth++;
        else if (char === ']') { depth--; if (depth === 0) return source.slice(start, i + 1); }
    }
    return null;
}

export function parseSuggestions(text, { max = 6, maxLength = 400 } = {}) {
    const clean = stripFence(stripWrappers(text));
    if (!clean) throw new Error('模型没有返回任何内容。');
    const items = [];
    const json = firstBalancedArray(clean);
    if (json) {
        let parsed;
        try { parsed = JSON.parse(json); } catch { parsed = null; }
        if (Array.isArray(parsed)) items.push(...parsed);
        else if (parsed && typeof parsed === 'object') {
            const nested = Object.values(parsed).find(value => Array.isArray(value));
            if (nested) items.push(...nested);
        }
    }
    if (!items.length) {
        // 兜底：模型没照格式走，就按行拆（去掉常见的项目符号和编号）。
        for (const line of clean.split(/\r?\n/)) {
            const value = line.replace(/^\s*(?:[-*•·]|\d+\s*[.、)])\s*/, '').trim();
            if (value) items.push(value);
        }
    }
    const seen = new Set();
    const result = [];
    for (const item of items) {
        const raw = typeof item === 'string'
            ? item
            : (item && typeof item === 'object' ? String(item.text ?? item.content ?? item.message ?? '') : '');
        const value = raw.replace(/\s+/g, ' ').trim();
        if (!value || value.length > maxLength) continue;
        if (seen.has(value)) continue;
        seen.add(value);
        result.push(value);
        if (result.length >= max) break;
    }
    if (!result.length) throw new Error('没能从模型的回复里解析出可用选项，换一个模型或点「重试」再试一次。');
    return result;
}

export function parseExpansion(text, { maxLength = 2000 } = {}) {
    const clean = stripFence(stripWrappers(text));
    if (!clean) throw new Error('模型没有返回可用的扩写内容。');
    if (clean.length > maxLength) throw new Error(`扩写结果过长（${clean.length} 字，上限 ${maxLength}），已丢弃以免把输入框撑爆。`);
    return clean;
}

export function extractText(body) {
    const message = body?.choices?.[0]?.message;
    if (!message) throw new Error('接口没有返回 choices[0].message，请确认模型名称与渠道支持对话补全。');
    const content = message.content;
    if (typeof content === 'string' && content.trim()) return content;
    if (Array.isArray(content)) {
        const joined = content.map(part => (typeof part === 'string' ? part : (part?.text ?? ''))).join('').trim();
        if (joined) return joined;
    }
    const reasoning = message.reasoning_content ?? message.reasoning;
    if (typeof reasoning === 'string' && reasoning.trim()) return reasoning;
    throw new Error('模型返回了空内容，可能是模型名不被该渠道支持，或本次回复被渠道拦截。');
}

export function previewMessages(messages) {
    return messages.map(message => `【${message.role}】\n${message.content}`).join('\n\n');
}

export { cleanMessage };
