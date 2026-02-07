package com.permacat.model;

import java.util.HashMap;
import java.util.Map;

public class GraphEdgeDTO {
    public String fromNode;
    public String toNode;
    public String relationType;
    public Map<String, Object> metadata;

    public GraphEdgeDTO(String fromNode, String toNode, String relationType) {
        this.fromNode = fromNode;
        this.toNode = toNode;
        this.relationType = relationType;
        this.metadata = new HashMap<>();
    }

    public GraphEdgeDTO(String fromNode, String toNode, String relationType, Map<String, Object> metadata) {
        this(fromNode, toNode, relationType);
        if (metadata != null) {
            this.metadata.putAll(metadata);
        }
    }
}
