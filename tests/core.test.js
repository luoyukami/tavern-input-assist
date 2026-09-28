import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULTS, cleanMessage, eligibleMessages, endpoints, loadSettings, mergeInput, planAutoSuggest, resolveContextEnd, routeRequest, safeError, validateConnection, validateEndpoint, validateSettings } from '../core.js';

const base = { ...DEFAULTS, model: 'mock-model', baseUrl: 'http://127.0.0.1:8317/v1' };
const chat = [
    { name: '莉娅', mes: '雨水沿着玻璃窗滑落。' },
    { name: '旅行者', mes: '“今晚还有空房吗？”', is_user: true },
    { name: '莉娅', mes: '“当然。”她把蜂蜜酒推过来。' },
];

test('endpoints 把基础地址补成两个接口', () => {
    assert.deepEqual(endpoints('http://127.0.0.1:8317/v1'), {
        chat: 'http://127.0.0.1:8317/v1/chat/completions',
        models: 'http://127.0.0.1:8317/v1/models',
    });
});

test('endpoints 吞掉用户粘贴的完整接口路径和结尾斜杠', () => {
    assert.equal(endpoints('http://x/v1/chat/completions').chat, 'http://x/v1/chat/completions');
    assert.equal(endpoints('http://x/v1/models').models, 'http://x/v1/models');
    assert.equal(endpoints('http://x/v1///').chat, 'http://x/v1/chat/completions');
    assert.equal(endpoints('http://x').models, 'http://x/v1/models');
});

test('endpoints 拒绝危险或含义不明的地址', () => {
    assert.throws(() => endpoints(''), /完整的 API 地址/);
    assert.throws(() => endpoints('ftp://x/v1'), /HTTP\/HTTPS/);
    assert.throws(() => endpoints('http://u:p@x/v1'), /HTTP\/HTTPS/);
    assert.throws(() => endpoints('http://x/v1?k=1'), /HTTP\/HTTPS/);
    assert.throws(() => endpoints('http://x/v1/responses'), /基础地址/);
});

test('loadSettings 只在勾选记住密钥时保留密钥', () => {
    assert.equal(loadSettings({ apiKey: 'sk-1' }).apiKey, '');
    assert.equal(loadSettings({ apiKey: 'sk-1', rememberKey: true }).apiKey, 'sk-1');
    assert.equal(loadSettings({}).transport, DEFAULTS.transport);
    // 老用户存过设置但没有 transport 字段时按直连处理，不改动他们原有的网络位置。
    assert.equal(loadSettings({ baseUrl: 'http://x/v1' }).transport, 'direct');
});

test('validateSettings 卡住越界的数值', () => {
    assert.doesNotThrow(() => validateSettings(base));
    assert.throws(() => validateSettings({ ...base, model: '   ' }), /文字模型/);
    assert.throws(() => validateSettings({ ...base, recentCount: 0 }), /上下文层数/);
    assert.throws(() => validateSettings({ ...base, recentCount: 101 }), /上下文层数/);
    assert.throws(() => validateSettings({ ...base, timeoutSeconds: 5 }), /最长等待/);
    assert.throws(() => validateSettings({ ...base, injectMode: 'x' }), /注入方式/);
    assert.throws(() => validateSettings({ ...base, transport: 'x' }), /酒馆后台转发/);
});

// 回归：全新安装时模型名是空的，「读取模型」必须还能用 —— 它正是用来挑模型的那一步。
test('validateEndpoint 在还没有模型名时也放行', () => {
    assert.doesNotThrow(() => validateEndpoint({ ...base, model: '' }));
    assert.doesNotThrow(() => validateEndpoint({ ...DEFAULTS, model: '' }));
    // 读取列表也不该被别的数值设置卡住
    assert.doesNotThrow(() => validateEndpoint({ ...base, model: '', recentCount: 999, timeoutSeconds: 1 }));
    // 旧版本留在设置里的选项条数字段已经不再参与任何判断，不会把 6 条改成别的数量
    assert.doesNotThrow(() => validateSettings({ ...base, suggestCount: 4, model: 'm' }));
    assert.throws(() => validateEndpoint({ ...base, model: '', baseUrl: 'ftp://x' }), /HTTP\/HTTPS/);
    assert.throws(() => validateEndpoint({ ...base, model: '', transport: 'x' }), /酒馆后台转发/);
    // 而真正要发对话请求时，模型名还是必须的
    assert.throws(() => validateConnection({ ...base, model: '' }), /读取模型/);
});

