import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    DEFAULT_POLISH_PRESET, LEGACY_POLISH_PRESETS, POLISH_STORE_LIMITS, buildPolishMessages, cleanForPromptWith, composePolished, findRecord, hashText, inheritRecords, regexPreservedRangesWith, splitProse,
    lastAssistantIndex, migratePolishPreset, missingMarkup, parsePolished, planAutoPolish, planPolishApplication, adoptEdited,
    polishModelFor, polishViewFor, readArchive, readRecords, removeRecord, upsertRecord, validRecord, writeArchive,
} from '../polish.js';

const context = {
    chat: [
        { name: '莉娅', mes: '雨水沿着玻璃窗滑落。', extra: {} },
        { name: '旅行者', mes: '“今晚还有空房吗？”', is_user: true, extra: {} },
        { name: '莉娅', mes: '“当然。”她把一杯蜂蜜酒放在桌上。', extra: {} },
    ],
    name1: '旅行者', name2: '莉娅',
    characters: [{ name: '莉娅', description: '老板娘' }], characterId: 0,
};
const settings = { polishContext: 2, polishPreset: DEFAULT_POLISH_PRESET, model: 'main-model', polishModel: '' };
const record = (original, polished) => ({ key: hashText(original), original, polished, model: 'm', at: 1 });

// ---- 键 ----
test('hashText 对同一段正文稳定，对不同正文不同', () => {
    assert.equal(hashText('同一段正文'), hashText('同一段正文'));
    assert.notEqual(hashText('同一段正文'), hashText('同一段正文。'));
    assert.equal(hashText('').length, 8);
});

// ---- 模型输出清洗 ----
test('parsePolished 剥掉前言、围栏与思维块', () => {
    assert.equal(parsePolished('润色后：她把酒杯推过来。'), '她把酒杯推过来。');
    assert.equal(parsePolished('```\n她把酒杯推过来。\n```'), '她把酒杯推过来。');
    assert.equal(parsePolished('<think>改一下</think>她把酒杯推过来。'), '她把酒杯推过来。');
    assert.equal(parsePolished('  她把酒杯推过来。\n'), '她把酒杯推过来。');
});

test('parsePolished 把拒绝和空回复判成失败', () => {
    assert.throws(() => parsePolished(''), /没有返回/);
    assert.throws(() => parsePolished('润色后：'), /没有正文/);
    assert.throws(() => parsePolished('很抱歉，我不能协助修改这段内容。'), /拒绝了/);
});

// ---- 宏与标签 ----
test('missingMarkup 只认原版有、结果里少掉的宏与标签', () => {
    assert.deepEqual(missingMarkup('{{char}}笑了', '{{char}}轻轻笑了'), []);
    assert.deepEqual(missingMarkup('{{char}}笑了', '她轻轻笑了'), ['宏 char']);
    assert.deepEqual(missingMarkup('<font color="red">血色</font>', '<font color=\'red\'>血的颜色</font>'), []);
    assert.deepEqual(missingMarkup('<b>重点</b>', '<i>重点</i>'), ['标签 b', '标签 /b']);
    assert.deepEqual(missingMarkup('第一行<br>第二行', '第一行\n第二行'), []);
    // 结果里多出来的标签不算问题，只查丢失。
    assert.deepEqual(missingMarkup('一句话', '<b>一句话</b>'), []);
});

// ---- 应用判定 ----
test('planPolishApplication 正常结果直接放行', () => {
    const original = '雨水沿着玻璃窗缓缓滑落，我放下手里的书。';
    const verdict = planPolishApplication({ original, polished: '雨水沿着玻璃窗缓缓滑落，我合上书页。' });
    assert.equal(verdict.apply, true);
    assert.equal(verdict.text.includes('合上书页'), true);
    assert.equal(verdict.reason, '');
});

