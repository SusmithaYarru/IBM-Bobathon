/**
 * hl7Tools.js — LangChain-style tool definitions for the HL7 AI agents
 *
 * Each tool is a plain object with:
 *   name        — identifier used in the agent's tool-call response
 *   description — shown to the LLM so it understands when to call the tool
 *   parameters  — JSON Schema describing expected arguments
 *   execute     — async function that runs the tool's logic
 */

'use strict';

// ---------------------------------------------------------------------------
// Tool: extract_segment
// Pull a specific field from the parsed HL7 JSON payload
// ---------------------------------------------------------------------------
const extractSegmentTool = {
    name: 'extract_segment',
    description: 'Extract a specific HL7 segment field from the parsed message. ' +
                 'Use this to read MSH, PID, OBX, DG1 or other segment values.',
    parameters: {
        type: 'object',
        properties: {
            segment:   { type: 'string', description: 'Segment ID, e.g. PID, OBX' },
            fieldIndex:{ type: 'integer', description: '1-based field number' },
            compIndex: { type: 'integer', description: '1-based component number; 0 = whole field' },
        },
        required: ['segment', 'fieldIndex'],
    },
    execute: async ({ segment, fieldIndex, compIndex = 0 }, hl7Json) => {
        const segs = hl7Json._raw_segments || [];
        const match = segs.find(s => s.id === segment);
        if (!match) return { found: false, value: null };
        const fields = match.fields || [];
        const fv = fields[fieldIndex - 1] || '';
        if (compIndex === 0) return { found: true, value: fv };
        const parts = fv.split('^');
        return { found: true, value: parts[compIndex - 1] || '' };
    },
};

// ---------------------------------------------------------------------------
// Tool: classify_message_type
// Returns human-readable label and urgency for a message type/trigger pair
// ---------------------------------------------------------------------------
const KNOWN_TYPES = {
    'ADT^A01': { label: 'Patient Admission',         urgency: 'high'   },
    'ADT^A02': { label: 'Patient Transfer',          urgency: 'medium' },
    'ADT^A03': { label: 'Patient Discharge',         urgency: 'medium' },
    'ADT^A04': { label: 'Register Outpatient',       urgency: 'low'    },
    'ADT^A08': { label: 'Update Patient Info',       urgency: 'low'    },
    'ADT^A11': { label: 'Cancel Admission',          urgency: 'medium' },
    'ORU^R01': { label: 'Unsolicited Lab Result',    urgency: 'high'   },
    'ORM^O01': { label: 'New Medical Order',         urgency: 'medium' },
    'ACK':     { label: 'Acknowledgement',           urgency: 'none'   },
};

const classifyMessageTypeTool = {
    name: 'classify_message_type',
    description: 'Given an HL7 message type and trigger event code, return a ' +
                 'human-readable classification and urgency level.',
    parameters: {
        type: 'object',
        properties: {
            messageType:  { type: 'string' },
            triggerEvent: { type: 'string' },
        },
        required: ['messageType'],
    },
    execute: async ({ messageType, triggerEvent }) => {
        const key = triggerEvent ? `${messageType}^${triggerEvent}` : messageType;
        const result = KNOWN_TYPES[key] || KNOWN_TYPES[messageType];
        if (result) return { key, ...result, known: true };
        return {
            key,
            label: `Unknown message type: ${key}`,
            urgency: 'unknown',
            known: false,
        };
    },
};

// ---------------------------------------------------------------------------
// Tool: check_abnormal_flags
// Scans OBX segments for critical / abnormal result flags
// ---------------------------------------------------------------------------
const CRITICAL_FLAGS = new Set(['LL', 'HH', 'AA', 'AA+', 'AA-']);
const ABNORMAL_FLAGS = new Set(['L', 'H', 'A', 'U', 'D']);

const checkAbnormalFlagsTool = {
    name: 'check_abnormal_flags',
    description: 'Scan the OBX observation segments in an ORU message for ' +
                 'critical or abnormal result flags (LL, HH, H, L, AA etc.).',
    parameters: {
        type: 'object',
        properties: {
            observations: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        id:           { type: 'string' },
                        value:        { type: 'string' },
                        unit:         { type: 'string' },
                        abnormalFlag: { type: 'string' },
                    },
                },
            },
        },
        required: ['observations'],
    },
    execute: async ({ observations }) => {
        const criticals = [];
        const abnormals = [];
        for (const obs of observations) {
            const flag = (obs.abnormalFlag || '').toUpperCase();
            if (CRITICAL_FLAGS.has(flag)) criticals.push(obs);
            else if (ABNORMAL_FLAGS.has(flag)) abnormals.push(obs);
        }
        return {
            hasCritical: criticals.length > 0,
            hasAbnormal: abnormals.length > 0,
            criticalResults: criticals,
            abnormalResults: abnormals,
        };
    },
};

// ---------------------------------------------------------------------------
// Tool: format_patient_summary
// Produces a one-line human-readable patient identifier string
// ---------------------------------------------------------------------------
const formatPatientSummaryTool = {
    name: 'format_patient_summary',
    description: 'Format patient demographics into a concise human-readable summary.',
    parameters: {
        type: 'object',
        properties: {
            patientId:   { type: 'string' },
            patientName: { type: 'string' },
            dob:         { type: 'string' },
            sex:         { type: 'string' },
        },
        required: ['patientId'],
    },
    execute: async ({ patientId, patientName, dob, sex }) => {
        const parts = [`ID: ${patientId}`];
        if (patientName && patientName.trim() !== ' ') parts.push(`Name: ${patientName.trim()}`);
        if (dob)  parts.push(`DOB: ${dob}`);
        if (sex)  parts.push(`Sex: ${sex}`);
        return { summary: parts.join(' | ') };
    },
};

// ---------------------------------------------------------------------------
// Export tool registry
// ---------------------------------------------------------------------------
module.exports = {
    extractSegmentTool,
    classifyMessageTypeTool,
    checkAbnormalFlagsTool,
    formatPatientSummaryTool,

    /** All tools as an array — used when registering with an LLM call */
    all: [
        extractSegmentTool,
        classifyMessageTypeTool,
        checkAbnormalFlagsTool,
        formatPatientSummaryTool,
    ],
};
