"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendToLangGraph = sendToLangGraph;
const config_1 = __importDefault(require("../config"));
const logger_1 = __importDefault(require("../config/logger"));
async function sendToLangGraph(payload) {
    if (!config_1.default.langgraph?.enabled) {
        logger_1.default.debug('LangGraph disabled in config; skipping send');
        return { skipped: true };
    }
    const url = `${config_1.default.langgraph.url.replace(/\/+$/, '')}/webhook`;
    try {
        const controller = new AbortController();
        const timeoutMs = config_1.default.langgraph.timeoutMs || 5000;
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
        clearTimeout(timeout);
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            logger_1.default.error('LangGraph adapter non-2xx response', { status: resp.status });
            return { skipped: false, ok: false, error: `HTTP ${resp.status}`, data };
        }
        logger_1.default.info('LangGraph adapter received response', { status: resp.status });
        return { skipped: false, ok: true, data };
    }
    catch (err) {
        logger_1.default.error('LangGraph adapter request failed', { error: err.message });
        return { skipped: false, ok: false, error: err.message };
    }
}
exports.default = { sendToLangGraph };
