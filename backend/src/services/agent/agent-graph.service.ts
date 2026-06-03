import config from '../../config';
import logger from '../../config/logger';
import { MAX_TOOL_CALLS_PER_MESSAGE } from '../../constants/agent-ai.constants';
import { logAgentAction } from '../agent-action-log.service';
import { ToolContext } from './agent-state';
import { getCheckpointer } from './agent-memory.service';
import { buildSystemPrompt } from './prompts/system-prompt';
import { getToolsForRole } from './tools';
import { formatDateIST, formatTimeIST } from './response-formatter.service';

const { AIMessage, HumanMessage, SystemMessage } = require('@langchain/core/messages');
const { ChatAnthropic } = require('@langchain/anthropic');
const { ChatOpenAI } = require('@langchain/openai');
const { END, MessagesAnnotation, START, StateGraph } = require('@langchain/langgraph');
const { ToolNode } = require('@langchain/langgraph/prebuilt');

type BaseMessageLike = any;

export interface InvokeAgentParams {
  messageText: string;
  threadId: string;
  toolContext: ToolContext;
  companyName: string;
}

function createModel(): any {
  if (config.agentAi.provider === 'anthropic') {
    return new ChatAnthropic({
      model: config.agentAi.model || 'claude-sonnet-4-6',
      temperature: config.agentAi.temperature,
      anthropicApiKey: config.ai.claudeApiKey,
    });
  }

  return new ChatOpenAI({
    model: config.agentAi.model || 'gpt-4o',
    temperature: config.agentAi.temperature,
    openAIApiKey: config.ai.openaiApiKey,
  });
}

function hasToolCalls(message: BaseMessageLike): boolean {
  return message instanceof AIMessage && Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
}

function toolCallCount(messages: BaseMessageLike[]): number {
  return messages.reduce((count, message) => {
    if (message instanceof AIMessage && Array.isArray(message.tool_calls)) return count + message.tool_calls.length;
    return count;
  }, 0);
}

function extractText(message: BaseMessageLike): string {
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content.map((part: any) => part?.text ?? '').filter(Boolean).join('\n');
  }
  return '';
}

export async function invokeAgent(params: InvokeAgentParams): Promise<string> {
  const tools = getToolsForRole(params.toolContext);
  const model = createModel() as any;
  const modelWithTools = model.bindTools(tools);
  const now = new Date();
  const systemPrompt = buildSystemPrompt({
    userName: params.toolContext.userName,
    companyName: params.companyName,
    userRole: params.toolContext.userRole,
    currentDateIST: formatDateIST(now),
    currentTimeIST: formatTimeIST(now),
  });

  async function agentNode(state: any) {
    const messages = [
      new SystemMessage(systemPrompt),
      ...state.messages.slice(-config.agentAi.messageWindowSize),
    ];
    const response = await modelWithTools.invoke(messages);
    return { messages: [response] };
  }

  function shouldContinue(state: any): 'tools' | typeof END {
    const last = state.messages[state.messages.length - 1];
    if (!hasToolCalls(last)) return END;
    if (toolCallCount(state.messages) >= MAX_TOOL_CALLS_PER_MESSAGE) {
      logger.warn('Agent AI max tool call limit reached', { userId: params.toolContext.userId });
      return END;
    }
    return 'tools';
  }

  async function toolsNodeWithLogging(state: { messages: BaseMessageLike[] }) {
    const toolNode = new ToolNode(tools);
    const started = Date.now();
    const lastAi = [...state.messages].reverse().find((m) => m instanceof AIMessage && Array.isArray(m.tool_calls) && m.tool_calls.length);
    const toolCalls = lastAi instanceof AIMessage ? lastAi.tool_calls ?? [] : [];
    const result = await toolNode.invoke(state);
    const toolMessages = result.messages?.filter((m: BaseMessageLike) => m?.name) ?? [];
    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i] as { name?: string; args?: Record<string, unknown>; id?: string };
      const toolResult = toolMessages[i];
      const output = typeof toolResult?.content === 'string' ? toolResult.content : '';
      const failed = output.toLowerCase().includes('not found') || output.toLowerCase().includes('access denied') || output.toLowerCase().includes('only ');
      void logAgentAction({
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

  const checkpointer = await getCheckpointer();
  const compiled = checkpointer ? graph.compile({ checkpointer }) : graph.compile();
  const result = await compiled.invoke(
    { messages: [new HumanMessage(params.messageText)] },
    { configurable: { thread_id: params.threadId } },
  );
  const last = result.messages[result.messages.length - 1];
  return extractText(last) || 'I processed that, but there is no text response to send.';
}