test('planPolishApplication 的每一道闸都能拦住坏结果', () => {
    const original = '雨水沿着玻璃窗缓缓滑落，我放下手里的书，抬头看向被推开的木门。';
    assert.equal(planPolishApplication({ original, polished: '' }).apply, false);
    assert.match(planPolishApplication({ original, polished: '   ' }).reason, /空白/);
    assert.match(planPolishApplication({ original, polished: original }).reason, /一模一样/);
    assert.match(planPolishApplication({ original, polished: '雨落了。' }).reason, /截断|审核/);
    assert.match(planPolishApplication({ original, polished: original.repeat(3) }).reason, /涨得太多/);
    assert.match(planPolishApplication({ original: '{{char}}推门进来。', polished: '有人推门进来。' }).reason, /宏 char/);
    assert.match(planPolishApplication({ original: `${'一'.repeat(15000)}`, polished: `二${'二'.repeat(20000)}` }).reason, /太长/);
});

// ---- 正文段切分 ----
test('splitProse 只把正文段当正文，思维链与面板整块剔掉', () => {
    const raw = '<Interleaving>\n<thinking>\n分析一下\n- 要点\n</thinking>\n雨落在窗上。\n\n她没有回头。\n</Interleaving>';
    const split = splitProse(raw);
    assert.equal(split.prose, '雨落在窗上。\n\n她没有回头。');
    assert.deepEqual(split.dropped, ['thinking']);
    // 包装标签与思维链原位保留，只有正文被换掉
    assert.equal(composePolished(raw, split, '【改写】'), '<Interleaving>\n<thinking>\n分析一下\n- 要点\n</thinking>\n【改写】\n</Interleaving>');

    const tail = '雨落在窗上。\n\n<UpdateVariable>\n<Analysis>\n- time passed: 2 min\n</Analysis>\n<JSONPatch>{"a":1}</JSONPatch>\n</UpdateVariable>';
    const split2 = splitProse(tail);
    assert.equal(split2.prose, '雨落在窗上。');
    assert.equal(split2.dropped.includes('updatevariable'), true);
    assert.equal(composePolished(tail, split2, '【改写】'), '【改写】\n\n<UpdateVariable>\n<Analysis>\n- time passed: 2 min\n</Analysis>\n<JSONPatch>{"a":1}</JSONPatch>\n</UpdateVariable>');
});

test('splitProse 保留正文容器的标签，只换里面的文字', () => {
    for (const [raw, prose] of [
        ['<content>雨落在窗上。</content>', '雨落在窗上。'],
        ['<lily_story>夜幕降临，屋内亮着灯。</lily_story>', '夜幕降临，屋内亮着灯。'],
        ['<now_plot>半梦半醒间，我醒了。</now_plot>', '半梦半醒间，我醒了。'],
        ['雨落在窗上。', '雨落在窗上。'],
    ]) {
        const split = splitProse(raw);
        assert.equal(split.prose, prose, raw);
        assert.deepEqual(split.dropped, [], raw);
        assert.equal(composePolished(raw, split, 'X'), raw.replace(prose, 'X'));
    }
});

test('splitProse 把中文标签、JSON、纯文件名这类块当数据剔掉', () => {
    const inline = splitProse('她<人渣>宅男.png</人渣>笑了。');
    assert.equal(inline.prose, '她笑了。');
    assert.deepEqual(inline.dropped, ['人渣']);
    // 占位块原样留在原位，不能被正文覆盖掉
    assert.equal(composePolished('她<人渣>宅男.png</人渣>笑了。', inline, '她笑了一下。'), '她笑了一下。<人渣>宅男.png</人渣>');

    assert.equal(splitProse('<mydata>{"hp": 10}</mydata>雨落在窗上。').prose, '雨落在窗上。');
    assert.equal(splitProse('<figure>hero.png</figure>正文在这里。').prose, '正文在这里。');
    assert.equal(splitProse('<X>[时间|夜晚]\n[地点|套房]</X>正文在最后。').prose, '正文在最后。');
    // 名字不在名单里、内容又是正常文字的，按正文处理（宁可多留，不能把正文丢掉）
    assert.equal(splitProse('<some_wrapper>这是正文。</some_wrapper>').prose, '这是正文。');
});

