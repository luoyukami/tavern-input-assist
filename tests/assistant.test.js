import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_EXPAND_PRESET, DEFAULT_SUGGEST_PRESET, LEGACY_SUGGEST_PRESETS, SUGGEST_KINDS, SUGGEST_LABELS, buildExpandMessages, buildSuggestMessages, buildWorldInfoBlock, extractText, fillTemplate, firstBalancedArray, migratePresets, names, parseExpansion, parseSuggestions, stripFence, stripWrappers, suggestKind, worldInfoScanChat } from '../assistant.js';
import { DEFAULTS } from '../core.js';

const settings = { ...DEFAULTS, model: 'm', recentCount: 3 };
const context = {
    name1: '旅行者', name2: '莉娅',
    characters: [{ name: '莉娅', avatar: 'lia.png' }],
    characterId: 0,
    chat: [
        { name: '莉娅', mes: '雨水沿着玻璃窗滑落。' },
        { name: '旅行者', mes: '“今晚还有空房吗？”', is_user: true },
        { name: '莉娅', mes: '“当然。”她把蜂蜜酒推过来。' },
    ],
};

test('fillTemplate 只替换认识的占位符', () => {
    assert.equal(fillTemplate('{{char}} 对 {{user}} 说 {{unknown}}', { char: 'A', user: 'B' }), 'A 对 B 说 {{unknown}}');
    assert.equal(fillTemplate('{{ count }}', { count: 4 }), '4');
});

test('buildSuggestMessages 把聊天记录和条数填进预设', () => {
    const { messages, count } = buildSuggestMessages(context, { ...settings, suggestCount: 3 }, 2);
    assert.equal(count, 3);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, 'system');
    assert.ok(messages[0].content.includes('旅行者：“今晚还有空房吗？”'));
    assert.ok(messages[0].content.includes('6 个接下来可以发送的消息'));
    assert.ok(!messages[0].content.includes('{{'));
});

test('buildSuggestMessages 在预设丢了 {{chat}} 时自动补上聊天记录', () => {
    const { messages } = buildSuggestMessages(context, { ...settings, suggestPreset: '只按用户要求生成。' }, 2);
    assert.ok(messages[0].content.includes('【聊天记录】'));
    assert.ok(messages[0].content.includes('旅行者：'));
});

test('buildSuggestMessages 尊重上下文层数设置', () => {
    const { messages } = buildSuggestMessages(context, { ...settings, recentCount: 1 }, 2);
    assert.ok(!messages[0].content.includes('今晚还有空房吗'));
});

test('buildSuggestMessages 在没有内容时明确报错', () => {
    assert.throws(() => buildSuggestMessages({ ...context, chat: [] }, settings, -1), /还没有可用内容/);
});

test('buildExpandMessages 带上用户那句与上下文，空输入报错', () => {
    const { messages, input } = buildExpandMessages(context, settings, '我犹豫了一下，还是问了她的名字');
    assert.equal(input, '我犹豫了一下，还是问了她的名字');
    assert.ok(messages[0].content.includes('我犹豫了一下，还是问了她的名字'));
    assert.ok(messages[0].content.includes('【聊天记录】'));
    assert.throws(() => buildExpandMessages(context, settings, '   '), /写一句/);
});

test('stripWrappers 去掉思维块', () => {
    assert.equal(stripWrappers('<think>推理一堆</think>["a"]'), '["a"]');
    assert.equal(stripWrappers('["a"]<thinking>没闭合的推理'), '["a"]');
    assert.equal(stripWrappers('<script>var a=1</script>["a"]'), '["a"]');
});

test('stripFence 只剥真正的代码围栏', () => {
    assert.equal(stripFence('```json\n["a","b"]\n```'), '["a","b"]');
    assert.equal(stripFence('```\n["a"]\n```'), '["a"]');
    // 一行内的 ```NoUpdate``` 不是代码块，不能被当成语言标签剥掉
    assert.equal(stripFence('```NoUpdate```'), '```NoUpdate```');
    assert.equal(stripFence('["a"]'), '["a"]');
});

test('firstBalancedArray 处理字符串里的括号与转义引号', () => {
    assert.equal(firstBalancedArray('前缀 [ "a]b" , "c" ] 后缀'), '[ "a]b" , "c" ]');
    assert.equal(firstBalancedArray('["a\\"]b"]'), '["a\\"]b"]');
    assert.equal(firstBalancedArray('没有数组'), null);
    assert.equal(firstBalancedArray('[1, [2, 3]] 末'), '[1, [2, 3]]');
});

