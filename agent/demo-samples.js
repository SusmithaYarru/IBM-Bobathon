/**
 * demo-samples.js
 *
 * Pre-parsed HL7 JSON payloads used by GET /demo and Jest tests.
 * These mirror what HL7SegmentParser.java would produce from real HL7 messages.
 */

'use strict';

module.exports = [
    // ── ADT^A01 Patient Admission ─────────────────────────────────────────
    {
        messageType:      'ADT',
        triggerEvent:     'A01',
        messageControlId: 'CTRL-20240601-001',
        patientId:        'MRN001',
        patientName:      'John D Smith',
        segmentIds:       ['MSH', 'EVN', 'PID', 'PV1'],
        observations:     [],
        diagnoses:        [{ code: 'I10', description: 'Essential hypertension' }],
        _raw_segments: [
            { id: 'MSH', fields: ['^~\\&', 'EHR_SYSTEM', 'HOSP-A', 'ACE-HL7-KIT', 'IBM-ACE',
                                   '20240601120000', '', 'ADT^A01', 'CTRL-20240601-001', 'P', '2.5.1'] },
            { id: 'EVN', fields: ['A01', '20240601120000', '', '', '', ''] },
            { id: 'PID', fields: ['1', '', 'MRN001^^^HOSP-A^MR', '', 'Smith^John^D', '',
                                   '19680415', 'M', '', '', '123 Main St^^Chicago^IL^60601^USA'] },
            { id: 'PV1', fields: ['1', 'I', 'WARD-3^BED-12^^HOSP-A', 'E', '', '', 'DR-987^Jones^Sarah'] },
            { id: 'DG1', fields: ['1', '', 'I10', 'Essential hypertension', '', 'A'] },
        ],
    },

    // ── ORU^R01 Lab Result with CRITICAL flag ─────────────────────────────
    {
        messageType:      'ORU',
        triggerEvent:     'R01',
        messageControlId: 'CTRL-20240601-002',
        patientId:        'MRN001',
        patientName:      'John D Smith',
        segmentIds:       ['MSH', 'PID', 'OBR', 'OBX'],
        observations: [
            { id: 'POTASSIUM',   value: '6.8', unit: 'mmol/L', abnormalFlag: 'HH' },
            { id: 'SODIUM',      value: '138', unit: 'mmol/L', abnormalFlag: ''   },
            { id: 'CREATININE',  value: '2.1', unit: 'mg/dL',  abnormalFlag: 'H'  },
        ],
        diagnoses: [],
        _raw_segments: [
            { id: 'MSH', fields: ['^~\\&', 'LAB_SYSTEM', 'HOSP-A', 'ACE-HL7-KIT', 'IBM-ACE',
                                   '20240601130000', '', 'ORU^R01', 'CTRL-20240601-002', 'P', '2.5.1'] },
            { id: 'PID', fields: ['1', '', 'MRN001^^^HOSP-A^MR', '', 'Smith^John^D', '', '19680415', 'M'] },
            { id: 'OBR', fields: ['1', 'ORD-5001', '', 'CHEM7^Basic Metabolic Panel'] },
            { id: 'OBX', fields: ['1', 'NM', 'POTASSIUM^Potassium', '', '6.8', 'mmol/L', '3.5-5.0', 'HH', '', 'F'] },
            { id: 'OBX', fields: ['2', 'NM', 'SODIUM^Sodium',       '', '138',  'mmol/L', '136-145', '',   '', 'F'] },
            { id: 'OBX', fields: ['3', 'NM', 'CREATININE^Creatinine','','2.1', 'mg/dL',  '0.7-1.2', 'H',  '', 'F'] },
        ],
    },

    // ── ORM^O01 Medical Order with drug allergy conflict ──────────────────
    {
        messageType:      'ORM',
        triggerEvent:     'O01',
        messageControlId: 'CTRL-20240601-003',
        patientId:        'MRN001',
        patientName:      'John D Smith',
        segmentIds:       ['MSH', 'PID', 'ORC', 'OBR'],
        observations:     [],
        diagnoses:        [],
        _raw_segments: [
            { id: 'MSH', fields: ['^~\\&', 'ORDER_SYSTEM', 'HOSP-A', 'ACE-HL7-KIT', 'IBM-ACE',
                                   '20240601140000', '', 'ORM^O01', 'CTRL-20240601-003', 'P', '2.5.1'] },
            { id: 'PID', fields: ['1', '', 'MRN001^^^HOSP-A^MR', '', 'Smith^John^D', '', '19680415', 'M'] },
            { id: 'ORC', fields: ['NW', 'ORD-6001', '', '', 'IP', '', '', '', '20240601140000'] },
            { id: 'OBR', fields: ['1', 'ORD-6001', '', 'PENICILLIN^Penicillin G 500mg PO BID'] },
        ],
    },
];