test('splitProse 剔掉图片与 base64，未闭合的思维链丢到结尾', () => {
    const imageRaw = '正文一。图：![x](http://a/b.png)数据：data:image/png;base64,AAAA正文二。';
    const withImage = splitProse(imageRaw);
    assert.equal(withImage.prose.includes('base64'), false);
    assert.equal(withImage.prose.includes('b.png'), false);
    assert.equal(withImage.prose.includes('正文一。'), true);
    const composed = composePolished(imageRaw, withImage, 'X');
    assert.equal(composed.includes('![x](http://a/b.png)'), true, '图片要原样留在原位');
    assert.equal(composed.includes('base64,AAAA'), true);

    const unclosed = splitProse('<thinking>只有思维链没有结尾\n第二行');
    assert.equal(unclosed.prose, '');
    assert.deepEqual(unclosed.dropped, ['thinking']);
});

test('关掉内置名单后只认用户补的名字（正文靠酒馆正则给）', () => {
    const raw = '<thinking>内部推理：不该进正文</thinking>正文在这里。';
    assert.equal(splitProse(raw).prose, '正文在这里。');
    // 关掉内置名单就不按块名剔除了，只剩标签被去掉 —— 推理文字会混进正文，所以默认开着
    assert.equal(splitProse(raw, '', [], false).prose, '内部推理：不该进正文正文在这里。');
    assert.equal(splitProse(raw, 'thinking', [], false).prose, '正文在这里。');
    // 内容像数据的块不受这个开关影响（按内容判断，兜住 <人渣>hero.png</人渣> 这类卡片占位）
    assert.equal(splitProse('<mydata>{"hp":1}</mydata>正文。', '', [], false).prose, '正文。');
});

test('splitProse 支持用户自己补的块名（支持 * 通配）', () => {
    const raw = '<my_panel>[HP 10]</my_panel>正文在这里。';
    assert.equal(splitProse(raw).prose, '正文在这里。');
    assert.equal(splitProse(raw, 'my_panel*').dropped.includes('my_panel'), true);
    const custom = '<SZ_STORY>晨光洒在榻上。</SZ_STORY>';
    assert.equal(splitProse(custom, 'sz_story extra_meta*').prose, '');
    assert.equal(splitProse(custom).prose, '晨光洒在榻上。');
});

// ---- 复用酒馆的正则管线 ----
test('正文优先走酒馆的正则管线，拿不到就退回原文', () => {
    const active = { get: text => text.replace(/<thinking>[\s\S]*?<\/thinking>/g, ''), placement: { AI_OUTPUT: 2 } };
    assert.equal(cleanForPromptWith(active, 'A<thinking>内部</thinking>B'), 'AB');
    assert.equal(cleanForPromptWith(null, 'A<thinking>内部</thinking>B'), 'A<thinking>内部</thinking>B');
    const broken = { get: () => { throw new Error('boom'); }, placement: { AI_OUTPUT: 2 } };
    assert.equal(cleanForPromptWith(broken, '原文'), '原文');
    assert.equal(cleanForPromptWith(active, undefined), '');
});