test('parseSuggestions 吃下模型的各种输出形态', () => {
    assert.deepEqual(parseSuggestions('["我推开门。", "我站在原地。"]'), ['我推开门。', '我站在原地。']);
    assert.deepEqual(parseSuggestions('```json\n["甲", "乙"]\n```'), ['甲', '乙']);
    assert.deepEqual(parseSuggestions('好的，这是几个方向：\n["甲", "乙"]\n希望有用。'), ['甲', '乙']);
    assert.deepEqual(parseSuggestions('{"options": ["甲", "乙"]}'), ['甲', '乙']);
    assert.deepEqual(parseSuggestions('1. 甲\n2. 乙'), ['甲', '乙']);
    assert.deepEqual(parseSuggestions('- 甲\n- 乙'), ['甲', '乙']);
    assert.deepEqual(parseSuggestions('<think>x</think>["甲"]'), ['甲']);
});

test('parseSuggestions 去重、限长、限数', () => {
    assert.deepEqual(parseSuggestions('["甲", "甲", "乙"]'), ['甲', '乙']);
    assert.deepEqual(parseSuggestions(`["${'长'.repeat(500)}", "乙"]`), ['乙']);
    assert.deepEqual(parseSuggestions('["a","b","c","d"]', { max: 2 }), ['a', 'b']);
    assert.deepEqual(parseSuggestions('["  多个   空格  归一  "]'), ['多个 空格 归一']);
});

test('parseSuggestions 在完全无法解析时抛错而不是给出垃圾数据', () => {
    assert.throws(() => parseSuggestions(''), /没有返回任何内容/);
    assert.throws(() => parseSuggestions('[{"a": 1}, {"b": 2}]'), /没能从模型的回复里解析出可用选项/);
});

test('parseExpansion 剥壳、限长', () => {
    assert.equal(parseExpansion('```\n她说：你好。\n```'), '她说：你好。');
    assert.equal(parseExpansion('<think>x</think>她说：你好。'), '她说：你好。');
    assert.throws(() => parseExpansion('   '), /没有返回可用的扩写内容/);
    assert.throws(() => parseExpansion('长'.repeat(2001)), /过长/);
});

test('extractText 兼容字符串、分段数组与推理回退', () => {
    assert.equal(extractText({ choices: [{ message: { content: '甲' } }] }), '甲');
    assert.equal(extractText({ choices: [{ message: { content: [{ text: '甲' }, { text: '乙' }] } }] }), '甲乙');
    assert.equal(extractText({ choices: [{ message: { content: '', reasoning_content: '推理内容' } }] }), '推理内容');
    assert.throws(() => extractText({}), /choices\[0\]\.message/);
    assert.throws(() => extractText({ choices: [{ message: { content: '  ' } }] }), /空内容/);
});

test('默认预设写死了六个位置的职责', () => {
    // 契约测试：以后改预设时不能把 {{chat}} 或六个角色的分工弄丢。
    assert.ok(DEFAULT_SUGGEST_PRESET.includes('{{chat}}'));
    assert.ok(DEFAULT_SUGGEST_PRESET.includes('{{user}}'));
    // {{char}} 取的是 name2 / 角色卡上的名字，未必是剧情里的称呼，所以默认预设刻意不引用它
    assert.ok(!DEFAULT_SUGGEST_PRESET.includes('{{char}}'));
    assert.ok(!DEFAULT_EXPAND_PRESET.includes('{{char}}'));
    assert.match(DEFAULT_SUGGEST_PRESET, /第 1–3 条 · 正常分支/);
    assert.match(DEFAULT_SUGGEST_PRESET, /第 4 条 · 新奇/);
    assert.match(DEFAULT_SUGGEST_PRESET, /第 5 条 · 邪恶/);
    assert.match(DEFAULT_SUGGEST_PRESET, /第 6 条 · 跳跃/);
    assert.match(DEFAULT_SUGGEST_PRESET, /正好 6 个元素/);
    assert.ok(DEFAULT_EXPAND_PRESET.includes('{{input}}'));
    assert.ok(DEFAULT_EXPAND_PRESET.includes('{{chat}}'));
});

