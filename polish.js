// 正文润色：提示词、结果校验、以及「原版 / 润色版」两份文本的存取。
// 与 assistant.js 一样是纯逻辑层，不碰 DOM、不发请求；模型输出一律当不可信文本处理。
//
// 存储用「原版正文的哈希」做键，而不是楼层号：楼层会被删、被插、被 swipe 换掉，
// 文本哈希不会。两份文本成对保存，所以切回原版是逐字无损的，切 swipe 也不会串味。

import { cleanMessage, eligibleMessages } from './core.js';
import { fillTemplate, names, stripFence, stripWrappers } from './assistant.js';

export const DEFAULT_POLISH_PRESET = `你是一位中文小说编辑，正在改稿。下面这段文字是 AI 角色扮演里的一条回复，读起来有明显机器味：套话成灾、动作模板化、台词不像真人开口。

【要改写的正文】
{{text}}

你的任务：**保留大意，大尺度重写** —— 把八股表达和 AI 味清掉，把角色改成一个活人。句子结构、动作、台词、节奏都可以重新设计，不必跟着原文的句子走。

保留大意就是这些必须守住：
1. 信息量一致：谁做了什么、说了什么、发生了什么，结果是什么，都和原文一样。
2. 情节与逻辑不动：不新增事件、不改变顺序与结果，不给角色安排原文没有的动机或决定。
3. 人物关系、立场、态度与情绪方向不变；不因为尺度就删改、淡化成人向或暴力内容。
4. 语言、人称、称谓、时态不变；正文里的 {{...}} 形式的内容、HTML 标签、Markdown 标记原样保留。
5. 事实性细节不许换掉或写没：人名、地名、物件、数字、伤口、身体状态、时间地点。修辞性的修饰、比喻、副词可以随意删改。
6. 有几个角色说话就还是几个角色在说，不要互换、合并或新增说话人。

要清掉的 AI 味（重点打击对象）：
1. 套话模板：嘴角勾起一抹弧度、眼中闪过一丝复杂的神色、眼底划过、眸光、狡黠、戏谑、似笑非笑、意味深长、空气仿佛凝固、沉默片刻、呼吸一滞、心跳漏了一拍、双手不自觉地攥紧、指节泛白、指节捏得发白、青筋、喉结滚动、深吸一口气、挑了挑眉、无奈地 —— 这一整类放在哪一段都行的模板表达，换成只有这个场景才会有的具体动作，或者干脆删掉。
2. 副词、形容词与量词堆砌：「不禁」「缓缓地」「轻轻地」「微微」「深深」满篇铺，「一丝」「一抹」「一缕」「几分」见缝插针，只留最必要的。
3. 翻译腔与八股：整齐的三段式排比、一句一个比喻、每句都工整完整。把句长和节奏改得参差不齐，像人写的。
4. 反义对举句式：「不是 A，而是 B」「不是 A，是 B」「与其说 A，不如说 B」这类先否定再肯定的对举，整段里出现一次都嫌多 —— 直接说本来要说的那件事，不要先立个靶子再推翻。
5. 解释情绪而不是呈现：删掉「她有些担心」「他感到很愤怒」「气氛变得尴尬」，用动作、语气、句子的长短让人自己看出来。
6. 升华式结尾：不要在段尾总结、感慨、反问或点题，该停就停。
7. 助手式台词：真人说话短、口语、可以不完整、可以答非所问、可以打断自己、可以重复；把过长的说明性台词拆开，去掉客套、解释和总结对方话的习惯，加上停顿与语气词。角色的年龄、身份和当下情绪要能从说话方式里听出来，保留角色原有的口癖与说话习惯。

允许的手法：重新设计动作与台词、把旁白改成对白或动作、删掉多余的修饰与解释、调整语序与断句、长句拆短或碎句合并、换掉更贴合场景的具体细节。长度控制在原文的 60%–150%，不要为了凑字数堆描写。

只输出改写后的正文本身：不要标题、编号、说明、前后缀、代码围栏，也不要用引号把整段包起来。

{{worldinfo}}
【前文（只用来理解语境、人称与语气，不要改写这部分，也不要在输出里复述）】
{{chat}}`;

