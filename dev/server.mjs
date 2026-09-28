// 本地集成沙盒。不联网、不需要任何真实密钥。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8766);

const OPTIONS = '["我推开门，站在门口先抖了抖斗篷上的雨水。","我没有坐下，先打量了一圈柜台后面的她。","我笑着把银币推过桌面，问还有没有空房。","我把地图翻过来，指着背面那行被水浸花的小字问她认不认得。","我伸手按住了她正要收走的酒杯，压低声音说这杯酒得由她来赔。","时间一晃到了第二天清晨，我在这张桌子上醒过来，柜台后面已经换了个人。"]';
const EXPANSION = '我犹豫了一下，还是把声音放轻，问出口：“你在这里待了多久了？”话说完自己先移开了视线，指尖在杯沿上慢慢转了一圈。';

const state = {
    proxyEnabled: true, chatDelay: 250, chatRequests: [], failChat: false,
    replyOptions: OPTIONS, replyExpansion: EXPANSION, replyFallback: OPTIONS, upstreamHeaders: [], // 便于在测试里核对转发头
};

const server = http.createServer(async (req, res) => {
    const reply = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    // 沙盒专用的宽松 CORS：让「浏览器直连」模式可以从别的端口（比如静态打开的酒馆页面）测过来。
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const pathname = new URL(req.url, `http://127.0.0.1:${port}`).pathname;
    let body;
    if (req.method === 'POST') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { return reply({ error: 'bad JSON' }, 400); }
    }

    if (pathname === '/mock/state') return reply({ ...state, chatRequests: state.chatRequests.length });
    if (pathname === '/mock/control') {
        for (const key of ['proxyEnabled', 'chatDelay', 'failChat', 'replyOptions', 'replyExpansion', 'replyFallback']) if (key in body) state[key] = body[key];
        if (body.resetRequests) { state.chatRequests = []; state.upstreamHeaders = []; }
        return reply({ ok: true });
    }

    // 模拟酒馆的 /proxy/ 路由：只允许转发到本机 mock，转发前删掉 cookie / csrf，
    // 但保留 authorization 与 x-api-key（真实酒馆就是这么做的）。
    if (pathname.startsWith('/proxy/')) {
        if (!state.proxyEnabled) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end('CORS proxy is disabled. Enable it in config.yaml or use the --corsProxy flag.');
        }
        let target;
        try { target = new URL(decodeURIComponent(pathname.slice('/proxy/'.length))); } catch { return reply({ error: 'Invalid proxy target' }, 400); }
        if (target.origin !== `http://127.0.0.1:${port}` || !['/v1/models', '/v1/chat/completions'].includes(target.pathname)) {
            return reply({ error: 'Mock proxy only permits local test endpoints' }, 403);
        }
        const headers = {};
        for (const key of ['accept', 'authorization', 'content-type', 'x-api-key']) if (req.headers[key]) headers[key] = req.headers[key];
        try {
            const upstream = await fetch(target, { method: req.method, headers, body: req.method === 'POST' ? JSON.stringify(body) : undefined });
            res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' });
            return res.end(Buffer.from(await upstream.arrayBuffer()));
        } catch { return reply({ error: 'Mock upstream unavailable' }, 502); }
    }

    if (pathname.startsWith('/v1/')) {
        state.upstreamHeaders.push({
            path: pathname,
            hasCookie: Boolean(req.headers.cookie),
            hasCsrf: Boolean(req.headers['x-csrf-token']),
            apiKey: req.headers['x-api-key'] ? 'present' : 'none',
            authorization: req.headers.authorization ? (req.headers.authorization === 'Bearer' ? 'empty-bearer' : 'present') : 'none',
        });
    }
    if (pathname === '/v1/models') {
        return reply({ data: [{ id: 'mock-text-model' }, { id: 'deepseek-v4.1-flash' }, { id: 'gpt-5.2-chat' }] });
    }
    if (pathname === '/v1/chat/completions') {
        state.chatRequests.push(body);
        if (state.failChat) return reply({ error: { message: '模拟：渠道返回 500' } }, 500);
        const prompt = JSON.stringify(body?.messages ?? '');
        const content = /JSON 字符串数组/.test(prompt) ? state.replyOptions : state.replyExpansion;
        return setTimeout(() => reply({ choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] }), state.chatDelay);
    }

    // 根路径直接给沙盒页面：页面 URL 保持 /dev/demo.html 的话，里面的相对路径才解析得对。
    if (pathname === '/') { res.writeHead(302, { Location: '/dev/demo.html' }); return res.end(); }

    const relative = pathname === '/' ? 'dev/demo.html' : decodeURIComponent(pathname.slice(1));
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    try {
        const data = await readFile(file);
        const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
    } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Local mock: http://127.0.0.1:${port}`));
