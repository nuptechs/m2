package com.permacat.model;

import java.util.List;

public class AnalysisResult {
    public List<GraphNodeDTO> nodes;
    public List<GraphEdgeDTO> edges;

    public AnalysisResult(List<GraphNodeDTO> nodes, List<GraphEdgeDTO> edges) {
        this.nodes = nodes;
        this.edges = edges;
    }
}
