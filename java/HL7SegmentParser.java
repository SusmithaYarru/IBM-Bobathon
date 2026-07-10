package com.ibm.hl7.starter;

import com.ibm.broker.javacompute.MbJavaComputeNode;
import com.ibm.broker.plugin.*;

import java.util.*;

/**
 * HL7SegmentParser — IBM ACE Java Compute Node
 *
 * Reads the raw HL7 blob from InputRoot.BLOB, parses every segment into
 * structured MbElement children under LocalEnvironment/HL7, and builds a
 * compact JSON summary that the AI agent layer can consume directly.
 *
 * Why Java instead of pure ESQL?
 *   - Java allows iterative data structures (List/Map) for multi-occurrence
 *     segments (e.g. multiple OBX results per ORU).
 *   - The JSON summary is easier to construct with StringBuilder than ESQL.
 *
 * Deployment:
 *   Compile → hl7-segment-parser.jar → place in ACE shared-classes or
 *   reference from the integration server's server.conf.yaml.
 */
public class HL7SegmentParser extends MbJavaComputeNode {

    // HL7 v2 default delimiters
    private static final char FIELD_SEP     = '|';
    private static final char COMPONENT_SEP = '^';
    private static final char REPEAT_SEP    = '~';
    private static final char ESCAPE_CHAR   = '\\';
    private static final char SUBCOMP_SEP   = '&';

    // Segment IDs that contain patient demographics
    private static final Set<String> DEMOGRAPHIC_SEGS =
        new HashSet<>(Arrays.asList("PID", "PD1", "NK1", "GT1"));

    // -------------------------------------------------------------------------
    // ACE framework entry point
    // -------------------------------------------------------------------------
    @Override
    public void evaluate(MbMessageAssembly assembly) throws MbException {
        MbOutputTerminal out  = getOutputTerminal("out");
        MbOutputTerminal fail = getOutputTerminal("failure");

        MbMessage inMsg   = assembly.getMessage();
        MbMessage outMsg  = assembly.getMessage().copy();
        MbMessageAssembly outAssembly = assembly.copy(outMsg);

        try {
            // --- Read raw HL7 bytes from BLOB parser domain ---------------
            MbElement blobRoot = inMsg.getRootElement()
                                      .getFirstElementByPath("BLOB/BLOB");
            if (blobRoot == null) {
                throw new MbUserException(this, "evaluate",
                    "HL7SegmentParser", "", "No BLOB body found", null);
            }

            byte[] rawBytes = (byte[]) blobRoot.getValue();
            String rawHL7   = new String(rawBytes, "UTF-8");

            // --- Parse segments -------------------------------------------
            List<HL7Segment> segments = parseMessage(rawHL7);
            if (segments.isEmpty()) {
                throw new MbUserException(this, "evaluate",
                    "HL7SegmentParser", "", "No HL7 segments found in body", null);
            }

            // --- Populate LocalEnvironment/HL7 tree -----------------------
            MbElement localEnv = outAssembly.getLocalEnvironment().getRootElement();
            MbElement hl7Node  = localEnv.createElementAsLastChild(
                MbElement.TYPE_NAME, "HL7", null);

            Map<String, Integer> segCounts = new LinkedHashMap<>();
            for (HL7Segment seg : segments) {
                writeSegmentToTree(seg, hl7Node, segCounts);
            }

            // --- Promote routing keys ------------------------------------
            String msgType   = getField(segments, "MSH", 8, 0);   // MSH-9.1
            String evtCode   = getField(segments, "MSH", 8, 1);   // MSH-9.2
            String ctrlId    = getField(segments, "MSH", 9, -1);  // MSH-10
            String patientId = getField(segments, "PID", 2, 0);   // PID-3.1
            String patFamily = getField(segments, "PID", 4, 0);   // PID-5.1
            String patGiven  = getField(segments, "PID", 4, 1);   // PID-5.2

            setLeaf(hl7Node, "messageType",    splitCaret(msgType)[0]);
            setLeaf(hl7Node, "triggerEvent",   splitCaret(evtCode)[0]);
            setLeaf(hl7Node, "messageControl", ctrlId);
            setLeaf(hl7Node, "patientId",      patientId);
            setLeaf(hl7Node, "patientName",    patGiven + " " + patFamily);

            // --- Build JSON summary for AI agent --------------------------
            String jsonSummary = buildJsonSummary(segments,
                splitCaret(msgType)[0],
                evtCode.isEmpty() ? "" : splitCaret(evtCode)[0],
                ctrlId, patientId,
                patGiven + " " + patFamily);

            setLeaf(hl7Node, "jsonSummary", jsonSummary);

            out.propagate(outAssembly);

        } catch (Exception ex) {
            // Write error into LocalEnvironment and route to failure terminal
            try {
                MbElement localEnv = outAssembly.getLocalEnvironment().getRootElement();
                MbElement errNode  = localEnv.createElementAsLastChild(
                    MbElement.TYPE_NAME, "HL7", null);
                setLeaf(errNode, "parseError", ex.getMessage());
                fail.propagate(outAssembly);
            } catch (MbException inner) {
                throw inner;
            }
        }
    }

    // =========================================================================
    // HL7 parsing helpers
    // =========================================================================

    /** Split a raw HL7 message into a list of typed segments. */
    private List<HL7Segment> parseMessage(String raw) {
        List<HL7Segment> list = new ArrayList<>();
        // Normalise all line endings to \n
        String normalised = raw.replace("\r\n", "\n").replace('\r', '\n');
        for (String line : normalised.split("\n")) {
            line = line.trim();
            if (line.length() < 3) continue;
            list.add(new HL7Segment(line));
        }
        return list;
    }