test('六个位置的角色表与 UI 一致', () => {
    assert.equal(SUGGEST_KINDS.length, 6);
    assert.equal(SUGGEST_KINDS.filter(kind => kind === 'branch').length, 3);
    assert.deepEqual(SUGGEST_KINDS.slice(3), ['novel', 'dark', 'skip']);
    assert.equal(suggestKind(0), 'branch');
    assert.equal(suggestKind(3), 'novel');
    assert.equal(suggestKind(5), 'skip');
    assert.equal(suggestKind(99), 'branch');
    for (const kind of SUGGEST_KINDS) assert.ok(SUGGEST_LABELS[kind], kind);
});

// 老用户设置里存着的是 1.0.0 的出厂预设，升级后必须自动换成新版，
// 否则他们永远看不到六段分工（这就是「预设好像没变」的原因）。
test('旧版出厂预设自动升级，用户自己改过的一个字都不动', () => {
    const upgraded = migratePresets({ suggestPreset: LEGACY_SUGGEST_PRESETS[0], expandPreset: DEFAULT_EXPAND_PRESET });
    assert.equal(upgraded.suggestPreset, DEFAULT_SUGGEST_PRESET);
    assert.notEqual(upgraded.suggestPreset, LEGACY_SUGGEST_PRESETS[0]);
    assert.match(upgraded.suggestPreset, /第 4 条 · 新奇/);

    const custom = { suggestPreset: '我自己的预设', expandPreset: '我的扩写预设' };
    assert.deepEqual(migratePresets(custom), custom);

    // 只改过一个时，另一个照常升级
    const half = migratePresets({ suggestPreset: LEGACY_SUGGEST_PRESETS[0], expandPreset: '我的扩写预设' });
    assert.equal(half.suggestPreset, DEFAULT_SUGGEST_PRESET);
    assert.equal(half.expandPreset, '我的扩写预设');

    // 空值交给 index.js 兜默认，迁移函数不碰
    assert.equal(migratePresets({}).suggestPreset, undefined);

    // 换行与首尾空白的差异不影响判定（设置文件可能存成 CRLF）
    const messy = { suggestPreset: `\n${LEGACY_SUGGEST_PRESETS[0].replace(/\n/g, '\r\n')}\n   ` };
    assert.equal(migratePresets(messy).suggestPreset, DEFAULT_SUGGEST_PRESET);

    // 不修改传进来的对象
    const source = { suggestPreset: LEGACY_SUGGEST_PRESETS[0] };
    migratePresets(source);
    assert.equal(source.suggestPreset, LEGACY_SUGGEST_PRESETS[0]);
});

// 主人反馈：name2 有可能是角色卡名/文件名，剧情里的称呼要以消息自带的 name 为准。
test('names 优先用聊天记录里的称呼，而不是角色卡名', () => {
    const cardName = { ...context, name2: 'lia.png', characters: [{ name: '角色卡莉娅' }] };
    assert.equal(names(cardName).char, '莉娅');
    assert.equal(names(cardName).user, '旅行者');
    // 聊天里没有名字时退回 name1 / name2
    const bare = { ...context, chat: [{ name: '', mes: 'x', is_user: false }], name2: '卡名', name1: '玩家名' };
    assert.equal(names(bare).char, '卡名');
    assert.equal(names(bare).user, '玩家名');
});

test('buildWorldInfoBlock 走酒馆自己的激活逻辑，并合并 @Depth 条目', async () => {
    const calls = [];
    const ctx = {
        ...context,
        characters: [{ name: '莉娅', description: '银发酒保', personality: '沉稳', scenario: '雨夜' }],
        getWorldInfoPrompt: async (chat, maxContext, isDryRun, scanData) => {
            calls.push({ chatLength: chat.length, maxContext, isDryRun, scanData });
            return { worldInfoString: '雾港设定', worldInfoDepth: [{ depth: 4, entries: ['左手有旧疤'] }, { depth: 2, entries: ['', '  '] }] };
        },
    };
    const text = await buildWorldInfoBlock(ctx, { maxChars: 1000 });
    assert.equal(text, '雾港设定\n左手有旧疤');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].isDryRun, true, '不该触发世界书激活事件');
    assert.equal(calls[0].chatLength, 3);
    assert.equal(calls[0].scanData.characterDescription, '银发酒保');
    assert.equal(calls[0].scanData.scenario, '雨夜');
});

