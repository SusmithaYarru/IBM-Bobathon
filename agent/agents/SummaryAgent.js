/**
 * SummaryAgent.js
 *
 * Generates a human-readable clinical event summary from the combined
 * HL7 parse result, classification, validation, and enrichment data.
 *
 * The summary is intended for:
 *   - Nursing/clinical staff notifications
 *   - Audit log entries
 *   - Dashboard display in the hackathon demo
 *
 * In stub mode: uses a template engine for instant demo output.
 * In live mode:  uses IBM watsonx Granite with a clinical summarisation prompt.
 */

'use strict';

const config          = require('../config');
const { callWatsonx } = require('./watsonxClient');

// ---------------------------------------------------------------------------
// Main summarise function
// ---------------------------------------------------------------------------
async function summarise(hl7Json, classification, validation, enrichment) {
    if (config.stubMode) {
        return buildStubSummary(hl7Json, classification, validation, enrichment);
    }
    return buildLlmSummary(hl7Json, classification, validation, enrichment);
}

// ---------------------------------------------------------------------------
// Stub summary — deterministic template-based output
// ---------------------------------------------------------------------------
function buildStubSummary(hl7Json, cls, val, enr) {
    const pt = enr && enr.patientRecord;
    const ptName = pt
        ? `${pt.name[0].given.join(' ')} ${pt.name[0].family}`
        : hl7Json.patientName || 'Unknown Patient';
    const ptId   = hl7Json.patientId || 'N/A';

    const lines = [];

    // Header
    lines.push(`=== HL7 Clinical Event Summary ===`);
    lines.push(`Event:    ${cls.label} (${hl7Json.messageType}^${hl7Json.triggerEvent || ''})`);
    lines.push(`Urgency:  ${cls.urgency.toUpperCase()}`);
    lines.push(`Patient:  ${ptName} | MRN: ${ptId}`);

    if (pt) {
        const dob  = pt.birthDate || 'N/A';
        const sex  = pt.gender    || 'N/A';
        lines.push(`DOB: ${dob} | Sex: ${sex}`);
        if (pt.conditions && pt.conditions.length) {
            lines.push(`Conditions: ${pt.conditions.join(', ')}`);
        }
        if (pt.allergies && pt.allergies.length) {
            lines.push(`Allergies:  ${pt.allergies.join(', ')}`);
        }
    }

    lines.push('');

    // Validation
    if (val.errorCount > 0) {
        lines.push(`⚠ Validation Errors (${val.errorCount}):`);
        val.issues.filter(i => i.severity === 'error').forEach(i => {
            lines.push(`  - [${i.field}] ${i.message}`);
        });
    } else {
        lines.push(`✓ Message passed validation (${val.warningCount} warning(s)).`);
    }

    lines.push('');

    // Critical flags
    if (cls.hasCriticalFlags) {
        lines.push(`🚨 CRITICAL LAB RESULTS:`);
        cls.criticalResults.forEach(r => {
            lines.push(`  - ${r.id}: ${r.value} ${r.unit} [Flag: ${r.abnormalFlag}]`);
        });
        lines.push('');
    }

    // Allergy alerts
    if (enr && enr.allergyAlerts && enr.allergyAlerts.length) {
        lines.push(`🚨 ALLERGY ALERT:`);
        enr.allergyAlerts.forEach(a => lines.push(`  - ${a.message}`));
        lines.push('');
    }

    // Prior encounters
    if (enr && enr.priorEncounters && enr.priorEncounters.length) {
        lines.push(`Prior Encounters:`);
        enr.priorEncounters.forEach(e => {
            lines.push(`  - ${e.date} | ${e.type} | ${e.reason}`);
        });
        lines.push('');
    }

    // Route
    lines.push(`Routing:  → ${cls.route}`);
    lines.push(`Reason:   ${cls.reason}`);
    lines.push(`Control:  ${hl7Json.messageControlId || 'N/A'}`);
    lines.push(`GeneratedAt: ${new Date().toISOString()}`);

    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// LLM summary via IBM watsonx.ai
// ---------------------------------------------------------------------------
async function buildLlmSummary(hl7Json, cls, val, enr) {
    const context = {
        message:        hl7Json,
        classification: cls,
        validation:     { isValid: val.isValid, errorCount: val.errorCount, issues: val.issues },
        enrichment:     enr,
    };

    const prompt = `You are a clinical informatics assistant generating a concise event notification for hospital staff.

Based on the following HL7 event data, write a professional 3–5 sentence clinical summary that includes:
1. What happened (event type and patient identity)
2. Any urgent clinical findings (critical labs, allergy conflicts)
3. Validation status
4. Routing destination and next steps

Event data:
${JSON.stringify(context, null, 2)}

Clinical Summary:`;

    return callWatsonx(prompt);
}

module.exports = { summarise };
