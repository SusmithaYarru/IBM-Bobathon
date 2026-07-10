/**
 * ClassifierAgent.js
 *
 * Analyses an incoming HL7 JSON payload and determines:
 *   1. The canonical message classification (human-readable label)
 *   2. Urgency level:  critical | high | medium | low | none
 *   3. Recommended routing target
 *   4. A one-sentence reason for the classification
 *
 * In live mode:  calls IBM watsonx.ai (Granite) with a structured prompt.
 * In stub mode:  returns deterministic canned output based on messageType.
 */

'use strict';

const config = require('../config');
const { classifyMessageTypeTool, checkAbnormalFlagsTool } = require('../tools/hl7Tools');
const { callWatsonx } = require('./watsonxClient');

// ---------------------------------------------------------------------------
// Stub responses for offline demo
// ---------------------------------------------------------------------------
const STUB_CLASSIFICATIONS = {
    'ADT': {
        A01: { label: 'Patient Admission',  urgency: 'high',   route: 'adt-queue',     reason: 'New inpatient admission — notify bed management.' },
        A03: { label: 'Patient Discharge',  urgency: 'medium', route: 'adt-queue',     reason: 'Discharge event — update census and billing.' },
        A08: { label: 'Update Demographics',urgency: 'low',    route: 'adt-queue',     reason: 'Administrative demographics update.' },
        DEFAULT: { label: 'ADT Event',      urgency: 'medium', route: 'adt-queue',     reason: 'General ADT event.' },
    },
    'ORU': {
        R01: { label: 'Lab Result',         urgency: 'high',   route: 'results-db',    reason: 'Unsolicited observation — check for critical flags.' },
        DEFAULT: { label: 'Observation',    urgency: 'medium', route: 'results-db',    reason: 'Observation result.' },
    },
    'ORM': {
        O01: { label: 'Medical Order',      urgency: 'medium', route: 'orders-api',    reason: 'New order — validate and forward to pharmacy/lab.' },
        DEFAULT: { label: 'Order',          urgency: 'medium', route: 'orders-api',    reason: 'General order message.' },
    },
    DEFAULT: { label: 'Unknown',            urgency: 'unknown',route: 'dead-letter',   reason: 'Unrecognised message type — routed to dead-letter queue.' },
};

// ---------------------------------------------------------------------------
// Main classifier function
// ---------------------------------------------------------------------------
async function classify(hl7Json) {
    const msgType  = hl7Json.messageType   || '';
    const evtCode  = hl7Json.triggerEvent  || '';
    const obs      = hl7Json.observations  || [];

    // Step 1: tool-based classification (no LLM needed for known types)
    const typeResult = await classifyMessageTypeTool.execute({
        messageType:  msgType,
        triggerEvent: evtCode,
    });

    // Step 2: check for critical observation flags (ORU messages)
    let flagResult = { hasCritical: false, hasAbnormal: false, criticalResults: [], abnormalResults: [] };
    if (obs.length > 0) {
        flagResult = await checkAbnormalFlagsTool.execute({ observations: obs });
    }

    // Escalate urgency if critical lab flags found
    let urgency = typeResult.urgency;
    if (flagResult.hasCritical) urgency = 'critical';
    else if (flagResult.hasAbnormal && urgency !== 'critical') urgency = 'high';

    // Step 3: determine routing target
    const route = resolveRoute(msgType, urgency, flagResult);

    // Step 4: generate explanation
    let reason;
    if (config.stubMode) {
        reason = buildStubReason(msgType, evtCode, flagResult);
    } else {
        reason = await llmReason(hl7Json, typeResult, flagResult);
    }

    return {
        messageType:      msgType,
        triggerEvent:     evtCode,
        label:            typeResult.label,
        urgency,
        route,
        reason,
        hasCriticalFlags: flagResult.hasCritical,
        criticalResults:  flagResult.criticalResults,
        abnormalResults:  flagResult.abnormalResults,
        timestamp:        new Date().toISOString(),
    };
}

// ---------------------------------------------------------------------------
// Routing logic
// ---------------------------------------------------------------------------
function resolveRoute(msgType, urgency, flagResult) {
    if (urgency === 'critical') return 'critical-alert-queue';
    const routes = { ADT: 'adt-queue', ORU: 'results-db', ORM: 'orders-api' };
    return routes[msgType] || 'dead-letter-queue';
}

// ---------------------------------------------------------------------------
// Stub reason builder
// ---------------------------------------------------------------------------
function buildStubReason(msgType, evtCode, flagResult) {
    const typeMap = STUB_CLASSIFICATIONS[msgType] || STUB_CLASSIFICATIONS.DEFAULT;
    const evtMap  = (typeof typeMap === 'object' && typeMap[evtCode]) ||
                    (typeof typeMap === 'object' && typeMap.DEFAULT) ||
                    STUB_CLASSIFICATIONS.DEFAULT;

    let base = evtMap.reason;
    if (flagResult.hasCritical) {
        const ids = flagResult.criticalResults.map(r => r.id).join(', ');
        base += ` CRITICAL flag detected in observation(s): ${ids}. Escalated to critical-alert-queue.`;
    } else if (flagResult.hasAbnormal) {
        const ids = flagResult.abnormalResults.map(r => r.id).join(', ');
        base += ` Abnormal results found: ${ids}.`;
    }
    return base;
}

// ---------------------------------------------------------------------------
// LLM-based reason via watsonx.ai
// ---------------------------------------------------------------------------
async function llmReason(hl7Json, typeResult, flagResult) {
    const critInfo = flagResult.hasCritical
        ? `Critical lab flags detected: ${flagResult.criticalResults.map(r => r.id + '=' + r.value).join(', ')}.`
        : '';

    const prompt = `You are a clinical informatics assistant.
Given the following HL7 message summary, write ONE concise sentence explaining why this message is classified as ${typeResult.label} with ${typeResult.urgency} urgency and what action should be taken.

Message: ${JSON.stringify(hl7Json, null, 2)}
${critInfo}

Response (one sentence):`;

    return callWatsonx(prompt);
}

module.exports = { classify };
