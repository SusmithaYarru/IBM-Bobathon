/**
 * ValidatorAgent.js
 *
 * AI-assisted HL7 message validation.
 *
 * Two-tier approach:
 *   Tier 1 (rule-based) — deterministic required-field checks. Always runs.
 *   Tier 2 (AI-assisted) — sends context to watsonx.ai for nuanced checks
 *                          such as ICD-10 code format, plausible date ranges,
 *                          and segment-ordering issues. Runs in live mode only.
 *
 * Returns a structured ValidationResult object that the agent router uses
 * to decide whether to accept, warn, or reject the message.
 */

'use strict';

const config       = require('../config');
const { callWatsonx } = require('./watsonxClient');

// ---------------------------------------------------------------------------
// Required field rules: [segmentId, fieldIndex (1-based), description]
// ---------------------------------------------------------------------------
const REQUIRED_FIELDS = [
    // MSH required fields
    { seg: 'MSH', field: 3,  desc: 'MSH-3 Sending Application' },
    { seg: 'MSH', field: 4,  desc: 'MSH-4 Sending Facility' },
    { seg: 'MSH', field: 9,  desc: 'MSH-9 Message Type' },
    { seg: 'MSH', field: 10, desc: 'MSH-10 Message Control ID' },
    { seg: 'MSH', field: 11, desc: 'MSH-11 Processing ID' },
    { seg: 'MSH', field: 12, desc: 'MSH-12 Version ID' },
];

// PID offset: fields[0]=PID-1 set-id, fields[1]=PID-2(deprecated), fields[2]=PID-3, fields[4]=PID-5
// so 0-based array index = hl7FieldNumber - 1
const PID_REQUIRED = [
    { field: 3, desc: 'PID-3 Patient Identifier' },  // fields[2]
    { field: 5, desc: 'PID-5 Patient Name' },         // fields[4]
];

// ---------------------------------------------------------------------------
// Main validate function
// ---------------------------------------------------------------------------
async function validate(hl7Json) {
    const issues   = [];
    const segments = hl7Json._raw_segments || [];
    const segIndex = buildSegmentIndex(segments);

    // ── Tier 1: Rule-based ─────────────────────────────────────────────────
    // MSH required fields
    const msh = segIndex['MSH'] ? segIndex['MSH'][0] : null;
    for (const rule of REQUIRED_FIELDS) {
        const val = msh ? (msh.fields[rule.field - 2] || '') : '';
        if (!val.trim()) {
            issues.push({ severity: 'error', field: rule.desc, message: `${rule.desc} is required but missing.` });
        }
    }

    // PID required fields (only if PID segment present)
    const pid = segIndex['PID'] ? segIndex['PID'][0] : null;
    if (pid) {
        for (const rule of PID_REQUIRED) {
                const val = pid.fields[rule.field - 1] || '';
            if (!val.trim()) {
                issues.push({ severity: 'error', field: rule.desc, message: `${rule.desc} is required but missing.` });
            }
        }

        // PID-7 DOB format check (yyyyMMdd or yyyyMMddHHmmss)
        // PID-7 = fields[6] (0-based: PID-1=0, PID-2=1, ... PID-7=6)
        const dob = (pid.fields[6] || '').trim();
        if (dob && !/^\d{8}(\d{6})?$/.test(dob)) {
            issues.push({ severity: 'warning', field: 'PID-7', message: `PID-7 Date of Birth '${dob}' is not in yyyyMMdd format.` });
        }

        // PID-8 sex code — allow M/F/O/U/A/N/C per HL7 v2 table 0001
        // PID-8 = fields[7]
        const sex = (pid.fields[7] || '').trim().toUpperCase();
        const validSex = new Set(['M', 'F', 'O', 'U', 'A', 'N', 'C', '']);
        if (sex && !validSex.has(sex)) {
            issues.push({ severity: 'warning', field: 'PID-8', message: `PID-8 Administrative Sex '${sex}' is not a recognised HL7 v2 value.` });
        }
    }

    // OBR required for ORM messages
    if (hl7Json.messageType === 'ORM') {
        const obr = segIndex['OBR'] ? segIndex['OBR'][0] : null;
        if (!obr) {
            issues.push({ severity: 'warning', field: 'OBR', message: 'OBR segment expected in ORM message but not found.' });
        }
    }

    // ── Tier 2: AI-assisted checks (live mode only) ────────────────────────
    let aiFindings = [];
    if (!config.stubMode && issues.length === 0) {
        // Only call AI if tier 1 passes (avoid noise on obviously broken msgs)
        aiFindings = await aiValidate(hl7Json);
    } else if (config.stubMode) {
        aiFindings = buildStubAiFindings(hl7Json);
    }

    const allIssues = [...issues, ...aiFindings];
    const errors    = allIssues.filter(i => i.severity === 'error');
    const warnings  = allIssues.filter(i => i.severity === 'warning');

    return {
        isValid:       errors.length === 0,
        errorCount:    errors.length,
        warningCount:  warnings.length,
        issues:        allIssues,
        timestamp:     new Date().toISOString(),
    };
}

// ---------------------------------------------------------------------------
// AI-assisted validation via watsonx.ai
// ---------------------------------------------------------------------------
async function aiValidate(hl7Json) {
    const prompt = `You are an HL7 v2.x message validator.
Review the following parsed HL7 message and identify any data quality issues beyond basic required-field checks.
Look for: invalid ICD-10 formats in DG1, implausible dates, mismatched message type vs segment structure, missing OBX units in ORU messages.
Return a JSON array of findings. Each finding has: severity ("error"|"warning"), field (e.g. "DG1-3"), message (short description).
If no issues found, return [].

HL7 Message:
${JSON.stringify(hl7Json, null, 2)}

JSON array:`;

    try {
        const raw = await callWatsonx(prompt);
        // Extract JSON array from LLM response
        const match = raw.match(/\[[\s\S]*\]/);
        if (match) return JSON.parse(match[0]);
    } catch (_) { /* AI finding parse failure is non-fatal */ }
    return [];
}

// ---------------------------------------------------------------------------
// Stub AI findings
// ---------------------------------------------------------------------------
function buildStubAiFindings(hl7Json) {
    const findings = [];
    // Check diagnoses for ICD-10 format (stub rule: must start with letter + digit)
    for (const dx of (hl7Json.diagnoses || [])) {
        if (dx.code && !/^[A-Z]\d/.test(dx.code)) {
            findings.push({
                severity: 'warning',
                field: 'DG1-3',
                message: `Diagnosis code '${dx.code}' does not appear to be a valid ICD-10 format.`,
            });
        }
    }
    return findings;
}

// ---------------------------------------------------------------------------
// Build a segment index: { 'PID': [seg, ...], 'OBX': [seg, ...] }
// ---------------------------------------------------------------------------
function buildSegmentIndex(segments) {
    const idx = {};
    for (const seg of segments) {
        if (!idx[seg.id]) idx[seg.id] = [];
        idx[seg.id].push(seg);
    }
    return idx;
}

module.exports = { validate };
