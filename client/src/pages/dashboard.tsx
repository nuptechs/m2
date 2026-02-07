import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FolderUp,
  FileSearch,
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock,
  ArrowRight,
  Layers,
  Shield,
  Database,
} from "lucide-react";
import type { Project, AnalysisRun, CatalogEntry } from "@shared/schema";

function StatCard({
  title,
  value,
  icon: Icon,
  description,
  loading,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  description: string;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <div className="text-2xl font-bold" data-testid={`text-stat-${title.toLowerCase().replace(/\s/g, '-')}`}>{value}</div>
        )}
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
    pending: { variant: "secondary", label: "Pending" },
    analyzing: { variant: "default", label: "Analyzing" },
    completed: { variant: "outline", label: "Completed" },
    failed: { variant: "destructive", label: "Failed" },
  };
  const config = variants[status] || variants.pending;
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

export default function Dashboard() {
  const { data: projects, isLoading: loadingProjects } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
  });

  const { data: recentRuns, isLoading: loadingRuns } = useQuery<AnalysisRun[]>({
    queryKey: ["/api/analysis-runs/recent"],
  });

  const { data: stats, isLoading: loadingStats } = useQuery<{
    totalProjects: number;
    totalRuns: number;
    totalCatalogEntries: number;
    criticalActions: number;
  }>({
    queryKey: ["/api/stats"],
  });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-dashboard-title">
          Dashboard
        </h1>
        <p className="text-muted-foreground mt-1">
          Code-to-Permission Catalog overview and recent activity
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Projects"
          value={stats?.totalProjects ?? 0}
          icon={Layers}
          description="Uploaded codebases"
          loading={loadingStats}
        />
        <StatCard
          title="Analysis Runs"
          value={stats?.totalRuns ?? 0}
          icon={Activity}
          description="Completed scans"
          loading={loadingStats}
        />
        <StatCard
          title="Catalog Entries"
          value={stats?.totalCatalogEntries ?? 0}
          icon={Database}
          description="Detected actions"
          loading={loadingStats}
        />
        <StatCard
          title="Critical Actions"
          value={stats?.criticalActions ?? 0}
          icon={Shield}
          description="Score above 70"
          loading={loadingStats}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">Recent Projects</CardTitle>
            <Link href="/upload">
              <Button variant="outline" size="sm" data-testid="button-new-project">
                <FolderUp className="h-3.5 w-3.5 mr-1.5" />
                New Project
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {loadingProjects ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : projects && projects.length > 0 ? (
              <div className="space-y-2">
                {projects.slice(0, 5).map((project) => (
                  <Link key={project.id} href={`/catalog?projectId=${project.id}`}>
                    <div
                      className="flex items-center justify-between gap-2 p-3 rounded-md hover-elevate cursor-pointer"
                      data-testid={`card-project-${project.id}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent">
                          <FileSearch className="h-4 w-4 text-accent-foreground" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{project.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {project.fileCount} files
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <StatusBadge status={project.status} />
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <FolderUp className="h-10 w-10 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">No projects yet</p>
                <Link href="/upload">
                  <Button variant="outline" size="sm" className="mt-3" data-testid="button-upload-first">
                    Upload your first project
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">Recent Analysis Runs</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingRuns ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : recentRuns && recentRuns.length > 0 ? (
              <div className="space-y-2">
                {recentRuns.slice(0, 5).map((run) => (
                  <div
                    key={run.id}
                    className="flex items-center justify-between gap-2 p-3 rounded-md"
                    data-testid={`card-run-${run.id}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {run.status === "completed" ? (
                        <CheckCircle className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
                      ) : run.status === "failed" ? (
                        <AlertTriangle className="h-5 w-5 shrink-0 text-red-500" />
                      ) : (
                        <Clock className="h-5 w-5 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium">Run #{run.id}</p>
                        <p className="text-xs text-muted-foreground">
                          {run.totalInteractions} interactions | {run.totalEndpoints} endpoints | {run.totalEntities} entities
                        </p>
                      </div>
                    </div>
                    <StatusBadge status={run.status} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Activity className="h-10 w-10 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">No analysis runs yet</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Upload a project to start analyzing
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
