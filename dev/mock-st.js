// 模拟酒馆前端：上下文、事件源、聊天楼层。只用于本地沙盒，不参与线上加载。
const handlers = new Map();
let chatMetadata = {};
const baseChat = [
    { name: '莉娅', mes: '雨水沿着酒馆的玻璃窗缓缓滑落。壁炉里跳动着暖橙色的火光，我放下手中的书，抬头看向被推开的木门。', extra: {}, swipe_id: 0, swipe_info: [{ extra: {} }] },
    { name: '旅行者', mes: '我收起沾满雨水的深色斗篷，走到壁炉边。“今晚还有空房吗？”', is_user: true, extra: {} },
    { name: '莉娅', mes: '“当然。”我微笑着从柜台后走来，将一杯冒着热气的蜂蜜酒放在你面前。铜灯下，木桌上铺着一张泛黄的地图。', extra: {}, swipe_id: 0, swipe_info: [{ extra: {} }] },
];

const context = {
    chat: structuredClone(baseChat), chatId: 'rainy-tavern', characterId: 0, groupId: null,
    characters: [{ name: '莉娅', avatar: 'lia.png' }], name1: '旅行者', name2: '莉娅',
    extensionSettings: JSON.parse(localStorage.getItem('mock-settings') || '{}'),
    get chatMetadata() { return chatMetadata; },
    updateChatMetadata(values, reset) { chatMetadata = reset ? { ...values } : { ...chatMetadata, ...values }; },
    saveMetadataDebounced() { qa.metadataSaves++; },
    saveSettingsDebounced() { localStorage.setItem('mock-settings', JSON.stringify(this.extensionSettings)); },
    async saveChat() { qa.saves++; },
    getRequestHeaders() { return { 'Content-Type': 'application/json', 'X-CSRF-Token': 'mock-csrf' }; },
    // 模拟酒馆的世界书激活（真实逻辑在酒馆自己的 world-info.js 里）。这里只造一份可控的返回，
    // 顺便记录调用参数，好确认我们确实按酒馆的规矩在问。
    async getWorldInfoPrompt(chat, maxContext, isDryRun, scanData) {
        qa.worldInfoCalls.push({ maxContext, isDryRun, scanData, chatLength: Array.isArray(chat) ? chat.length : 0 });
        return qa.worldInfo ?? { worldInfoString: '', worldInfoBefore: '', worldInfoAfter: '', worldInfoExamples: [], worldInfoDepth: [] };
    },
    eventSource: {
        on(type, fn) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(fn); },
        removeListener(type, fn) { handlers.get(type)?.delete(fn); },
    },
    eventTypes: Object.fromEntries(['CHAT_CHANGED', 'MESSAGE_RECEIVED', 'MESSAGE_SENT', 'MESSAGE_DELETED', 'MESSAGE_UPDATED', 'MESSAGE_SWIPED', 'GENERATION_ENDED', 'GENERATION_STOPPED'].map(key => [key, key])),
};
// 沙盒里默认走后台转发，地址指向本机的 mock 服务。
// 带 ?fresh=1 打开就是「全新安装」的状态：没有任何已存设置，模型名也是空的。
const freshInstall = new URLSearchParams(location.search).has('fresh');
if (freshInstall) delete context.extensionSettings.tavern_input_assist;
context.extensionSettings.tavern_input_assist ??= {
    transport: 'server',
    baseUrl: `${location.origin}/v1`,
    model: freshInstall ? '' : 'mock-text-model',
};

function emit(type, ...args) { for (const handler of handlers.get(type) || []) handler(...args); }

function render() {
    const chat = document.querySelector('#chat');
    chat.replaceChildren();
    context.chat.forEach((message, index) => {
        const node = document.createElement('article');
        node.className = message.is_user ? 'mes mes_user' : 'mes';
        node.setAttribute('mesid', String(index));
        const name = document.createElement('b');
        name.textContent = `${message.name} · 第 ${index + 1} 层`;
        const text = document.createElement('div');
        text.textContent = message.mes;
        node.append(name, text);
        chat.append(node);
    });
    document.querySelector('#mock-log').textContent = `聊天 ${context.chatId} · ${context.chat.length} 层`;
}

window.qa = {
    context, saves: 0, metadataSaves: 0, emit, render,
    worldInfoCalls: [],
    worldInfo: {
        worldInfoString: '【雾港酒馆】建在旧码头上的木造酒馆，老板娘莉娅守了七年。雨夜最忙，旅人常用故事换一杯蜂蜜酒。',
        worldInfoBefore: '', worldInfoAfter: '', worldInfoExamples: [],
        worldInfoDepth: [{ depth: 4, entries: ['莉娅左手腕上有一道旧疤，她从不提起它的来历。'], role: 0 }],
    },
    setWorldInfo(value) { qa.worldInfo = value; },
    input: () => document.querySelector('#send_textarea')?.value ?? '',
    setInput: value => {
        const textarea = document.querySelector('#send_textarea');
        textarea.value = value;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    },
    // 照酒馆的顺序：回复先落进聊天，再发 GENERATION_ENDED。
    reply(text = '雨声更密了。我把铜灯往你那边推了推，火光在杯沿上晃了一下。') {
        context.chat.push({ name: context.name2, mes: text, extra: {}, swipe_id: 0, swipe_info: [{ extra: {} }] });
        render();
        emit('MESSAGE_RECEIVED', context.chat.length - 1, 'normal');
        emit('GENERATION_ENDED', context.chat.length);
    },
    // stopGeneration() 同样会走 hideStopButton()，然后同一 tick 紧跟 GENERATION_STOPPED。
    stopGeneration() { emit('GENERATION_ENDED', context.chat.length); emit('GENERATION_STOPPED'); },
    swipe(text = '雨声更密了。我换了一件干燥的灰色斗篷，把湿透的长发拢到耳后。') {
        const last = context.chat.at(-1);
        last.mes = text;
        last.swipe_id = (last.swipe_id ?? 0) + 1;
        render();
        emit('MESSAGE_SWIPED', context.chat.length - 1);
    },
    switchChat() {
        context.chatId = context.chatId === 'rainy-tavern' ? 'other-chat' : 'rainy-tavern';
        context.chat = structuredClone(baseChat);
        chatMetadata = {};
        emit('CHAT_CHANGED');
        render();
    },
};

window.SillyTavern = { getContext: () => context };
render();
document.querySelector('#sim-reply')?.addEventListener('click', () => qa.reply());
document.querySelector('#sim-swipe')?.addEventListener('click', () => qa.swipe());
document.querySelector('#sim-stop')?.addEventListener('click', () => qa.stopGeneration());
await import('../index.js');
