/**
 * config.js — IBM watsonx.ai + agent configuration
 *
 * All secrets come from environment variables (.env or container secrets).
 * Set WATSONX_STUB=true for offline/hackathon demo mode — the agents return
 * realistic canned responses without any API calls.
 */

'use strict';

require('dotenv').config();

module.exports = {
    // ── watsonx.ai ────────────────────────────────────────────────────────────
    watsonx: {
        apiKey:    process.env.WATSONX_API_KEY   || '',
        projectId: process.env.WATSONX_PROJECT_ID || '',
        url:       process.env.WATSONX_URL        || 'https://us-south.ml.cloud.ibm.com',
        // Model to use for all agents
        modelId:   process.env.WATSONX_MODEL_ID   || 'ibm/granite-13b-instruct-v2',
        // Generation parameters
        parameters: {
            max_new_tokens:   512,
            min_new_tokens:   1,
            stop_sequences:   ['\n\n'],
            repetition_penalty: 1.05,
            temperature:      0.2,
        },
    },

    // ── Stub / offline demo mode ──────────────────────────────────────────────
    // Defaults to TRUE (stub/offline) unless explicitly set to 'false'.
    // To use real watsonx.ai: set WATSONX_STUB=false and supply WATSONX_API_KEY.
    stubMode: process.env.WATSONX_STUB !== 'false',

    // ── Express server settings ───────────────────────────────────────────────
    server: {
        port: parseInt(process.env.AGENT_PORT || '4000', 10),
        host: process.env.AGENT_HOST || '0.0.0.0',
    },

    // ── ACE integration server (for callback ACK and routing) ─────────────────
    ace: {
        baseUrl: process.env.ACE_BASE_URL || 'http://localhost:7080',
    },

    // ── Logging ───────────────────────────────────────────────────────────────
    logLevel: process.env.LOG_LEVEL || 'info',

    // ── Urgency thresholds (used by ClassifierAgent) ──────────────────────────
    urgency: {
        criticalObxFlags: ['LL', 'HH', 'AA'],   // life-threatening abnormal flags
        urgentMsgTypes:   ['ADT^A01', 'ORU^R01'],
    },
};
