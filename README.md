# 🏥 HL7 Enablement Starter Kit for IBM App Connect Enterprise (ACE)
### Agentic AI–Driven Healthcare Messaging — Hackathon Edition

---

## Overview

IBM App Connect Enterprise (ACE) does **not** provide native HL7 v2.x parsing or validation support out of the box. This starter kit bridges that gap by implementing a lightweight, reusable HL7 processing layer on top of ACE using:

- **Custom ESQL** for HL7 segment tokenisation inside ACE message flows
- **Java Compute nodes** for structured segment parsing and field extraction
- **An Agentic AI orchestration layer** (Node.js + IBM watsonx) that classifies messages, detects anomalies, routes intelligently, and generates human-readable summaries
- **MQ / HTTP transport** so the kit works with any HL7-capable system (EHR, lab, pharmacy, ADT feed)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      HL7 ACE Starter Kit — Data Flow                        │
│                                                                             │
│  HL7 Source          ACE Integration Server          AI Agent Layer         │
│  (EHR / Lab)                                                                │
│                                                                             │
│  ┌─────────┐   HTTP/MQ   ┌──────────────────┐   REST   ┌────────────────┐  │
│  │ ADT^A01 │ ──────────► │  HL7 Ingest Flow │ ───────► │  Agent Router  │  │
│  │ ORU^R01 │             │  (HTTP Input)    │          │  (watsonx.ai)  │  │
│  │ ORM^O01 │             └────────┬─────────┘          └───────┬────────┘  │
│  └─────────┘                      │                            │           │
│                                   ▼                            ▼           │
│                          ┌─────────────────┐         ┌────────────────┐    │
│                          │  ESQL HL7 Parser│         │ Classify &     │    │
│                          │  (Tokeniser)    │         │ Validate Agent │    │
│                          └────────┬────────┘         └───────┬────────┘    │
│                                   │                          │             │
│                                   ▼                          ▼             │
│                          ┌─────────────────┐       ┌─────────────────┐    │
│                          │ Java Segment    │       │ Enrichment &    │    │
│                          │ Parser Node     │       │ Summary Agent   │    │
│                          └────────┬────────┘       └───────┬─────────┘    │
│                                   │                        │              │
│                                   ▼                        ▼              │
│                          ┌─────────────────┐     ┌──────────────────┐    │
│                          │ Message Router  │     │ Audit Log +      │    │
│                          │ (by MSH-9)      │     │ Notification     │    │
│                          └────────┬────────┘     └──────────────────┘    │
│                                   │                                        │
│              ┌────────────────────┼─────────────────────┐                 │
│              ▼                    ▼                      ▼                 │
│     ┌──────────────┐   ┌──────────────────┐   ┌──────────────────┐        │
│     │ ADT Queue    │   │ ORU/Results DB   │   │ ORM/Orders API  │        │
│     │ (MQ)         │   │ (FHIR adapter)   │   │ (Downstream)    │        │
│     └──────────────┘   └──────────────────┘   └──────────────────┘        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
hl7-ace-starter-kit/
├── README.md
├── ace-flows/                         # IBM ACE BAR-ready message flows
│   ├── HL7IngestFlow.msgflow          # HTTP entry point — receives raw HL7
│   ├── HL7RouterFlow.msgflow          # Routes by message type (ADT/ORU/ORM)
│   └── HL7AckFlow.msgflow             # Generates HL7 ACK responses
├── esql/                              # ESQL compute node logic
│   ├── HL7Parser.esql                 # Tokenises raw HL7 pipe-delimited text
│   ├── HL7Validator.esql              # Validates required fields (MSH, PID etc.)
│   └── HL7AckBuilder.esql             # Builds AA / AE acknowledgement
├── java/                              # Java plugins for ACE
│   └── HL7SegmentParser.java          # Structured segment → Java POJO → LocalEnvironment
├── agent/                             # Agentic AI orchestration (Node.js)
│   ├── index.js                       # Express server — receives parsed HL7 JSON
│   ├── agents/
│   │   ├── ClassifierAgent.js         # Classifies message type & urgency
│   │   ├── ValidatorAgent.js          # AI-assisted field validation
│   │   ├── EnrichmentAgent.js         # Patient context enrichment
│   │   └── SummaryAgent.js            # Human-readable clinical summary
│   ├── tools/
│   │   ├── hl7Tools.js                # LangChain-style tool definitions
│   │   └── fhirTools.js               # FHIR lookup stubs
│   └── config.js                      # watsonx endpoint + model config
├── samples/                           # Test HL7 messages
│   ├── ADT_A01_admit.hl7
│   ├── ORU_R01_lab_result.hl7
│   └── ORM_O01_order.hl7
├── tests/
│   ├── test-ingest.sh                 # curl-based smoke test
│   └── agent-test.js                  # Jest tests for agent layer
└── deployment/
    ├── ace-server.yaml                # ACE integration server config
    └── docker-compose.yml             # Local dev stack (ACE + MQ + Agent)
```

---

## Quick Start

### Prerequisites
- IBM ACE 12.x (or ACE Developer Edition)
- IBM MQ 9.x (optional, for queue-based routing)
- Node.js 18+
- IBM watsonx.ai API key (or use stub mode for offline demo)

### 1 — Deploy ACE Flows

```bash
# Package flows into a BAR file
mqsipackagebar -w . -a hl7-starter.bar -k HL7IngestFlow HL7RouterFlow HL7AckFlow

# Deploy to integration server
mqsideploy -i localhost -p 4414 -e default -a hl7-starter.bar
```

### 2 — Start the Agent Layer

```bash
cd agent
npm install
cp .env.example .env          # fill in WATSONX_API_KEY and PROJECT_ID
npm start
```

### 3 — Send a Test Message

```bash
cd tests
bash test-ingest.sh
```

---

## HL7 Message Types Supported

| Code     | Description               | ACE Flow Target     | Agent Action           |
|----------|---------------------------|---------------------|------------------------|
| ADT^A01  | Admit Patient             | ADT Queue / MQ      | Classify + Summarise   |
| ADT^A03  | Discharge Patient         | ADT Queue / MQ      | Classify + Audit       |
| ADT^A08  | Update Patient Info       | ADT Queue / MQ      | Validate + Enrich      |
| ORU^R01  | Lab Result (Unsolicited)  | Results DB / FHIR   | Classify + Alert check |
| ORM^O01  | Medical Order             | Orders API          | Validate + Route       |
| ACK      | Acknowledgement           | Back to sender      | Auto-generated         |

---

## Key Design Decisions

1. **No external HL7 library inside ACE** — pure ESQL tokenisation keeps the BAR file lightweight and avoids unsupported third-party JARs.
2. **AI layer is outside ACE** — the agent runs as a sidecar Node.js service, keeping ACE flows deterministic and the AI logic independently testable.
3. **LangChain-style tool pattern** — each agent registers tools (classify, validate, enrich, summarise) so the AI can decide which to call based on message content.
4. **Offline / stub mode** — set `WATSONX_STUB=true` in `.env` to run the full demo without API credentials.

---

## License
Apache 2.0 — free to fork, extend, and demo.
