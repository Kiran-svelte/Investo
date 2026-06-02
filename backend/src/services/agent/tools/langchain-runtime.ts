export type AgentTool = any;

// Loading LangChain through require keeps runtime behavior while avoiding a very
// large compile-time type graph during production builds.
export const DynamicStructuredTool: any = require('@langchain/core/tools').DynamicStructuredTool;
