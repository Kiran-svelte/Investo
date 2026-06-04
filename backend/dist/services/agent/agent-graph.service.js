"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.invokeAgent = invokeAgent;
const config_1 = __importDefault(require("../../config"));
const logger_1 = __importDefault(require("../../config/logger"));
const agent_ai_constants_1 = require("../../constants/agent-ai.constants");
const agent_action_log_service_1 = require("../agent-action-log.service");
const agent_memory_service_1 = require("./agent-memory.service");
const system_prompt_1 = require("./prompts/system-prompt");
const tools_1 = require("./tools");
const response_formatter_service_1 = require("./response-formatter.service");
const { AIMessage, HumanMessage, SystemMessage } = require('@langchain/core/messages');
const { ChatAnthropic } = require('@langchain/anthropic');
const { ChatOpenAI } = require('@langchain/openai');
const { END, MessagesAnnotation, START, StateGraph } = require('@langchain/langgraph');
const { ToolNode } = require('@langchain/langgraph/prebuilt');
function createModel() {
    if (config_1.default.agentAi.provider === 'anthropic') {
        return new ChatAnthropic({
            model: config_1.default.agentAi.model || 'claude-sonnet-4-6',
            temperature: config_1.default.agentAi.temperature,
            anthropicApiKey: config_1.default.ai.claudeApiKey,
        });
    }
    return new ChatOpenAI({
        model: config_1.default.agentAi.model || 'gpt-4o',
        temperature: config_1.default.agentAi.temperature,
        openAIApiKey: config_1.default.ai.openaiApiKey,
    });
}
function hasToolCalls(message) {
    return message instanceof AIMessage && Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
}
function toolCallCount(messages) {
    return messages.reduce((count, message) => {
        if (message instanceof AIMessage && Array.isArray(message.tool_calls))
            return count + message.tool_calls.length;
        return count;
    }, 0);
}
function extractText(message) {
    if (typeof message.content === 'string')
        return message.content;
    if (Array.isArray(message.content)) {
        return message.content.map((part) => part?.text ?? '').filter(Boolean).join('\n');
    }
    return '';
}
/** When the model stops after tool calls without a final reply, surface the last tool output. */
function extractAgentReply(messages) {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i];
        if (message instanceof AIMessage) {
            const text = extractText(message);
            if (text.trim())
                return text;
            continue;
        }
        const toolName = message?.name;
        const toolBody = typeof message?.content === 'string' ? message.content : extractText(message);
        if (toolName && toolBody.trim())
            return toolBody;
    }
    return '';
}
async function invokeAgent(params) {
    const tools = (0, tools_1.getToolsForRole)(params.toolContext);
    const model = createModel();
    const modelWithTools = model.bindTools(tools);
    const now = new Date();
    const systemPrompt = (0, system_prompt_1.buildSystemPrompt)({
        userName: params.toolContext.userName,
        companyName: params.companyName,
        userRole: params.toolContext.userRole,
        currentDateIST: (0, response_formatter_service_1.formatDateIST)(now),
        currentTimeIST: (0, response_formatter_service_1.formatTimeIST)(now),
        clientMemoryBlock: params.clientMemoryBlock,
    });
    async function agentNode(state) {
        const messages = [
            new SystemMessage(systemPrompt),
            ...state.messages.slice(-config_1.default.agentAi.messageWindowSize),
        ];
        const response = await modelWithTools.invoke(messages);
        return { messages: [response] };
    }
    function shouldContinue(state) {
        const last = state.messages[state.messages.length - 1];
        if (!hasToolCalls(last))
            return END;
        if (toolCallCount(state.messages) >= agent_ai_constants_1.MAX_TOOL_CALLS_PER_MESSAGE) {
            logger_1.default.warn('Agent AI max tool call limit reached', { userId: params.toolContext.userId });
            return END;
        }
        return 'tools';
    }
    async function toolsNodeWithLogging(state) {
        const toolNode = new ToolNode(tools);
        const started = Date.now();
        const lastAi = [...state.messages].reverse().find((m) => m instanceof AIMessage && Array.isArray(m.tool_calls) && m.tool_calls.length);
        const toolCalls = lastAi instanceof AIMessage ? lastAi.tool_calls ?? [] : [];
        const result = await toolNode.invoke(state);
        const toolMessages = result.messages?.filter((m) => m?.name) ?? [];
        for (let i = 0; i < toolCalls.length; i++) {
            const tc = toolCalls[i];
            const toolResult = toolMessages[i];
            const output = typeof toolResult?.content === 'string' ? toolResult.content : '';
            const failed = output.toLowerCase().includes('not found') || output.toLowerCase().includes('access denied') || output.toLowerCase().includes('only ');
            void (0, agent_action_log_service_1.logAgentAction)({
                companyId: params.toolContext.companyId,
                triggeredBy: 'agent_tool',
                action: tc.name ?? 'unknown_tool',
                actorId: params.toolContext.userId,
                actorRole: params.toolContext.userRole,
                inputs: tc.args ?? {},
                result: output.slice(0, 500) || null,
                status: failed ? 'failed' : 'success',
                durationMs: Date.now() - started,
            });
        }
        return result;
    }
    const graph = new StateGraph(MessagesAnnotation)
        .addNode('agent', agentNode)
        .addNode('tools', toolsNodeWithLogging)
        .addEdge(START, 'agent')
        .addConditionalEdges('agent', shouldContinue, { tools: 'tools', [END]: END })
        .addEdge('tools', 'agent');
    const checkpointer = await (0, agent_memory_service_1.getCheckpointer)();
    const compiled = checkpointer ? graph.compile({ checkpointer }) : graph.compile();
    const result = await compiled.invoke({ messages: [new HumanMessage(params.messageText)] }, { configurable: { thread_id: params.threadId } });
    const reply = extractAgentReply(result.messages);
    if (reply.trim())
        return reply;
    logger_1.default.warn('Agent AI produced empty reply', { userId: params.toolContext.userId });
    return 'I could not format a reply. Please try again or rephrase (e.g. "leads today" or "visits tomorrow").';
}