test('被「只改发送」的正则删掉的区间，在原文里原位保留', () => {
    const active = {
        placement: { AI_OUTPUT: 2 },
        scriptList: () => [
            { findRegex: '/<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>/gsi', replaceString: '', placement: [2], promptOnly: true },
            { findRegex: '/<disabled>[\\s\\S]*?<\\/disabled>/g', replaceString: '', placement: [2], promptOnly: true, disabled: true },
            { findRegex: '/<replaced>[\\s\\S]*?<\\/replaced>/g', replaceString: 'X', placement: [2], promptOnly: true },
            { findRegex: '/<useronly>[\\s\\S]*?<\\/useronly>/g', replaceString: '', placement: [1], promptOnly: true },
            { findRegex: '/<displayonly>[\\s\\S]*?<\\/displayonly>/g', replaceString: '', placement: [2], markdownOnly: true },
        ],
    };
    const raw = '正文在这里。\n\n<UpdateVariable><JSONPatch>{}</JSONPatch></UpdateVariable>';
    const ranges = regexPreservedRangesWith(active, raw);
    assert.equal(ranges.length, 1);
    assert.equal(raw.slice(ranges[0].start, ranges[0].end), '<UpdateVariable><JSONPatch>{}</JSONPatch></UpdateVariable>');
    const split = splitProse(raw, '', ranges);
    assert.equal(split.prose, '正文在这里。');
    // 这个块既被正则删掉、名字也在内置名单里，两边都会认出来
    assert.deepEqual(split.dropped, ['正则剔除', 'updatevariable']);
    // 拼回时变量更新块一个字都不能少
    assert.equal(composePolished(raw, split, '正文改好了。'), '正文改好了。\n\n<UpdateVariable><JSONPatch>{}</JSONPatch></UpdateVariable>');
    assert.deepEqual(regexPreservedRangesWith(null, raw), []);
    assert.deepEqual(regexPreservedRangesWith({ placement: {} }, raw), []);
});

// ---- 记录存取 ----
test('readRecords 丢掉结构不对的记录', () => {
    const good = record('原文', '润色');
    const rows = readRecords({ records: [good, { key: 'x', original: '原文', polished: '润色' }, { original: '原文' }, null, { ...good, key: 'deadbeef' }] });
    assert.equal(rows.length, 1);
    assert.equal(validRecord(good), true);
    // 直接给数组（旧格式）也能读。
    assert.equal(readRecords([good]).length, 1);
    assert.equal(readRecords(undefined).length, 0);
});

test('findRecord 两边都认，不会串到同键的别段', () => {
    const records = [record('原文', '润色后的原文')];
    assert.equal(findRecord(records, '原文')?.polished, '润色后的原文');
    assert.equal(findRecord(records, '润色后的原文')?.original, '原文');
    assert.equal(findRecord(records, '原文 '), null);
    assert.equal(findRecord(records, ''), null);
});

test('upsertRecord 覆盖同一段正文，新的排最前，超限裁掉最旧', () => {
    const first = upsertRecord([], { original: '一', polished: '一号', at: 1 });
    const second = upsertRecord(first, { original: '二', polished: '二号', at: 2 });
    assert.deepEqual(second.map(item => item.original), ['二', '一']);
    const again = upsertRecord(second, { original: '一', polished: '一号改', at: 3 });
    assert.deepEqual(again.map(item => item.original), ['一', '二']);
    assert.equal(again[0].polished, '一号改');
    const capped = upsertRecord(again, { original: '三', polished: '三号', at: 4 }, { maxRecords: 2, maxChars: 1000 });
    assert.deepEqual(capped.map(item => item.original), ['三', '一']);
});

test('upsertRecord 超字数预算时至少留下最新的一条', () => {
    const kept = upsertRecord([], { original: 'x'.repeat(50), polished: 'y'.repeat(50) }, { maxRecords: 10, maxChars: 10 });
    assert.equal(kept.length, 1);
});

test('removeRecord 按 key 删掉一条', () => {
    const records = [record('一', '一号'), record('二', '二号')];
    assert.deepEqual(removeRecord(records, hashText('一')).map(item => item.original), ['二']);
});

test('adoptEdited 把手改接进对应那一版，两个方向都不丢', () => {
    const one = record('原文', '润色版');
    const asPolished = adoptEdited([one], { key: one.key, text: '手改后的润色', side: 'polished' });
    assert.equal(asPolished[0].original, '原文');
    assert.equal(asPolished[0].polished, '手改后的润色');
    const asOriginal = adoptEdited([one], { key: one.key, text: '手改后的原文', side: 'original' });
    assert.equal(asOriginal[0].original, '手改后的原文');
    assert.equal(asOriginal[0].polished, '润色版');
    assert.equal(asOriginal[0].key, hashText('手改后的原文'));
    // 认不出改的是哪一版、或正文还是这两版之一时不碰记录
    assert.equal(adoptEdited([one], { key: one.key, text: '手改', side: null })[0].polished, '润色版');
    assert.equal(adoptEdited([one], { key: one.key, text: '原文', side: 'polished' })[0].original, '原文');
    assert.equal(adoptEdited([one], { key: 'nope', text: '手改', side: 'polished' }).length, 1);
});