// 历史版本的出厂预设（用户没动过默认值时才自动升级）。
// 改动出厂预设时，务必把上一版逐字复制进来，否则那一版永远升不上来。
export const LEGACY_POLISH_PRESETS = Object.freeze([
    // 1.3.0 第二版：定位改成「改稿」，但黑名单还只有最早的几条
    `你是一位中文小说编辑，正在改稿。下面这段文字是 AI 角色扮演里的一条回复，读起来有明显机器味：套话成灾、动作模板化、台词不像真人开口。

【要改写的正文】
{{text}}

你的任务：**保留大意，大尺度重写** —— 把八股表达和 AI 味清掉，把角色改成一个活人。句子结构、动作、台词、节奏都可以重新设计，不必跟着原文的句子走。

保留大意就是这些必须守住：
1. 信息量一致：谁做了什么、说了什么、发生了什么，结果是什么，都和原文一样。
2. 情节与逻辑不动：不新增事件、不改变顺序与结果，不给角色安排原文没有的动机或决定。
3. 人物关系、立场、态度与情绪方向不变；不因为尺度就删改、淡化成人向或暴力内容。
4. 语言、人称、称谓、时态不变；正文里的 {{...}} 形式的内容、HTML 标签、Markdown 标记原样保留。
5. 事实性细节不许换掉或写没：人名、地名、物件、数字、伤口、身体状态、时间地点。修辞性的修饰、比喻、副词可以随意删改。
6. 有几个角色说话就还是几个角色在说，不要互换、合并或新增说话人。

要清掉的 AI 味（重点打击对象）：
1. 套话模板：嘴角勾起一抹弧度、眼中闪过一丝复杂的神色、空气仿佛凝固、沉默片刻、呼吸一滞、心跳漏了一拍、双手不自觉地攥紧、挑了挑眉、意味不明地笑了笑 —— 这一整类成句的模板表达，换成只有这个场景才会有的具体动作，或者干脆删掉。
2. 副词形容词堆砌：「不禁」「缓缓地」「轻轻地」「微微」「深深」满篇铺，只留最必要的。
3. 翻译腔与八股：整齐的三段式排比、一句一个比喻、每句都工整完整。把句长和节奏改得参差不齐，像人写的。
4. 解释情绪而不是呈现：删掉「她有些担心」「他感到很愤怒」「气氛变得尴尬」，用动作、语气、句子的长短让人自己看出来。
5. 升华式结尾：不要在段尾总结、感慨、反问或点题，该停就停。
6. 助手式台词：真人说话短、口语、可以不完整、可以答非所问、可以打断自己、可以重复；把过长的说明性台词拆开，去掉客套、解释和总结对方话的习惯，加上停顿与语气词。角色的年龄、身份和当下情绪要能从说话方式里听出来，保留角色原有的口癖与说话习惯。

允许的手法：重新设计动作与台词、把旁白改成对白或动作、删掉多余的修饰与解释、调整语序与断句、长句拆短或碎句合并、换掉更贴合场景的具体细节。长度控制在原文的 60%–150%，不要为了凑字数堆描写。

只输出改写后的正文本身：不要标题、编号、说明、前后缀、代码围栏，也不要用引号把整段包起来。

{{worldinfo}}
【前文（只用来理解语境、人称与语气，不要改写这部分，也不要在输出里复述）】
{{chat}}`,
    // 1.3.0 首版：只做文字层面的润色，不许改动内容
    `你是一位中文小说编辑，正在替一段角色扮演对话润色其中一条回复。

【要润色的正文】
{{text}}

要求：
1. 只改文字，不改内容：人物、动作、对白、情节、信息量与说话人的立场必须原样保留，不许增加或删掉任何事实，也不许替任何人补充新的行动或对白。
2. 提升用词、句式、节奏与感官细节的呈现，让文字更顺、更有画面感；把重复啰嗦、翻译腔、口水话改掉。
3. 长度控制在原文的 70%–140% 之间，不要为了凑字数加形容词堆砌。
4. 语言、称呼、人称、时态与语气强度全部维持原样。成人向、暴力或阴暗的内容照原样保留，不要因为尺度而删改、淡化或回避。
5. 正文里若出现 {{...}} 形式的内容、HTML 标签或 Markdown 标记，原样保留，不要翻译、不要转义。
6. 只输出润色后的正文本身：不要标题、编号、说明、前后缀、代码围栏，也不要用引号把整段包起来。

{{worldinfo}}
【前文（只用来理解语境、人称与语气，不要润色这部分，也不要在输出里复述）】
{{chat}}`,
]);

function normalizePreset(value) {
    return String(value ?? '').replace(/\r\n/g, '\n').trim();
}

