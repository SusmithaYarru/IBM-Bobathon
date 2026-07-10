/**
 * EnrichmentAgent.js
 *
 * Enriches the parsed HL7 JSON with contextual data from FHIR:
 *   - Full patient demographics
 *   - Prior encounter history
 *   - Known drug allergies (cross-checked against ORM orders)
 *
 * Enriched fields are merged into the hl7Json object under "enrichment".
 * The agent uses a simple ReAct-style loop: it calls tools, observes results,
 * and stops when it has collected all necessary context.
 */

'use strict';

const config = require('../config');
const { lookupPatientTool, getPriorEncountersTool, lookupDrugAllergyTool } = require('../tools/fhirTools');

// ---------------------------------------------------------------------------
// Main enrich function
// ---------------------------------------------------------------------------
async function enrich(hl7Json) {
    const mrn     = hl7Json.patientId || '';
    const msgType = hl7Json.messageType || '';
    const result  = {
        patientRecord:    null,
        priorEncounters:  [],
        allergyAlerts:    [],
        enrichedAt:       new Date().toISOString(),
    };

    if (!mrn) {
        result.note = 'No patient MRN available — skipping FHIR enrichment.';
        return result;
    }

    // ── Step 1: Patient lookup ──────────────────────────────────────────────
    const patResult = await lookupPatientTool.execute({ mrn });
    if (patResult.found) {
        result.patientRecord = patResult.patient;
    } else {
        result.note = `Patient MRN '${mrn}' not found in FHIR server.`;
    }

    // ── Step 2: Prior encounters (ADT and ORU messages benefit most) ────────
    if (['ADT', 'ORU'].includes(msgType)) {
        const encResult = await getPriorEncountersTool.execute({ mrn, limit: 3 });
        result.priorEncounters = encResult.encounters;
    }

    // ── Step 3: Drug allergy check (ORM orders only) ────────────────────────
    if (msgType === 'ORM') {
        // Extract ordered drug from ORC/RXO segments (stub: from jsonSummary field)
        const orderedDrugs = extractOrderedDrugs(hl7Json);
        for (const drug of orderedDrugs) {
            const allergyResult = await lookupDrugAllergyTool.execute({ mrn, drug });
            if (allergyResult.hasAllergy) {
                result.allergyAlerts.push({
                    drug,
                    severity: 'critical',
                    message: `Patient ${mrn} has a documented allergy to ${drug}. Order requires pharmacist review.`,
                });
            }
        }
    }

    return result;
}

// ---------------------------------------------------------------------------
// Extract drug names from ORM message (heuristic for demo)
// ---------------------------------------------------------------------------
function extractOrderedDrugs(hl7Json) {
    // In a real implementation this reads ORC-4 / RXO-1
    // For the demo, simulate a Penicillin order for patient MRN001
    if (hl7Json.patientId === 'MRN001') return ['Penicillin'];
    return [];
}

module.exports = { enrich };
