/**
 * fhirTools.js — FHIR R4 lookup stubs for the Enrichment Agent
 *
 * In a production deployment these would call a real FHIR server
 * (e.g. IBM FHIR Server, Azure Health Data Services, or AWS HealthLake).
 * For the hackathon demo they return realistic synthetic data so the full
 * agentic flow can be demonstrated without any external dependencies.
 */

'use strict';

const config = require('../config');

// ---------------------------------------------------------------------------
// Synthetic patient master (keyed by MRN)
// ---------------------------------------------------------------------------
const PATIENT_STORE = {
    'MRN001': {
        resourceType: 'Patient',
        id: 'MRN001',
        name: [{ family: 'Smith', given: ['John', 'D'] }],
        birthDate: '1968-04-15',
        gender: 'male',
        address: [{ city: 'Chicago', state: 'IL', postalCode: '60601' }],
        telecom: [{ system: 'phone', value: '312-555-0101' }],
        allergies: ['Penicillin', 'Sulfa'],
        conditions: ['Hypertension', 'Type 2 Diabetes'],
    },
    'MRN002': {
        resourceType: 'Patient',
        id: 'MRN002',
        name: [{ family: 'Johnson', given: ['Maria'] }],
        birthDate: '1992-11-30',
        gender: 'female',
        address: [{ city: 'Boston', state: 'MA', postalCode: '02101' }],
        telecom: [{ system: 'phone', value: '617-555-0202' }],
        allergies: [],
        conditions: ['Asthma'],
    },
};

// ---------------------------------------------------------------------------
// Tool: lookup_patient
// ---------------------------------------------------------------------------
const lookupPatientTool = {
    name: 'lookup_patient',
    description: 'Look up a patient record in the FHIR server by MRN. ' +
                 'Returns demographics, known allergies, and active conditions.',
    parameters: {
        type: 'object',
        properties: {
            mrn: { type: 'string', description: 'Medical Record Number' },
        },
        required: ['mrn'],
    },
    execute: async ({ mrn }) => {
        // Stub — simulate a 50ms FHIR API call
        await sleep(50);
        const patient = PATIENT_STORE[mrn];
        if (!patient) {
            return { found: false, mrn, message: 'Patient not found in FHIR server' };
        }
        return { found: true, patient };
    },
};

// ---------------------------------------------------------------------------
// Tool: get_prior_encounters
// ---------------------------------------------------------------------------
const ENCOUNTER_STORE = {
    'MRN001': [
        { date: '2024-01-10', type: 'Emergency', reason: 'Chest pain — resolved' },
        { date: '2023-08-22', type: 'Outpatient', reason: 'HbA1c check' },
    ],
    'MRN002': [
        { date: '2024-03-05', type: 'Outpatient', reason: 'Asthma follow-up' },
    ],
};

const getPriorEncountersTool = {
    name: 'get_prior_encounters',
    description: 'Retrieve a summary of a patient\'s prior encounters from the FHIR server. ' +
                 'Useful for context enrichment before routing an ADT or ORU message.',
    parameters: {
        type: 'object',
        properties: {
            mrn:   { type: 'string' },
            limit: { type: 'integer', description: 'Max number of encounters to return', default: 5 },
        },
        required: ['mrn'],
    },
    execute: async ({ mrn, limit = 5 }) => {
        await sleep(50);
        const encounters = (ENCOUNTER_STORE[mrn] || []).slice(0, limit);
        return { mrn, encounters, count: encounters.length };
    },
};

// ---------------------------------------------------------------------------
// Tool: check_drug_allergy
// ---------------------------------------------------------------------------
const lookupDrugAllergyTool = {
    name: 'check_drug_allergy',
    description: 'Check whether a patient has a documented allergy to a given medication.',
    parameters: {
        type: 'object',
        properties: {
            mrn:  { type: 'string' },
            drug: { type: 'string', description: 'Drug name to check' },
        },
        required: ['mrn', 'drug'],
    },
    execute: async ({ mrn, drug }) => {
        await sleep(30);
        const patient = PATIENT_STORE[mrn];
        if (!patient) return { found: false, hasAllergy: false };
        const allergies = patient.allergies || [];
        const hasAllergy = allergies.some(
            a => a.toLowerCase().includes(drug.toLowerCase())
        );
        return { found: true, mrn, drug, hasAllergy, knownAllergies: allergies };
    },
};

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    lookupPatientTool,
    getPriorEncountersTool,
    lookupDrugAllergyTool,

    all: [lookupPatientTool, getPriorEncountersTool, lookupDrugAllergyTool],
};