// 与 assistant.js 的 migratePresets 同一套规则：留着的若是某一版出厂预设就升级，
// 用户自己改过的一个字都不动。
export function migratePolishPreset(settings) {
    const current = String(settings?.polishPreset ?? '');
    if (!current) return DEFAULT_POLISH_PRESET;
    return LEGACY_POLISH_PRESETS.some(old => normalizePreset(old) === normalizePreset(current)) ? DEFAULT_POLISH_PRESET : current;
}

// 结果是否自动写回正文的判定阈值。
export const POLISH_TEXT_LIMITS = Object.freeze({ minRatio: 0.5, maxRatio: 2, maxChars: 20000 });
// 每个聊天的润色记录上限，避免聊天文件第一行的 metadata 无限膨胀。
export const POLISH_STORE_LIMITS = Object.freeze({ maxRecords: 200, maxChars: 300000, maxChats: 3 });

// FNV-1a 32 位。只用来当「同一段正文」的键，不做安全用途；碰撞时下面还会逐字比对。
export function hashText(text) {
    let hash = 0x811c9dc5;
    const value = String(text ?? '');
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

export function polishModelFor(settings) {
    return String(settings?.polishModel ?? '').trim() || String(settings?.model ?? '').trim();
}

// ---- 模型输出的清洗 ----
// 常见的「润色后：」前言、代码围栏、思维块都要剥掉；剥完还不像正文就直接判失败。
const REPLY_LABEL = /^\s*(?:润色(?:后|版)?|修改(?:后|版)?|修订(?:后|版)?|重写(?:后|版)?|polished|revised)\s*[:：]\s*/i;
const REFUSAL = /^(?:很抱歉|抱歉|对不起|我无法|我不能|无法完成|无法满足|作为(?:一个)?(?:AI|人工智能|语言模型|助手)|我注意到|I(?:'m| am) sorry)/i;

export function parsePolished(text) {
    const clean = stripFence(stripWrappers(text));
    if (!clean) throw new Error('模型没有返回任何内容。');
    const body = clean.replace(REPLY_LABEL, '').trim();
    if (!body) throw new Error('模型只返回了标题或说明，没有正文。');
    if (REFUSAL.test(body.slice(0, 40))) throw new Error('模型拒绝了这次润色（返回的是拒绝说明）。换一个模型再试。');
    return body;
}

// ---- 宏与 HTML 标签必须原样保留 ----
// 原版里有的 {{宏}} 和 HTML 标签，结果里少一个就说明模型顺手删了东西，交回人工确认。
const MACRO_TOKEN = /\{\{\s*[^{}]*?\s*\}\}/g;
const TAG_TOKEN = /<\/?\s*([A-Za-z][\w-]*)[^>]*>/g;
const IGNORED_TAGS = new Set(['br', 'hr']);

export function markupProfile(text) {
    const value = String(text ?? '');
    const macros = (value.match(MACRO_TOKEN) ?? []).map(token => `宏 ${token.replace(/[{}]/g, '').trim()}`);
    const tags = [];
    for (const match of value.matchAll(TAG_TOKEN)) {
        const name = String(match[1]).toLowerCase();
        if (IGNORED_TAGS.has(name)) continue;
        tags.push(`标签 ${match[0].startsWith('</') ? '/' : ''}${name}`);
    }
    return [...macros, ...tags];
}

function countTokens(list) {
    const map = new Map();
    for (const item of list) map.set(item, (map.get(item) ?? 0) + 1);
    return map;
}

export function missingMarkup(original, polished) {
    const need = countTokens(markupProfile(original));
    for (const item of markupProfile(polished)) {
        const left = need.get(item);
        if (left) need.set(item, left - 1);
    }
    return [...need.entries()].filter(([, left]) => left > 0).map(([item]) => item);
}

// 应用前的最后一道闸：只有通过的才自动写回正文，没通过的交给面板让人自己看。
export function planPolishApplication({ original = '', polished = '', limits = POLISH_TEXT_LIMITS } = {}) {
    const raw = String(polished ?? '');
    const before = String(original).trim();
    const after = raw.trim();
    const size = text => String(text ?? '').replace(/\s/g, '').length;
    if (!raw) return { apply: false, text: '', reason: '模型没有返回正文' };
    if (!size(after)) return { apply: false, text: '', reason: '模型只返回了空白' };
    if (after === before) return { apply: false, text: after, reason: '和原文一模一样，模型没有改动任何文字' };
    if (after.length > limits.maxChars) return { apply: false, text: after, reason: `结果太长（${after.length} 字，上限 ${limits.maxChars}）` };
    const ratio = after.length / Math.max(1, before.length);
    if (ratio < limits.minRatio) return { apply: false, text: after, reason: `结果只有原文的 ${Math.round(ratio * 100)}%，像是被截断或被审核掉了` };
    if (ratio > limits.maxRatio) return { apply: false, text: after, reason: `结果是原文的 ${Math.round(ratio * 100)}%，涨得太多，可能加进了原文没有的内容` };
    const missing = missingMarkup(before, after);
    if (missing.length) return { apply: false, text: after, reason: `结果里少了原文有的：${missing.join('、')}` };
    return { apply: true, text: after, reason: '' };
}

// ---- 复用酒馆自己的正则管线 ----
// 预设里那些「只改发送 / 只改显示」的正则住在 scripts/extensions/regex/engine.js 里，
// 酒馆拼提示词时调的就是它：getRegexedString(mes, AI_OUTPUT, { isPrompt: true, depth })。
// 直接用同一套，拿到的是真正发给模型的那份文本，比自己猜块名可靠得多；
// 拿不到（旧版本、扩展被禁用）就退回下面的内置名单。
let engine = null;
let engineLoaded = false;

export async function loadRegexEngine() {
    if (engineLoaded) return engine;
    engineLoaded = true;
    try {
        const mod = await import('../../regex/engine.js');
        if (typeof mod?.getRegexedString === 'function' && mod?.regex_placement) {
            engine = {
                get: mod.getRegexedString,
                scriptList: typeof mod.getRegexScripts === 'function' ? mod.getRegexScripts : null,
                placement: mod.regex_placement,
            };
        }
    } catch {
        engine = null;
    }
    return engine;
}

export function regexEngine() {
    return engine;
}

// 真正发给模型的那份文本（和 script.js 里拼 coreChat 的调法一致）。depth 是离末尾的层数。
export function cleanForPromptWith(active, raw, depth = 0) {
    const value = String(raw ?? '');
    if (!active) return value;
    try {
        return String(active.get(value, active.placement.AI_OUTPUT, { isPrompt: true, depth }));
    } catch {
        return value;
    }
}

// 被「只改发送」的正则删掉的那些区间：它们在原文里要原位保留 —— 既不该送去改写
// （模型根本没看到），替换时更不能丢（比如 <UpdateVariable> 这类要交给别的扩展解析的块）。
export function regexPreservedRangesWith(active, raw) {
    const text = String(raw ?? '');
    if (!active?.scriptList || !text) return [];
    let scripts;
    try { scripts = active.scriptList() ?? []; } catch { return []; }
    const ranges = [];
    for (const script of Array.isArray(scripts) ? scripts : []) {
        if (!script || script.disabled || !script.findRegex) continue;
        const placement = Array.isArray(script.placement) ? script.placement : [];
        if (!placement.includes(active.placement.AI_OUTPUT)) continue;
        if (script.markdownOnly && !script.promptOnly) continue;   // 只改显示的不影响发送
        if (String(script.replaceString ?? '')) continue;          // 有替换内容的不算纯删除
        const source = String(script.findRegex);
        const body = source.startsWith('/') ? source.slice(1, source.lastIndexOf('/')) : source;
        const flags = source.startsWith('/') ? source.slice(source.lastIndexOf('/') + 1) : '';
        let matcher;
        try { matcher = new RegExp(body, flags.includes('g') ? flags : `${flags}g`); } catch { continue; }
        let match;
        while ((match = matcher.exec(text))) {
            if (!match[0]) { matcher.lastIndex += 1; continue; }
            ranges.push({ start: match.index, end: match.index + match[0].length });
        }
    }
    return ranges;
}

export function cleanForPrompt(raw, depth = 0) {
    return cleanForPromptWith(engine, raw, depth);
}

export function regexPreservedRanges(raw) {
    return regexPreservedRangesWith(engine, raw);
}

// ---- 从原始楼层文本里切出「正文」----
// 有些预设会把思维链、变量更新、状态面板、选项列表直接写进 mes。这些东西：
//   1. 不该发给改写模型（模型会去改思维链，也会被面板数据带偏）；
//   2. 不该出现在「原版 / 润色版」对照里；
//   3. 更不能在替换时被丢掉 —— 它们原位保留，一个字都不动。
// 所以切分规则是：块级剔除（连内容）+ 只改文本节点（标签原位留着），最后按区间拼回。
const NON_PROSE_PATTERNS = [
    'think*', '*thinking*', '*reasoning*', 'analysis', '*analysis*', 'scratchpad', '*_cot', '*cot*',
    'update*', '*variable*', 'var', 'setvar', 'json*patch*', 'patch',
    '*status*', '*state*', '*panel*', '*stat', '*状态*', '*面板*', '*进度*',
    '*memory*', '*summary*', '*reminder*', '*instruction*', '*rule*', 'system*', '*meta*', '*debug*',
    'option*', '*option*', '*choice*',
    'image*', 'pic', 'img', '*prompt*',
];
// 标签名允许中文：角色卡里常见 <人渣>这种中文标签（酒馆渲染时也当作标签，不显示）。
const TAG_SCAN = /<(\/?)([A-Za-z\u4e00-\u9fff][\w\u4e00-\u9fff-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
const TAG_NAME = /^<\/?([A-Za-z\u4e00-\u9fff][\w\u4e00-\u9fff-]*)/;
const IMAGE_SCAN = /!\[[^\]]*\]\([^)\s]+(?:\s+"[^"]*")?\)|data:image\/[^;\s]+;base64,[A-Za-z0-9+/=]+/g;
// 名字不在剔除名单里、但内容明显不是正文的块（文件名、JSON、[键|值] 数据行）也当数据剔掉。
// 这条是为了 <人渣>宅男.png</人渣> 这类卡片占位：里面的文件名不该被当成正文改写掉。
const DATA_SHAPES = [
    /^\s*[^\s<>]{1,80}\.(?:png|jpe?g|webp|gif|bmp|svg|mp4|webm|mp3|wav|ogg|json|txt)\s*$/i,
    /^\s*[[{][\s\S]{0,2000}[\]}]\s*$/,
    /^(?:\s*\[[^\]\n]{1,40}\]\s*){2,}$/,
];
function looksLikeData(value) {
    const text = String(value ?? '').trim();
    return Boolean(text) && DATA_SHAPES.some(pattern => pattern.test(text));
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 内置名单 + 用户在面板里补的块名（逗号/空格分隔，支持 * 通配），编译成一个谓词。
// builtin = false 时只用用户补的名字（面板上可以「只按酒馆的正则脚本处理」）。
export function blockMatcher(extra = '', builtin = true) {
    const listed = builtin ? NON_PROSE_PATTERNS : [];
    const patterns = [...listed, ...String(extra ?? '').split(/[\s,，、;；]+/)]
        .map(pattern => String(pattern).trim())
        .filter(Boolean)
        .map(pattern => pattern.split('*').map(escapeRegExp).join('[\\w-]*'));
    if (!patterns.length) return () => false;
    const matcher = new RegExp(`^(?:${patterns.join('|')})$`, 'i');
    return name => matcher.test(String(name ?? ''));
}

// 要整块丢掉的区间（含标签本身）：名单里的成对块、自闭合占位、内容像数据的块、
// 未闭合的名单块（一直到结尾）、图片与 base64。
function droppedRanges(text, isBlock) {
    const ranges = [];
    const stack = [];
    TAG_SCAN.lastIndex = 0;
    let match;
    while ((match = TAG_SCAN.exec(text))) {
        const [full, closing, name] = match;
        const lower = name.toLowerCase();
        if (!closing) {
            if (match[4] === '/') {                 // 自闭合
                if (isBlock(lower)) ranges.push({ start: match.index, end: match.index + full.length });
                continue;
            }
            stack.push({ name: lower, start: match.index, openEnd: match.index + full.length });
            continue;
        }
        const at = stack.findIndex(item => item.name === lower);
        if (at === -1) continue;
        const opened = stack[at];
        stack.length = at;                          // 一起收掉里面没闭合的
        if (isBlock(lower) || looksLikeData(text.slice(opened.openEnd, match.index))) {
            ranges.push({ start: opened.start, end: match.index + full.length });
        }
    }
    // 未闭合的剔除块：从它开始丢到结尾（和酒馆剥 think 块的做法一致）。
    for (const item of stack) if (isBlock(item.name)) ranges.push({ start: item.start, end: text.length });
    IMAGE_SCAN.lastIndex = 0;
    while ((match = IMAGE_SCAN.exec(text))) ranges.push({ start: match.index, end: match.index + match[0].length });
    return ranges.sort((a, b) => a.start - b.start);
}

// 一段没有剔除块的内容里，把所有标签拿掉，剩下的就是文本节点（`<br>` 算一个换行）。
function textNodes(chunk, offset) {
    const nodes = [];
    const tags = new RegExp(TAG_SCAN.source, 'g');
    let last = 0;
    let match;
    while ((match = tags.exec(chunk))) {
        if (match.index > last) nodes.push({ start: offset + last, end: offset + match.index, text: chunk.slice(last, match.index) });
        last = match.index + match[0].length;
        if (/^<br\s*\/?>$/i.test(match[0])) nodes.push({ start: offset + last, end: offset + last, text: '\n' });
    }
    if (last < chunk.length) nodes.push({ start: offset + last, end: offset + chunk.length, text: chunk.slice(last) });
    return nodes;
}

// 区间按位置合并（重叠的并成一条），剔除块与正则删掉的区间会合到一起用。
function mergeRanges(ranges) {
    const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
    const out = [];
    for (const range of sorted) {
        const last = out[out.length - 1];
        if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
        else out.push({ start: range.start, end: range.end });
    }
    return out;
}

// 切出正文：`clean`（可选）是已经过正则管线的文本，只用来取正文内容；
// `preserved`（可选）是要在原文里原位保留的区间（正则删掉的那些）。两者基准不同，别混用。
export function splitProse(raw, extra = '', preserved = [], builtin = true) {
    const text = String(raw ?? '');
    const ranges = mergeRanges([...droppedRanges(text, blockMatcher(extra, builtin)), ...(Array.isArray(preserved) ? preserved : [])]);
    const dropped = [];
    if (preserved.length) dropped.push('正则剔除');
    for (const range of ranges) {
        const name = (text.slice(range.start).match(TAG_NAME) ?? [])[1];
        if (name) dropped.push(name.toLowerCase());
        if (/^data:image\//.test(text.slice(range.start))) dropped.push('base64');
        if (/^!\[/.test(text.slice(range.start))) dropped.push('markdown 图片');
    }
    const nodes = [];
    let cursor = 0;
    for (const range of ranges) {
        if (range.start > cursor) nodes.push(...textNodes(text.slice(cursor, range.start), cursor));
        cursor = Math.max(cursor, range.end);
    }
    if (cursor < text.length) nodes.push(...textNodes(text.slice(cursor), cursor));
    // 首尾空白不参与改写：把第一个/最后一个文本节点收一收。
    while (nodes.length && !nodes[0].text.trim()) nodes.shift();
    while (nodes.length && !nodes[nodes.length - 1].text.trim()) nodes.pop();
    if (nodes.length) {
        const first = nodes[0], last = nodes[nodes.length - 1];
        const lead = first.text.length - first.text.replace(/^\s+/, '').length;
        first.start += lead;
        first.text = first.text.slice(lead);
        if (first === last) {
            const tail = first.text.length - first.text.replace(/\s+$/, '').length;
            first.end -= tail;
            first.text = first.text.slice(0, first.text.length - tail);
        } else {
            last.end -= last.text.length - last.text.replace(/\s+$/, '').length;
            last.text = last.text.replace(/\s+$/, '');
        }
    }
    return { prose: nodes.map(node => node.text).join(''), nodes, dropped: [...new Set(dropped)] };
}

// 把改写后的正文拼回原始楼层文本：正文写在第一个文本节点的位置，其余文本节点删掉，
// 中间的标签与剔除块（思维链、面板、图片）全部原位保留。
export function composePolished(raw, split, rewritten) {
    const text = String(raw ?? '');
    const nodes = split?.nodes ?? [];
    const body = String(rewritten ?? '').trim();
    if (!nodes.length || !body) return '';
    let out = text.slice(0, nodes[0].start) + body;
    for (let i = 0; i < nodes.length - 1; i++) out += text.slice(nodes[i].end, nodes[i + 1].start);
    return out + text.slice(nodes[nodes.length - 1].end);
}

// ---- 记录的存取 ----
export function validRecord(value) {
    return Boolean(value) && typeof value === 'object'
        && typeof value.original === 'string' && value.original.length > 0
        && typeof value.polished === 'string' && value.polished.length > 0
        && value.key === hashText(value.original);
}

export function readRecords(stored) {
    const list = Array.isArray(stored?.records) ? stored.records : (Array.isArray(stored) ? stored : []);
    return list.filter(validRecord);
}

// 两边都要认：正文可能正显示原版，也可能正显示润色版，切换状态全靠这个查找。
export function findRecord(records, text) {
    const value = String(text ?? '');
    if (!value) return null;
    return (Array.isArray(records) ? records : [])
        .find(record => validRecord(record) && (record.original === value || record.polished === value)) ?? null;
}

export function upsertRecord(records, { original, polished, model = '', at = Date.now() } = {}, limits = POLISH_STORE_LIMITS) {
    const value = {
        key: hashText(String(original)),
        original: String(original),
        polished: String(polished),
        model: String(model ?? ''),
        at: Number(at) || 0,
    };
    const next = [value, ...(Array.isArray(records) ? records : []).filter(record => record?.key !== value.key)];
    const kept = [];
    let chars = 0;
    for (const record of next) {
        if (kept.length >= limits.maxRecords) break;
        const size = (record.original?.length ?? 0) + (record.polished?.length ?? 0);
        // 至少留一条：单条超预算时不能被裁成空。
        if (kept.length > 0 && chars + size > limits.maxChars) break;
        chars += size;
        kept.push(record);
    }
    return kept;
}

export function removeRecord(records, key) {
    return (Array.isArray(records) ? records : []).filter(record => record?.key !== key);
}

// 手改后的正文既不是原版也不是润色版时，按「改之前显示的是哪一版」把它接过去：
// 改的是润色版就更新润色版，改的是原版就更新原版。改之前是哪一版判断不出来时，
// 记录保持不动（正文和记录暂时对不上，按钮会显示成「手改过」），两份文本都不会丢。
export function adoptEdited(records, { key, text, side, model = '' } = {}) {
    const record = (Array.isArray(records) ? records : []).find(item => item?.key === key);
    if (!record) return records;
    const value = String(text ?? '');
    if (!value.trim() || value === record.original || value === record.polished) return records;
    const owner = record.model || model;
    if (side === 'polished') return upsertRecord(records, { original: record.original, polished: value, model: owner });
    if (side === 'original') return upsertRecord(removeRecord(records, key), { original: value, polished: record.polished, model: owner });
    return records;
}

// 当前显示的是哪一版：状态从正文本身推导，不做单独的开关字段，就不会有对不上的时候。
export function polishViewFor(record, currentText) {
    if (!record) return null;
    const value = String(currentText ?? '');
    if (value === record.polished) return 'polished';
    if (value === record.original) return 'original';
    return 'edited';
}

// ---- 分支聊天的本地镜像 ----
// 酒馆的 createBranch / createNewBookmark 只带 main_chat 过去，父聊天的 chat_metadata 不会跟过来，
// 所以在扩展设置里按聊天 ID 留一份镜像，用来支持「从主聊天继承」。
export function readArchive(stored) {
    // 写进去时挂在 polishArchive 上（和扩展设置同一个对象）；兼容早期可能用过的 archive 字段。
    const source = stored?.polishArchive ?? stored?.archive;
    if (!source || typeof source !== 'object') return {};
    const out = {};
    for (const [chatId, entry] of Object.entries(source)) {
        const records = readRecords(entry);
        if (records.length) out[chatId] = { records, at: Number(entry?.at) || 0 };
    }
    return out;
}

export function writeArchive(archive, chatId, records, { maxChats = 3 } = POLISH_STORE_LIMITS) {
    const id = String(chatId ?? '').trim();
    if (!id) return archive ?? {};
    // 用「插入顺序就是新旧顺序」来裁剪：每次写入都把这条移到末尾，从头丢最旧的，
    // 不依赖时间戳（同一毫秒连着写两次时，按时间戳排序的结果是不确定的）。
    const entries = Object.entries(archive ?? {}).filter(([key]) => key !== id);
    entries.push([id, { records, at: Date.now() }]);
    return Object.fromEntries(entries.slice(-Math.max(1, maxChats)));
}

// main_chat 存的是父聊天的名字（不带 .jsonl），镜像的键是聊天 ID，所以要按去扩展名比对。
export function inheritRecords(archive, mainChat) {
    const wanted = String(mainChat ?? '').trim();
    if (!wanted) return [];
    for (const [chatId, entry] of Object.entries(archive ?? {})) {
        if (chatId.replace(/\.jsonl$/i, '').trim() === wanted) return entry?.records ?? [];
    }
    return [];
}

// ---- 提示词 ----
export function lastAssistantIndex(chat) {
    const rows = eligibleMessages(Array.isArray(chat) ? chat : []);
    for (let i = rows.length - 1; i >= 0; i--) {
        if (!rows[i].message.is_user) return rows[i].index;
    }
    return -1;
}

export function buildPolishMessages(context, settings, index, worldInfo = '') {
    const rows = Array.isArray(context?.chat) ? context.chat : [];
    const target = rows[index];
    if (!target) throw new Error('这一层已经不在了，可能刚被删除或换了 swipe。');
    const raw = String(target.mes ?? '');
    // 正文以「真正发给模型的那份」为准：先过酒馆自己的正则管线（预设的只改发送/只改显示规则），
    // 再让内置名单兜底（预设没写正则的块，比如 <thinking> 也在这里被剔掉）。
    const depth = Math.max(0, rows.length - 1 - index);
    const builtin = settings?.polishBuiltinStrip !== false;
    const original = splitProse(cleanForPrompt(raw, depth), settings?.polishStrip, [], builtin).prose;
    // 拼回时用原文的切分：正则删掉的区间 + 内置名单认出的块都原位保留。
    const split = splitProse(raw, settings?.polishStrip, regexPreservedRanges(raw), builtin);
    if (!original.trim()) {
        throw new Error(split.dropped.length
            ? `这一层只剩思维链/面板内容（${split.dropped.slice(0, 4).join('、')}），没有可改写的正文。`
            : '这一层没有正文可以润色。');
    }
    const { char, user } = names(context);
    const floors = Number(settings?.polishContext);
    const before = Number.isFinite(floors) && floors > 0 ? eligibleMessages(rows, index - 1).slice(-floors) : [];
    const history = before.map(row => `${row.message.name || (row.message.is_user ? user : char)}：${row.text}`).join('\n');
    const preset = settings?.polishPreset || DEFAULT_POLISH_PRESET;
    const worldBlock = worldInfo ? `【世界设定】\n${worldInfo}\n` : '';
    const hasWorldInfo = /\{\{\s*worldinfo\s*\}\}/.test(preset);
    const hasChat = /\{\{\s*chat\s*\}\}/.test(preset);
    const hasText = /\{\{\s*text\s*\}\}/.test(preset);
    const worldInChat = !hasWorldInfo && Boolean(worldBlock && history);
    const chatValue = worldInChat ? `${worldBlock}\n${history}` : history;
    const prompt = fillTemplate(preset, { text: original, chat: chatValue, char, user, worldinfo: worldBlock });
    // 预设里没写的段落补在末尾，顺序固定：世界设定 → 前文 → 正文。
    const suffix = [
        !hasWorldInfo && worldBlock && !worldInChat ? worldBlock.trimEnd() : '',
        !hasChat && history ? `【前文】\n${history}` : '',
        !hasText ? `【要润色的正文】\n${original}` : '',
    ].filter(Boolean).join('\n\n');
    return {
        messages: [{ role: 'system', content: suffix ? `${prompt}\n\n${suffix}` : prompt }],
        index, original: raw, prose: original, split, count: before.length, worldInfoLength: worldInfo.length,
    };
}

// ---- 自动润色的守卫 ----
export function planAutoPolish(settings, { chat = [], running = false, stopped = false, records = [], tried = null } = {}) {
    if (!settings?.polishAuto) return { run: false, reason: '自动润色未开启' };
    if (running) return { run: false, reason: '已有请求正在进行' };
    if (stopped) return { run: false, reason: '本次回复已被用户停止' };
    const row = eligibleMessages(Array.isArray(chat) ? chat : []).at(-1);
    if (!row) return { run: false, reason: '没有可用的聊天楼层' };
    if (row.message.is_user) return { run: false, reason: '最新楼层是用户自己的消息' };
    const original = String(row.message.mes ?? '');
    if (!original.trim()) return { run: false, reason: '这一层没有正文' };
    // 只剩思维链/面板的楼层没有可改写的正文，别白花一次请求。
    if (!splitProse(cleanForPrompt(original), settings?.polishStrip, [], settings?.polishBuiltinStrip !== false).prose.trim()) return { run: false, reason: '这一层只有思维链或面板内容' };
    if (findRecord(records, original)) return { run: false, reason: '这一层已经润色过' };
    if (tried?.has?.(hashText(original))) return { run: false, reason: '这一层这一版刚试过，不再自动重试' };
    return { run: true, index: row.index, original };
}

export { cleanMessage };
