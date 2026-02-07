package com.permacat.model;

import java.util.HashMap;
import java.util.Map;

public class GraphNodeDTO {
    public String id;
    public String type;
    public String className;
    public String methodName;
    public String qualifiedSignature;
    public Map<String, Object> metadata;

    public GraphNodeDTO(String type, String className, String methodName, String qualifiedSignature) {
        this.type = type;
        this.className = className;
        this.methodName = methodName;
        this.qualifiedSignature = qualifiedSignature;
        this.id = qualifiedSignature != null
            ? type + ":" + qualifiedSignature
            : type + ":" + className;
        this.metadata = new HashMap<>();
    }

    public GraphNodeDTO(String type, String className, String methodName, String qualifiedSignature, Map<String, Object> metadata) {
        this(type, className, methodName, qualifiedSignature);
        if (metadata != null) {
            this.metadata.putAll(metadata);
        }
    }
}
