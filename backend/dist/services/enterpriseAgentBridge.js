"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runEnterpriseAgent = runEnterpriseAgent;
const ai_service_1 = require("./ai.service");
const logger_1 = __importDefault(require("../config/logger"));
const config_1 = __importDefault(require("../config"));
async function runEnterpriseAgent(req) {
    if (!config_1.default.enterpriseAgent?.enabled) {
        logger_1.default.debug('EnterpriseAgent disabled; skipping bridge');
        return { skipped: true };
    }
    try {
        const aiResp = await ai_service_1.aiService.generateResponse({
            companyId: req.companyId,
            customerMessage: req.message,
            conversationHistory: [],
            lead: { customerName: '', phone: req.phone },
            properties: [],
            aiSettings: {},
            companyName: '',
            conversationState: req.conversationState,
        });
        return { skipped: false, ok: true, data: aiResp };
    }
    catch (err) {
        logger_1.default.error('EnterpriseAgentBridge failed', { error: err.message });
        return { skipped: false, ok: false, error: err.message };
    }
}
exports.default = { runEnterpriseAgent };