test('polishViewFor 从正文本身推导当前显示的是哪一版', () => {
    const one = record('原文', '润色版');
    assert.equal(polishViewFor(one, '润色版'), 'polished');
    assert.equal(polishViewFor(one, '原文'), 'original');
    assert.equal(polishViewFor(one, '手改过的内容'), 'edited');
    assert.equal(polishViewFor(null, '原文'), null);
});

// ---- 分支镜像 ----
test('镜像按聊天 ID 存，条数超了就丢最旧的，继承时按去扩展名的聊天名匹配', () => {
    let archive = writeArchive({}, '主聊天 - 2026-09-29.jsonl', [record('原文', '润色')]);
    assert.equal(Object.keys(archive).length, 1);
    assert.equal(inheritRecords(archive, '主聊天 - 2026-09-29')[0].polished, '润色');
    assert.deepEqual(inheritRecords(archive, '别的聊天'), []);
    assert.deepEqual(inheritRecords(archive, ''), []);
    for (const name of ['b', 'c', 'd']) archive = writeArchive(archive, `${name}.jsonl`, [record('原文', '润色')], { maxChats: 2 });
    assert.deepEqual(Object.keys(archive).sort(), ['c.jsonl', 'd.jsonl']);
    assert.equal(readArchive({ polishArchive: archive })?.['d.jsonl'].records.length, 1);
    assert.equal(readArchive({ archive })?.['d.jsonl'].records.length, 1);   // 兼容旧字段
    assert.deepEqual(readArchive(undefined), {});
});

// ---- 提示词 ----
test('buildPolishMessages 把正文、前文与世界书填进占位符', () => {
    const built = buildPolishMessages(context, settings, 2, '雾港酒馆建在旧码头上。');
    const content = built.messages[0].content;
    assert.equal(built.messages[0].role, 'system');
    assert.equal(built.original, '“当然。”她把一杯蜂蜜酒放在桌上。');
    assert.equal(built.count, 2);
    assert.equal(built.worldInfoLength, 11);
    assert.equal(content.includes('“当然。”她把一杯蜂蜜酒放在桌上。'), true);
    assert.equal(content.includes('旅行者：“今晚还有空房吗？”'), true);
    // 世界书在聊天记录之前
    assert.ok(content.indexOf('雾港酒馆') < content.indexOf('旅行者：'));
    // 被润色的那一层不能出现在前文里
    assert.equal(content.split('“当然。”').length - 1, 1);
});

test('buildPolishMessages 支持自定义预设与 0 层上下文', () => {
    const custom = buildPolishMessages(context, { ...settings, polishContext: 0, polishPreset: '把下面这段改得更冷：{{text}}' }, 2, '');
    assert.equal(custom.count, 0);
    assert.equal(custom.messages[0].content, '把下面这段改得更冷：“当然。”她把一杯蜂蜜酒放在桌上。');
});

test('buildPolishMessages 在预设没写 {{text}} 时把正文补在末尾，且不重复', () => {
    const built = buildPolishMessages(context, { ...settings, polishPreset: '润色下面这条消息，保持语气。{{chat}}' }, 2, '');
    const content = built.messages[0].content;
    assert.equal(content.startsWith('润色下面这条消息，保持语气。'), true);
    assert.equal(content.split('【要润色的正文】').length - 1, 1);
    assert.equal(content.includes('旅行者：“今晚还有空房吗？”'), true);
    // {{text}} 已经写进预设时不再补一遍
    const twice = buildPolishMessages(context, { ...settings, polishPreset: '改：{{text}}' }, 2, '');
    assert.equal(twice.messages[0].content.split('“当然。”').length - 1, 1);
});

