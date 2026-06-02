"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DynamicStructuredTool = void 0;
// Loading LangChain through require keeps runtime behavior while avoiding a very
// large compile-time type graph during production builds.
exports.DynamicStructuredTool = require('@langchain/core/tools').DynamicStructuredTool;
