// 业务编排：把纯逻辑与酒馆上下文接起来。每个方法都返回结果，不碰 DOM。

import { apiRequest, cleanMessage, resolveContextEnd, validateConnection, validateEndpoint } from './core.js';
import { SUGGEST_KINDS, buildExpandMessages, buildSuggestMessages, buildWorldInfoBlock, extractText, parseExpansion, parseSuggestions } from './assistant.js';

const WORLD_INFO_DEFAULT_CHARS = 4000;

export function createService(getContext, fetchImpl = fetch) {
    const chat = (settings, messages, signal) => {
        validateConnection(settings);
        return apiRequest(settings, 'chat', { messages, signal, fetchImpl, requestHeaders: getContext().getRequestHeaders() });
    };
    // 世界书随时可能变（切角色、改关键词），所以每次请求都现取一次，不缓存。
    const worldInfo = (settings, context) => settings.worldInfoInject === false
        ? Promise.resolve('')
        : buildWorldInfoBlock(context, { maxChars: Number(settings.worldInfoMaxChars) || WORLD_INFO_DEFAULT_CHARS });
    return {
        async suggest(settings, signal) {
            const context = getContext();
            const endIndex = resolveContextEnd(context.chat);
            if (endIndex === -1) throw new Error('当前聊天还没有可用的内容，先聊几句再生成选项。');
            const info = await worldInfo(settings, context);
            const { messages, count, worldInfoLength } = buildSuggestMessages(context, settings, endIndex, info);
            const body = await chat(settings, messages, signal);
            const items = parseSuggestions(extractText(body), { max: SUGGEST_KINDS.length });
            return { items, count, index: endIndex, text: cleanMessage(context.chat[endIndex].mes), model: settings.model, worldInfoLength };
        },
        async expand(settings, input, signal) {
            const context = getContext();
            const info = await worldInfo(settings, context);
            const { messages, input: source, count, worldInfoLength } = buildExpandMessages(context, settings, input, info);
            const body = await chat(settings, messages, signal);
            return { text: parseExpansion(extractText(body)), source, count, model: settings.model, worldInfoLength };
        },
        async listModels(settings, signal) {
            // 只校验地址与连接方式：全新安装时模型名还是空的，正是要靠这一步把列表拉出来。
            validateEndpoint(settings);
            const context = getContext();
            const body = await apiRequest(settings, 'models', { signal, fetchImpl, requestHeaders: context.getRequestHeaders() });
            if (!Array.isArray(body.data)) throw new Error('模型接口没有返回 data 数组。');
            return body.data.map(model => model.id).filter(name => typeof name === 'string').sort();
        },
        async previewSuggest(settings) {
            const context = getContext();
            const endIndex = resolveContextEnd(context.chat);
            if (endIndex === -1) throw new Error('当前聊天还没有可用的内容。');
            const info = await worldInfo(settings, context);
            return { ...buildSuggestMessages(context, settings, endIndex, info), index: endIndex };
        },
        async previewExpand(settings, input) {
            const context = getContext();
            const info = await worldInfo(settings, context);
            return buildExpandMessages(context, settings, input, info);
        },
    };
}
