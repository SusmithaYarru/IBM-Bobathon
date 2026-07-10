/**
 * agent-test.js — Jest tests for the AI Agent layer
 *
 * Tests run fully in stub mode (no external API calls, no ACE required).
 * Cover: ClassifierAgent, ValidatorAgent, EnrichmentAgent, SummaryAgent.
 */

'use strict';

// Force stub mode for all tests
process.env.WATSONX_STUB = 'true';

const { classify }  = require('../agent/agents/ClassifierAgent');
const { validate }  = require('../agent/agents/ValidatorAgent');
const { enrich }    = require('../agent/agents/EnrichmentAgent');
const { summarise } = require('../agent/agents/SummaryAgent');
const samples       = require('../agent/demo-samples');

// ─── Fixtures ────────────────────────────────────────────────────────────────
const ADT_MSG  = samples[0];   // ADT^A01
const ORU_MSG  = samples[1];   // ORU^R01 with HH flag
const ORM_MSG  = samples[2];   // ORM^O01 Penicillin (allergy)

// =============================================================================
// ClassifierAgent
// =============================================================================
describe('ClassifierAgent', () => {

    test('ADT^A01 classified as high urgency and routed to adt-queue', async () => {
        const result = await classify(ADT_MSG);
        expect(result.messageType).toBe('ADT');
        expect(result.triggerEvent).toBe('A01');
        expect(result.urgency).toMatch(/high|critical/);
        expect(result.route).toBe('adt-queue');
        expect(result.label).toContain('Admission');
    });

    test('ORU^R01 with HH flag escalated to critical urgency', async () => {
        const result = await classify(ORU_MSG);
        expect(result.urgency).toBe('critical');
        expect(result.route).toBe('critical-alert-queue');
        expect(result.hasCriticalFlags).toBe(true);
        expect(result.criticalResults.length).toBeGreaterThan(0);
        expect(result.criticalResults[0].id).toBe('POTASSIUM');
    });

    test('ORM^O01 classified as medium urgency', async () => {
        const result = await classify(ORM_MSG);
        expect(result.messageType).toBe('ORM');
        expect(result.urgency).toBe('medium');
        expect(result.route).toBe('orders-api');
    });

    test('Unknown message type routed to dead-letter-queue', async () => {
        const result = await classify({ messageType: 'ZZZ', triggerEvent: 'Q99', observations: [] });
        expect(result.urgency).toBe('unknown');
        expect(result.route).toBe('dead-letter-queue');
    });

});

// =============================================================================
// ValidatorAgent
// =============================================================================
describe('ValidatorAgent', () => {

    test('Valid ADT^A01 passes validation with zero errors', async () => {
        const result = await validate(ADT_MSG);
        expect(result.isValid).toBe(true);
        expect(result.errorCount).toBe(0);
    });

    test('Valid ORU^R01 passes validation', async () => {
        const result = await validate(ORU_MSG);
        expect(result.isValid).toBe(true);
    });

    test('Missing MSH-9 fails validation with error', async () => {
        const broken = {
            ...ADT_MSG,
            _raw_segments: ADT_MSG._raw_segments.map(s => {
                if (s.id !== 'MSH') return s;
                const fields = [...s.fields];
                fields[7] = '';  // MSH-9 = field index 8 (0-based: 7)
                return { ...s, fields };
            }),
        };
        const result = await validate(broken);
        expect(result.isValid).toBe(false);
        expect(result.errorCount).toBeGreaterThan(0);
        const fieldNames = result.issues.map(i => i.field);
        expect(fieldNames.some(f => f.includes('MSH-9'))).toBe(true);
    });

    test('Missing PID-5 family name fails validation', async () => {
        const broken = {
            ...ADT_MSG,
            _raw_segments: ADT_MSG._raw_segments.map(s => {
                if (s.id !== 'PID') return s;
                const fields = [...s.fields];
                fields[4] = '';  // PID-5 = fields[4] (0-based: PID-1=0...PID-5=4)
                return { ...s, fields };
            }),
        };
        const result = await validate(broken);
        expect(result.isValid).toBe(false);
        const fieldNames = result.issues.map(i => i.field);
        expect(fieldNames.some(f => f.includes('PID-5'))).toBe(true);
    });

    test('Issues array has severity and message properties', async () => {
        const result = await validate(ADT_MSG);
        for (const issue of result.issues) {
            expect(issue).toHaveProperty('severity');
            expect(issue).toHaveProperty('field');
            expect(issue).toHaveProperty('message');
        }
    });

});

// =============================================================================
// EnrichmentAgent
// =============================================================================
describe('EnrichmentAgent', () => {

    test('ADT message enriched with patient record and prior encounters', async () => {
        const result = await enrich(ADT_MSG);
        expect(result.patientRecord).not.toBeNull();
        expect(result.patientRecord.id).toBe('MRN001');
        expect(result.priorEncounters.length).toBeGreaterThan(0);
    });

    test('ORM message with Penicillin order triggers allergy alert for MRN001', async () => {
        const result = await enrich(ORM_MSG);
        expect(result.allergyAlerts.length).toBeGreaterThan(0);
        expect(result.allergyAlerts[0].drug).toBe('Penicillin');
        expect(result.allergyAlerts[0].severity).toBe('critical');
    });

    test('Unknown MRN returns note without crashing', async () => {
        const result = await enrich({ patientId: 'MRN-UNKNOWN', messageType: 'ADT' });
        expect(result.patientRecord).toBeNull();
        expect(result.note).toMatch(/not found/i);
    });

    test('Missing MRN skips enrichment gracefully', async () => {
        const result = await enrich({ messageType: 'ORU' });
        expect(result.note).toMatch(/No patient MRN/i);
    });

});

// =============================================================================
// SummaryAgent — stub mode smoke tests
// =============================================================================
describe('SummaryAgent', () => {

    test('ADT^A01 summary includes event type and patient info', async () => {
        const cls = await classify(ADT_MSG);
        const val = await validate(ADT_MSG);
        const enr = await enrich(ADT_MSG);
        const sum = await summarise(ADT_MSG, cls, val, enr);

        expect(typeof sum).toBe('string');
        expect(sum.length).toBeGreaterThan(50);
        expect(sum).toMatch(/ADT|Admission/i);
    });

    test('ORU^R01 summary flags critical result', async () => {
        const cls = await classify(ORU_MSG);
        const val = await validate(ORU_MSG);
        const enr = await enrich(ORU_MSG);
        const sum = await summarise(ORU_MSG, cls, val, enr);

        expect(sum).toMatch(/CRITICAL|critical/i);
        expect(sum).toMatch(/POTASSIUM|potassium/i);
    });

    test('ORM^O01 summary includes allergy alert', async () => {
        const cls = await classify(ORM_MSG);
        const val = await validate(ORM_MSG);
        const enr = await enrich(ORM_MSG);
        const sum = await summarise(ORM_MSG, cls, val, enr);

        expect(sum).toMatch(/ALLERGY|allergy/i);
    });

});