    /** Find first occurrence of a segment and return raw field value.
     *  @param fieldIdx 0-based field index after segment ID
     *  @param compIdx  0-based component index; -1 = whole field string */
    private String getField(List<HL7Segment> segs, String segId,
                             int fieldIdx, int compIdx) {
        for (HL7Segment s : segs) {
            if (s.id.equals(segId)) {
                if (fieldIdx >= s.fields.size()) return "";
                String fv = s.fields.get(fieldIdx);
                if (compIdx < 0) return fv;
                String[] comps = fv.split("\\^", -1);
                return compIdx < comps.length ? comps[compIdx] : "";
            }
        }
        return "";
    }

    /** Write a single HL7Segment into the MbElement tree. */
    private void writeSegmentToTree(HL7Segment seg, MbElement parent,
                                     Map<String, Integer> counts) throws MbException {
        int occ = counts.getOrDefault(seg.id, 0) + 1;
        counts.put(seg.id, occ);

        MbElement segNode = parent.createElementAsLastChild(
            MbElement.TYPE_NAME, seg.id, null);
        segNode.createElementAsLastChild(
            MbElement.TYPE_NAME_VALUE, "occurrence", occ);

        int fi = 1;
        for (String field : seg.fields) {
            MbElement fieldNode = segNode.createElementAsLastChild(
                MbElement.TYPE_NAME, "field", null);
            fieldNode.createElementAsLastChild(
                MbElement.TYPE_NAME_VALUE, "index", fi);

            if (field.contains("^")) {
                String[] comps = field.split("\\^", -1);
                for (int ci = 0; ci < comps.length; ci++) {
                    fieldNode.createElementAsLastChild(
                        MbElement.TYPE_NAME_VALUE, "component[" + (ci+1) + "]", comps[ci]);
                }
            } else {
                fieldNode.createElementAsLastChild(
                    MbElement.TYPE_NAME_VALUE, "value", field);
            }
            fi++;
        }
    }

    /** Build a compact JSON summary for the AI agent sidecar. */
    private String buildJsonSummary(List<HL7Segment> segs,
                                     String msgType, String evtCode,
                                     String ctrlId, String patId, String patName) {
        StringBuilder sb = new StringBuilder();
        sb.append("{");
        sb.append("\"messageType\":\"").append(esc(msgType)).append("\",");
        sb.append("\"triggerEvent\":\"").append(esc(evtCode)).append("\",");
        sb.append("\"messageControlId\":\"").append(esc(ctrlId)).append("\",");
        sb.append("\"patientId\":\"").append(esc(patId)).append("\",");
        sb.append("\"patientName\":\"").append(esc(patName)).append("\",");
        sb.append("\"segmentIds\":[");

        Set<String> seen = new LinkedHashSet<>();
        for (HL7Segment s : segs) seen.add(s.id);
        boolean first = true;
        for (String id : seen) {
            if (!first) sb.append(",");
            sb.append("\"").append(id).append("\"");
            first = false;
        }
        sb.append("],");

        // Include OBX values for ORU messages (lab results)
        if ("ORU".equals(msgType)) {
            sb.append("\"observations\":[");
            boolean fo = true;
            for (HL7Segment s : segs) {
                if (!"OBX".equals(s.id)) continue;
                if (!fo) sb.append(",");
                String obxId    = s.fields.size() > 2  ? s.fields.get(2)  : "";
                String obxValue = s.fields.size() > 4  ? s.fields.get(4)  : "";
                String obxUnit  = s.fields.size() > 5  ? s.fields.get(5)  : "";
                String obxFlag  = s.fields.size() > 7  ? s.fields.get(7)  : "";
                sb.append("{\"id\":\"").append(esc(obxId))
                  .append("\",\"value\":\"").append(esc(obxValue))
                  .append("\",\"unit\":\"").append(esc(obxUnit))
                  .append("\",\"abnormalFlag\":\"").append(esc(obxFlag))
                  .append("\"}");
                fo = false;
            }
            sb.append("],");
        }

        // Include DG1 diagnosis codes
        sb.append("\"diagnoses\":[");
        boolean fd = true;
        for (HL7Segment s : segs) {
            if (!"DG1".equals(s.id)) continue;
            if (!fd) sb.append(",");
            String code = s.fields.size() > 2 ? s.fields.get(2) : "";
            String desc = s.fields.size() > 3 ? s.fields.get(3) : "";
            sb.append("{\"code\":\"").append(esc(code))
              .append("\",\"description\":\"").append(esc(desc)).append("\"}");
            fd = false;
        }
        sb.append("]");
        sb.append("}");
        return sb.toString();
    }

    // =========================================================================
    // Internal helpers
    // =========================================================================

    private void setLeaf(MbElement parent, String name, String value)
        throws MbException {
        parent.createElementAsLastChild(MbElement.TYPE_NAME_VALUE, name,
            value == null ? "" : value);
    }

    private String[] splitCaret(String val) {
        if (val == null || val.isEmpty()) return new String[]{"", ""};
        return val.split("\\^", -1);
    }

    /** Escape double-quotes and backslashes for JSON embedding. */
    private String esc(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    // =========================================================================
    // Inner class: lightweight HL7 segment holder
    // =========================================================================
    private static class HL7Segment {
        final String       id;
        final List<String> fields;

        HL7Segment(String line) {
            String[] parts = line.split("\\|", -1);
            this.id = parts[0];
            this.fields = new ArrayList<>();
            // MSH: field[0] = id, field[1] = encoding chars, so start at 1
            int start = "MSH".equals(id) ? 1 : 1;
            for (int i = start; i < parts.length; i++) {
                fields.add(parts[i]);
            }
        }
    }
}
