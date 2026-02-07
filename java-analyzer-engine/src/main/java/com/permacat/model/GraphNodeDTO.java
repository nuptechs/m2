package com.permacat.model;

import java.util.HashMap;
import java.util.Map;

public class GraphNodeDTO {
    public String id;
    public String type;
    public String className;
    public String methodName;
    public Map<String, Object> metadata;

    public GraphNodeDTO(String type, String className, String methodName) {
        this.type = type;
        this.className = className;
        this.methodName = methodName;
        this.id = type + ":" + className + "." + methodName;
        this.metadata = new HashMap<>();
    }

    public GraphNodeDTO(String type, String className, String methodName, Map<String, Object> metadata) {
        this(type, className, methodName);
        if (metadata != null) {
            this.metadata.putAll(metadata);
        }
    }
}