test('mergeInput 在空输入框里直接填入，否则按设置追加或替换', () => {
    assert.equal(mergeInput('', '你好', 'append'), '你好');
    assert.equal(mergeInput('   ', '你好', 'append'), '你好');
    assert.equal(mergeInput('我先开口。', '你好', 'append'), '我先开口。\n你好');
    assert.equal(mergeInput('我先开口。\n  ', '你好', 'append'), '我先开口。\n你好');
    assert.equal(mergeInput('我先开口。', '你好', 'replace'), '你好');
    assert.equal(mergeInput('保留', '', 'replace'), '保留');
});

test('planAutoSuggest 的每个守卫都能挡下一次白花的请求', () => {
    const settings = { autoSuggest: true };
    assert.equal(planAutoSuggest(settings, { chat }).run, true);
    assert.equal(planAutoSuggest({ autoSuggest: false }, { chat }).run, false);
    assert.equal(planAutoSuggest(settings, { chat, running: true }).run, false);
    assert.equal(planAutoSuggest(settings, { chat, stopped: true }).run, false);
    assert.equal(planAutoSuggest(settings, { chat: [] }).run, false);
    const userLast = [...chat, { name: '旅行者', mes: '我该走了。', is_user: true }];
    assert.match(planAutoSuggest(settings, { chat: userLast }).reason, /用户自己/);
    const last = eligibleMessages(chat).at(-1);
    assert.equal(planAutoSuggest(settings, { chat, last: { index: last.index, text: last.text } }).run, false);
    // 文本变了（swipe 换了一版）就该重新生成
    assert.equal(planAutoSuggest(settings, { chat, last: { index: last.index, text: '旧文本' } }).run, true);
});

test('planAutoSuggest 忽略系统楼层', () => {
    const withSystem = [...chat, { name: 'System', mes: '世界观补充：这是一座边境小镇。', is_system: true }];
    assert.equal(resolveContextEnd(withSystem), 2);
    assert.equal(planAutoSuggest({ autoSuggest: true }, { chat: withSystem }).index, 2);
});

test('eligibleMessages 过滤系统消息与空内容', () => {
    const rows = eligibleMessages([...chat, { name: 'S', mes: 'x', is_system: true }, { name: '莉娅', mes: '   ' }]);
    assert.deepEqual(rows.map(row => row.index), [0, 1, 2]);
});

test('cleanMessage 去掉思维块、HTML 与 base64 图片', () => {
    assert.equal(cleanMessage('<think>内部推理</think>正文'), '正文');
    assert.equal(cleanMessage('a<br>b'), 'a\nb');
    assert.equal(cleanMessage('看这个 <b>重点</b>'), '看这个 重点');
    assert.equal(cleanMessage('图：data:image/png;base64,AAAA'), '图：[图片]');
});

test('routeRequest 在后台转发模式下把密钥放进 x-api-key', () => {
    const server = routeRequest({ ...base, apiKey: 'sk-1', transport: 'server' }, 'http://up/v1/models', { requestHeaders: { 'X-CSRF-Token': 'csrf-1' } });
    assert.equal(server.options.headers['x-api-key'], 'sk-1');
    assert.equal(server.options.headers.Authorization, undefined);
    assert.equal(server.options.headers['X-CSRF-Token'], 'csrf-1');
    assert.equal(server.url, '/proxy/http%3A%2F%2Fup%2Fv1%2Fmodels');
    const direct = routeRequest({ ...base, apiKey: 'sk-1', transport: 'direct' }, 'http://up/v1/models', {});
    assert.equal(direct.options.headers.Authorization, 'Bearer sk-1');
    assert.equal(direct.options.headers['x-api-key'], undefined);
    assert.equal(direct.url, 'http://up/v1/models');
});

test('routeRequest 不把上游密钥带给不需要鉴权的目标', () => {
    const request = routeRequest({ ...base, apiKey: 'sk-1', transport: 'server' }, 'http://up/v1/models', { withApiKey: false });
    assert.equal(request.options.headers['x-api-key'], undefined);
});

test('safeError 抹掉密钥再给出提示', () => {
    const text = safeError(new Error('failed with sk-secret and Bearer abc.def'), 'sk-secret');
    assert.ok(!text.includes('sk-secret'));
    assert.ok(!text.includes('abc.def'));
});
