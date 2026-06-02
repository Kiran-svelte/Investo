import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import config from '../../config';
import logger from '../../config/logger';
import { MAX_TOOL_CALLS_PER_MESSAGE } from '../../constants/agent-ai.constants';
import { ToolContext } from './agent-state';
import { getCheckpointer } from './agent-memory.service';
import { buildSystemPrompt } from './prompts/system-prompt';
import { getToolsForRole } from './tools';
import { formatDateIST, formatTimeIST } from './response-formatter.service';

export interface InvokeAgentParams {
  messageText: string;
  threadId: string;
  toolContext: ToolContext;
  companyName: string;
}

function createModel(): BaseChatModel {
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

function hasToolCalls(message: BaseMessage): boolean {
  return message instanceof AIMessage && Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
}

function toolCallCount(messages: BaseMessage[]): number {
  return messages.reduce((count, message) => {
    if (message instanceof AIMessage && Array.isArray(message.tool_calls)) return count + message.tool_calls.length;
    return count;
  }, 0);
}

function extractText(message: BaseMessage): string {
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

  async function agentNode(state: typeof MessagesAnnotation.State) {
    const messages = [
      new SystemMessage(systemPrompt),
      ...state.messages.slice(-config.agentAi.messageWindowSize),
    ];
    const response = await modelWithTools.invoke(messages);
    return { messages: [response] };
  }

  function shouldContinue(state: typeof MessagesAnnotation.State): 'tools' | typeof END {
    const last = state.messages[state.messages.length - 1];
    if (!hasToolCalls(last)) return END;
    if (toolCallCount(state.messages) >= MAX_TOOL_CALLS_PER_MESSAGE) {
      logger.warn('Agent AI max tool call limit reached', { userId: params.toolContext.userId });
      return END;
    }
    return 'tools';
  }

  const graph = new StateGraph(MessagesAnnotation)
    .addNode('agent', agentNode)
    .addNode('tools', new ToolNode(tools))
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