// 这条防的是真出过的 bug：酒馆的 WorldInfoBuffer 会对每条消息调 .trim()，
// 传消息对象进去会抛错并被 try/catch 吞掉，世界书静默变成空的（表现就是「世界书没加载」）。
test('buildWorldInfoBlock 喂给酒馆的是字符串数组，且深度 0 是最新一条', async () => {
    const seen = [];
    const ctx = {
        ...context,
        chat: [
            { name: '莉娅', mes: '第一句' },
            { name: '旅行者', mes: '第二句', is_user: true },
            { name: '', mes: '第三句' },
            { name: '旁白', mes: '系统注记', is_system: true },
        ],
        getWorldInfoPrompt: async chat => { seen.push(chat); return { worldInfoString: '设定' }; },
    };
    await buildWorldInfoBlock(ctx, { maxChars: 100 });
    assert.deepEqual(seen[0], ['第三句', '旅行者: 第二句', '莉娅: 第一句']);
    for (const row of seen[0]) assert.equal(typeof row, 'string', 'WorldInfoBuffer 会对每一项调 .trim()');
});

test('worldInfoScanChat 只取最近 1000 层，倒序，没有名字就只给内容', () => {
    const many = Array.from({ length: 1200 }, (_, index) => ({ name: 'N', mes: `第${index}句` }));
    const out = worldInfoScanChat(many);
    assert.equal(out.length, 1000);
    assert.equal(out[0], 'N: 第1199句');
    assert.equal(out.at(-1), 'N: 第200句');
    assert.deepEqual(worldInfoScanChat(undefined), []);
    assert.deepEqual(worldInfoScanChat([]), []);
});

test('世界书扫描带上 trigger=normal，带触发条件的条目才激活得了', async () => {
    const seen = [];
    const ctx = { ...context, getWorldInfoPrompt: async (chat, maxContext, isDryRun, scanData) => { seen.push(scanData); return { worldInfoString: 'x' }; } };
    await buildWorldInfoBlock(ctx, { maxChars: 100 });
    assert.equal(seen[0].trigger, 'normal');
});

test('buildWorldInfoBlock 拿不到就静默返回空串，不影响出选项', async () => {
    assert.equal(await buildWorldInfoBlock(context), '', '旧版本没有这个接口');
    const throwing = { ...context, getWorldInfoPrompt: async () => { throw new Error('boom'); } };
    assert.equal(await buildWorldInfoBlock(throwing), '');
    const blank = { ...context, getWorldInfoPrompt: async () => ({ worldInfoString: '   ', worldInfoDepth: [] }) };
    assert.equal(await buildWorldInfoBlock(blank), '');
});

test('buildWorldInfoBlock 超长截断并注明', async () => {
    const ctx = { ...context, getWorldInfoPrompt: async () => ({ worldInfoString: 'x'.repeat(500) }) };
    const text = await buildWorldInfoBlock(ctx, { maxChars: 100 });
    assert.ok(text.startsWith('x'.repeat(100)));
    assert.match(text, /截断/);
});

test('世界书追加在聊天记录之前，预设里写了占位符就按预设的位置来', () => {
    const plain = buildSuggestMessages(context, settings, 2, '雾港设定与人物');
    const content = plain.messages[0].content;
    assert.ok(content.includes('【世界设定】\n雾港设定与人物'));
    assert.ok(content.indexOf('【世界设定】') < content.indexOf('【聊天记录】'));
    assert.equal(content.split('雾港设定与人物').length, 2, '只出现一次');

    const own = buildSuggestMessages(context, { ...settings, suggestPreset: '设定：\n{{worldinfo}}\n记录：\n{{chat}}' }, 2, '雾港设定与人物');
    const ownContent = own.messages[0].content;
    assert.ok(ownContent.startsWith('设定：\n【世界设定】\n雾港设定与人物'), '占位符自己带着标题展开');
    assert.equal(ownContent.split('【世界设定】').length, 2, '按预设的位置出现一次，不再追加');

    // 没有世界书时不留空段
    const none = buildSuggestMessages(context, settings, 2, '');
    assert.ok(!none.messages[0].content.includes('【世界设定】'));
    assert.equal(none.worldInfoLength, 0);
});

test('扩写同样能带上世界书', () => {
    const { messages, worldInfoLength } = buildExpandMessages(context, settings, '我问问她的过去', '雾港设定');
    assert.ok(messages[0].content.includes('【世界设定】\n雾港设定'));
    assert.ok(messages[0].content.indexOf('【世界设定】') < messages[0].content.indexOf('【聊天记录】'));
    assert.equal(worldInfoLength, 4);
});