test('buildPolishMessages 只把正文段送进提示词，思维链与面板不进', () => {
    const withBlocks = {
        ...context,
        chat: [
            { name: '莉娅', mes: '上一句。', extra: {} },
            {
                name: '莉娅',
                extra: {},
                mes: '<Interleaving>\n<thinking>内部推理：这里不该被改写</thinking>\n她把杯子推过来。\n\n“喝吧。”\n</Interleaving>\n<UpdateVariable>\n<Analysis>time passed: 2 min</Analysis>\n</UpdateVariable>',
            },
        ],
    };
    const built = buildPolishMessages(withBlocks, settings, 1, '');
    const content = built.messages[0].content;
    assert.equal(built.prose, '她把杯子推过来。\n\n“喝吧。”');
    assert.equal(content.includes('内部推理'), false, '思维链不该进提示词');
    assert.equal(content.includes('time passed'), false, '变量更新不该进提示词');
    assert.equal(content.includes('她把杯子推过来。'), true);
    assert.equal(built.original.startsWith('<Interleaving>'), true, 'original 仍是整条原文，替换时按它拼回');
    assert.deepEqual(built.split.dropped.includes('thinking'), true);
});

test('buildPolishMessages 对只剩思维链的楼层说清楚原因', () => {
    const onlyThink = { ...context, chat: [{ name: '莉娅', mes: '<thinking>只有推理</thinking>', extra: {} }] };
    assert.throws(() => buildPolishMessages(onlyThink, settings, 0, ''), /只剩思维链\/面板内容/);
});

test('buildPolishMessages 对不存在的楼层和空正文直接报错', () => {
    assert.throws(() => buildPolishMessages(context, settings, 9, ''), /已经不在了/);
    assert.throws(() => buildPolishMessages({ ...context, chat: [{ name: '莉娅', mes: '   ' }] }, settings, 0, ''), /没有正文/);
});

test('lastAssistantIndex 跳过用户楼层，找不到时是 -1', () => {
    assert.equal(lastAssistantIndex(context.chat), 2);
    assert.equal(lastAssistantIndex([{ name: 'u', mes: '嗨', is_user: true }]), -1);
    assert.equal(lastAssistantIndex([]), -1);
});

// ---- 预设升级与模型回退 ----
test('migratePolishPreset 只升级出厂默认，用户改过的不动', () => {
    assert.equal(migratePolishPreset({}), DEFAULT_POLISH_PRESET);
    assert.equal(migratePolishPreset({ polishPreset: DEFAULT_POLISH_PRESET }), DEFAULT_POLISH_PRESET);
    assert.equal(migratePolishPreset({ polishPreset: ' 我的预设 ' }), ' 我的预设 ');
});

test('polishModelFor 留空时回退到主模型', () => {
    assert.equal(polishModelFor({ model: 'main', polishModel: '' }), 'main');
    assert.equal(polishModelFor({ model: 'main', polishModel: '  ' }), 'main');
    assert.equal(polishModelFor({ model: 'main', polishModel: 'cheap' }), 'cheap');
    assert.equal(polishModelFor({}), '');
});

