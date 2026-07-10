/**
 * index.js — HL7 AI Agent Layer — Express HTTP Server
 *
 * Receives parsed HL7 JSON from IBM ACE (via HTTP POST /process),
 * runs the four agents in sequence, and returns a structured AgentResult.
 *
 *  POST /process          — full pipeline (classify → validate → enrich → summarise)
 *  POST /classify         — classification only
 *  POST /validate         — validation only
 *  GET  /health           — liveness probe
 *  GET  /demo             — demo runner (fires all 3 sample messages)
 *
 * IBM ACE calls /process after HL7Parser.esql populates LocalEnvironment.HL7
 * and the flow's HTTP Request node forwards the jsonSummary as the POST body.
 */

'use strict';

const http    = require('http');
const url     = require('url');
const config  = require('./config');

const { classify }  = require('./agents/ClassifierAgent');
const { validate }  = require('./agents/ValidatorAgent');
const { enrich }    = require('./agents/EnrichmentAgent');
const { summarise } = require('./agents/SummaryAgent');

const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args);

// ---------------------------------------------------------------------------
// Middleware: parse JSON body
// ---------------------------------------------------------------------------
function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => {
            try { resolve(JSON.parse(data || '{}')); }
            catch (e) { reject(new Error('Invalid JSON body: ' + e.message)); }
        });
        req.on('error', reject);
    });
}

// ---------------------------------------------------------------------------
// CORS + JSON response helpers
// ---------------------------------------------------------------------------
function sendJson(res, statusCode, body) {
    const payload = JSON.stringify(body, null, 2);
    res.writeHead(statusCode, {
        'Content-Type':  'application/json',
        'Access-Control-Allow-Origin': '*',
    });
    res.end(payload);
}

// ---------------------------------------------------------------------------
// Full agent pipeline
// ---------------------------------------------------------------------------
async function runPipeline(hl7Json) {
    log(`Processing: ${hl7Json.messageType || 'UNKNOWN'}^${hl7Json.triggerEvent || ''} | MRN: ${hl7Json.patientId || 'N/A'}`);

    const [classification, validation] = await Promise.all([
        classify(hl7Json),
        validate(hl7Json),
    ]);

    // Enrichment runs after classification (needs route context)
    const enrichment = await enrich(hl7Json);

    // Summary runs last — needs all prior results
    const summary = await summarise(hl7Json, classification, validation, enrichment);

    return {
        status:         validation.isValid ? 'accepted' : 'rejected',
        messageType:    hl7Json.messageType,
        triggerEvent:   hl7Json.triggerEvent,
        patientId:      hl7Json.patientId,
        classification,
        validation,
        enrichment,
        summary,
        processedAt:    new Date().toISOString(),
        mode:           config.stubMode ? 'stub' : 'live',
    };
}

// ---------------------------------------------------------------------------
// Demo runner — injects all 3 sample message types
// ---------------------------------------------------------------------------
async function runDemo() {
    const samples = require('./demo-samples');
    const results = [];
    for (const sample of samples) {
        results.push(await runPipeline(sample));
    }
    return results;
}

// ---------------------------------------------------------------------------
// HTTP Router
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
    const parsed = url.parse(req.url, true);
    const path   = parsed.pathname;

    // Preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' });
        return res.end();
    }

    try {
        // ── GET /health ──────────────────────────────────────────────────────
        if (req.method === 'GET' && path === '/health') {
            return sendJson(res, 200, {
                status:   'UP',
                stubMode: config.stubMode,
                version:  '1.0.0',
                timestamp: new Date().toISOString(),
            });
        }

        // ── GET /demo ────────────────────────────────────────────────────────
        if (req.method === 'GET' && path === '/demo') {
            log('Running demo pipeline with sample messages...');
            const results = await runDemo();
            return sendJson(res, 200, { demo: true, results });
        }

        // ── POST /process ────────────────────────────────────────────────────
        if (req.method === 'POST' && path === '/process') {
            const body   = await readBody(req);
            const result = await runPipeline(body);
            log(`Done: status=${result.status} urgency=${result.classification.urgency} route=${result.classification.route}`);
            return sendJson(res, result.status === 'accepted' ? 200 : 422, result);
        }

        // ── POST /classify ───────────────────────────────────────────────────
        if (req.method === 'POST' && path === '/classify') {
            const body   = await readBody(req);
            const result = await classify(body);
            return sendJson(res, 200, result);
        }

        // ── POST /validate ───────────────────────────────────────────────────
        if (req.method === 'POST' && path === '/validate') {
            const body   = await readBody(req);
            const result = await validate(body);
            return sendJson(res, 200, result);
        }

        sendJson(res, 404, { error: 'Not found', path });

    } catch (err) {
        log('ERROR:', err.message);
        sendJson(res, 500, { error: err.message });
    }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
server.listen(config.server.port, config.server.host, () => {
    log(`HL7 AI Agent Layer started`);
    log(`  Port:      ${config.server.port}`);
    log(`  Mode:      ${config.stubMode ? 'STUB (offline demo)' : 'LIVE (watsonx.ai)'}`);
    log(`  Endpoints: /health  /demo  /process  /classify  /validate`);
});

module.exports = server; // export for tests