// ---- 自动守卫 ----
test('planAutoPolish 的每个守卫都能挡下一次白花的请求', () => {
    const chat = [{ name: 'u', mes: '在吗', is_user: true }, { name: '莉娅', mes: '在的。' }];
    const on = { polishAuto: true };
    assert.equal(planAutoPolish({}, { chat })?.run, false);
    assert.equal(planAutoPolish(on, { chat, running: true }).reason, '已有请求正在进行');
    assert.equal(planAutoPolish(on, { chat, stopped: true }).reason, '本次回复已被用户停止');
    assert.equal(planAutoPolish(on, { chat: [] }).run, false);
    assert.equal(planAutoPolish(on, { chat: [{ name: 'u', mes: '在吗', is_user: true }] }).run, false);
    // 只有空白的一层不算可用楼层（cleanMessage 之后就是空的）
    assert.equal(planAutoPolish(on, { chat: [{ name: '莉娅', mes: '  ' }] }).reason, '没有可用的聊天楼层');
    // 剥掉思维链后内容为空的楼层会先被 eligibleMessages 滤掉；剩下能进来但没正文的（比如只有变量块）挡在正文检查里。
    assert.equal(planAutoPolish(on, { chat: [{ name: '莉娅', mes: '<thinking>只有推理</thinking>' }] }).reason, '没有可用的聊天楼层');
    assert.equal(planAutoPolish(on, { chat: [{ name: '莉娅', mes: '<UpdateVariable>{"hp":1}</UpdateVariable>' }] }).reason, '这一层只有思维链或面板内容');
    assert.equal(planAutoPolish(on, { chat, records: [record('在的。', '在的呀。')] }).reason, '这一层已经润色过');
    assert.equal(planAutoPolish(on, { chat, tried: new Set([hashText('在的。')]) }).run, false);
    const run = planAutoPolish(on, { chat });
    assert.equal(run.run, true);
    assert.equal(run.index, 1);
    assert.equal(run.original, '在的。');
});

test('存储上限常量与默认值保持可读', () => {
    assert.equal(POLISH_STORE_LIMITS.maxRecords > 0, true);
    assert.equal(POLISH_STORE_LIMITS.maxChats, 3);
    assert.match(DEFAULT_POLISH_PRESET, /\{\{text\}\}/);
    assert.match(DEFAULT_POLISH_PRESET, /\{\{chat\}\}/);
});

// 契约测试：预设的职能范围被改动时必须一起改这里，免得悄悄放宽成「随便改剧情」。
test('预设的硬规矩：只保大意、不改情节、不淡化尺度、AI 味靶子写在里面', () => {
    assert.match(DEFAULT_POLISH_PRESET, /保留大意/);
    assert.match(DEFAULT_POLISH_PRESET, /大尺度重写/);
    assert.match(DEFAULT_POLISH_PRESET, /不新增事件、不改变顺序与结果/);
    assert.match(DEFAULT_POLISH_PRESET, /不因为尺度就删改、淡化成人向或暴力内容/);
    assert.match(DEFAULT_POLISH_PRESET, /事实性细节不许换掉或写没/);
    assert.match(DEFAULT_POLISH_PRESET, /HTML 标签/);
    // 去 AI 味必须有具体靶子，否则模型只会做同义词替换
    assert.match(DEFAULT_POLISH_PRESET, /嘴角勾起一抹弧度/);
    assert.match(DEFAULT_POLISH_PRESET, /狡黠/);
    assert.match(DEFAULT_POLISH_PRESET, /指节泛白/);
    assert.match(DEFAULT_POLISH_PRESET, /「不是 A，而是 B」/);
    assert.match(DEFAULT_POLISH_PRESET, /「一丝」「一抹」/);
    assert.match(DEFAULT_POLISH_PRESET, /助手式台词/);
    assert.match(DEFAULT_POLISH_PRESET, /解释情绪而不是呈现/);
    // 每次改动出厂预设都要把上一版收进清单，1.3.0 期间改过两次
    assert.ok(LEGACY_POLISH_PRESETS.length >= 2, '历史清单漏收了上一版预设');
});

test('改过的出厂预设会被旧版本用户自动升级上来', () => {
    assert.equal(LEGACY_POLISH_PRESETS.length > 0, true, '换了出厂预设就必须把上一版放进历史清单');
    for (const old of LEGACY_POLISH_PRESETS) {
        assert.notEqual(old, DEFAULT_POLISH_PRESET);
        assert.equal(migratePolishPreset({ polishPreset: old }), DEFAULT_POLISH_PRESET);
    }
});
