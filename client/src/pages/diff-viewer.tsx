import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, Shield, ShieldAlert, ShieldOff, Plus, Minus, RefreshCw, ArrowRight, GitCompare, Loader2 } from "lucide-react";

interface ManifestDiff {
  runA: number;
  runB: number;
  generatedAt: string;
  summary: {
    endpointsAdded: number;
    endpointsRemoved: number;
    endpointsModified: number;
    screensAdded: number;
    screensRemoved: number;
    screensModified: number;
    rolesAdded: number;
    rolesRemoved: number;
    entitiesAdded: number;
    entitiesRemoved: number;
    securityImpactLevel: string;
  };
  endpoints: any[];
  screens: any[];
  roles: any[];
  entities: any[];
  security: {
    newUnprotectedEndpoints: any[];
    removedProtections: any[];
    criticalityIncreases: any[];
    coverageBefore: number;
    coverageAfter: number;
    coverageDelta: number;
  };
}

interface Snapshot {
  id: number;
  analysisRunId: number;
  createdAt: string;
  summary: {
    totalScreens: number;
    totalInteractions: number;
    totalEndpoints: number;
    totalEntities: number;
    totalRoles: number;
    averageCriticality: number;
    securityCoverage: number;
  } | null;
}

interface Project {
  id: number;
  name: string;
  status: string;
}

function ImpactBadge({ level }: { level: string }) {
  const config: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
    none: { variant: "secondary", label: "No Impact" },
    low: { variant: "outline", label: "Low" },
    medium: { variant: "default", label: "Medium" },
    high: { variant: "destructive", label: "High" },
    critical: { variant: "destructive", label: "Critical" },
  };
  const c = config[level] || config.low;
  return <Badge variant={c.variant} data-testid="badge-security-impact">{c.label}</Badge>;
}

function ChangeBadge({ type }: { type: string }) {
  if (type === "added") return <Badge variant="default" className="bg-green-600 hover:bg-green-700" data-testid="badge-change-added"><Plus className="h-3 w-3 mr-1" />Added</Badge>;
  if (type === "removed") return <Badge variant="destructive" data-testid="badge-change-removed"><Minus className="h-3 w-3 mr-1" />Removed</Badge>;
  return <Badge variant="outline" data-testid="badge-change-modified"><RefreshCw className="h-3 w-3 mr-1" />Modified</Badge>;
}

function SummaryBar({ summary }: { summary: ManifestDiff["summary"] }) {
  const items = [
    { label: "Endpoints", added: summary.endpointsAdded, removed: summary.endpointsRemoved, modified: summary.endpointsModified },
    { label: "Screens", added: summary.screensAdded, removed: summary.screensRemoved, modified: summary.screensModified },
    { label: "Roles", added: summary.rolesAdded, removed: summary.rolesRemoved, modified: 0 },
    { label: "Entities", added: summary.entitiesAdded, removed: summary.entitiesRemoved, modified: 0 },
  ];

  const hasChanges = items.some(i => i.added > 0 || i.removed > 0 || i.modified > 0);

  return (
    <Card data-testid="card-diff-summary">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Change Summary</CardTitle>
          <ImpactBadge level={summary.securityImpactLevel} />
        </div>
      </CardHeader>
      <CardContent>
        {!hasChanges ? (
          <p className="text-muted-foreground text-sm" data-testid="text-no-changes">No changes detected between the selected analysis runs.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {items.map(item => (
              <div key={item.label} className="text-center">
                <p className="text-sm font-medium text-muted-foreground">{item.label}</p>
                <div className="flex items-center justify-center gap-2 mt-1">
                  {item.added > 0 && <span className="text-green-600 font-semibold" data-testid={`text-${item.label.toLowerCase()}-added`}>+{item.added}</span>}
                  {item.removed > 0 && <span className="text-red-600 font-semibold" data-testid={`text-${item.label.toLowerCase()}-removed`}>-{item.removed}</span>}
                  {item.modified > 0 && <span className="text-yellow-600 font-semibold" data-testid={`text-${item.label.toLowerCase()}-modified`}>~{item.modified}</span>}
                  {item.added === 0 && item.removed === 0 && item.modified === 0 && <span className="text-muted-foreground">—</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SecuritySection({ security }: { security: ManifestDiff["security"] }) {
  const hasIssues = security.newUnprotectedEndpoints.length > 0 ||
    security.removedProtections.length > 0 ||
    security.criticalityIncreases.length > 0;

  return (
    <Card data-testid="card-security-impact">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Security Impact
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted-foreground">Coverage:</span>
          <span data-testid="text-coverage-before">{security.coverageBefore.toFixed(0)}%</span>
          <ArrowRight className="h-4 w-4" />
          <span className={security.coverageDelta < 0 ? "text-red-600 font-semibold" : security.coverageDelta > 0 ? "text-green-600 font-semibold" : ""} data-testid="text-coverage-after">
            {security.coverageAfter.toFixed(0)}%
          </span>
          {security.coverageDelta !== 0 && (
            <span className={security.coverageDelta < 0 ? "text-red-600" : "text-green-600"}>
              ({security.coverageDelta > 0 ? "+" : ""}{security.coverageDelta.toFixed(1)}%)
            </span>
          )}
        </div>

        {!hasIssues && <p className="text-sm text-muted-foreground" data-testid="text-no-security-issues">No security issues detected.</p>}

        {security.newUnprotectedEndpoints.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold flex items-center gap-2 text-yellow-600 mb-2">
              <ShieldOff className="h-4 w-4" />
              New Unprotected Endpoints ({security.newUnprotectedEndpoints.length})
            </h4>
            <div className="space-y-1">
              {security.newUnprotectedEndpoints.map((ep, i) => (
                <div key={i} className="flex items-center gap-2 text-sm pl-6" data-testid={`text-unprotected-endpoint-${i}`}>
                  <Badge variant="outline" className="text-xs">{ep.method}</Badge>
                  <code className="text-xs">{ep.path}</code>
                  <span className="text-muted-foreground">criticality: {ep.criticalityScore}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {security.removedProtections.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold flex items-center gap-2 text-red-600 mb-2">
              <ShieldAlert className="h-4 w-4" />
              Removed Protections ({security.removedProtections.length})
            </h4>
            <div className="space-y-1">
              {security.removedProtections.map((rp, i) => (
                <div key={i} className="text-sm pl-6" data-testid={`text-removed-protection-${i}`}>
                  <code className="text-xs">{rp.method} {rp.path}</code>
                  <span className="text-muted-foreground ml-2">
                    roles: [{rp.rolesBefore.join(", ")}] → [{rp.rolesAfter.join(", ")}]
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {security.criticalityIncreases.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold flex items-center gap-2 text-orange-600 mb-2">
              <AlertTriangle className="h-4 w-4" />
              Criticality Increases ({security.criticalityIncreases.length})
            </h4>
            <div className="space-y-1">
              {security.criticalityIncreases.map((ci, i) => (
                <div key={i} className="flex items-center gap-2 text-sm pl-6" data-testid={`text-criticality-increase-${i}`}>
                  <code className="text-xs">{ci.method} {ci.path}</code>
                  <span className="text-muted-foreground">{ci.before} → {ci.after}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ChangesList({ title, icon, changes, renderItem }: {
  title: string;
  icon: any;
  changes: any[];
  renderItem: (item: any, index: number) => JSX.Element;
}) {
  if (changes.length === 0) return null;
  const Icon = icon;
  return (
    <Card data-testid={`card-changes-${title.toLowerCase()}`}>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Icon className="h-5 w-5" />
          {title} ({changes.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {changes.map((item, i) => renderItem(item, i))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function DiffViewerPage() {
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [runA, setRunA] = useState<string>("");
  const [runB, setRunB] = useState<string>("");

  const { data: projects } = useQuery<Project[]>({ queryKey: ["/api/projects"] });

  const projectId = selectedProject ? parseInt(selectedProject) : null;

  const { data: snapshots } = useQuery<Snapshot[]>({
    queryKey: ["/api/projects", projectId, "snapshots"],
    enabled: !!projectId,
  });

  const canDiff = runA && runB && runA !== runB;

  const { data: diff, isLoading: isDiffLoading, refetch: refetchDiff } = useQuery<ManifestDiff>({
    queryKey: ["/api/projects", projectId, "diff", runA, runB],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/diff?runA=${runA}&runB=${runB}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: false,
  });

  const handleCompare = () => {
    if (canDiff) refetchDiff();
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Manifest Diff Viewer</h1>
        <p className="text-muted-foreground mt-1">Compare analysis runs to track changes in endpoints, screens, roles, and security posture.</p>
      </div>

      <Card data-testid="card-diff-controls">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div>
              <label className="text-sm font-medium mb-2 block">Project</label>
              <Select value={selectedProject} onValueChange={(v) => { setSelectedProject(v); setRunA(""); setRunB(""); }} data-testid="select-project">
                <SelectTrigger data-testid="select-project-trigger">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects?.filter(p => p.status === "completed").map(p => (
                    <SelectItem key={p.id} value={String(p.id)} data-testid={`option-project-${p.id}`}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Base (Before)</label>
              <Select value={runA} onValueChange={setRunA} disabled={!snapshots || snapshots.length < 2} data-testid="select-run-a">
                <SelectTrigger data-testid="select-run-a-trigger">
                  <SelectValue placeholder="Select run" />
                </SelectTrigger>
                <SelectContent>
                  {snapshots?.map(s => (
                    <SelectItem key={s.analysisRunId} value={String(s.analysisRunId)} data-testid={`option-run-a-${s.analysisRunId}`}>
                      Run #{s.analysisRunId} — {new Date(s.createdAt).toLocaleDateString()} {new Date(s.createdAt).toLocaleTimeString()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Compare (After)</label>
              <Select value={runB} onValueChange={setRunB} disabled={!snapshots || snapshots.length < 2} data-testid="select-run-b">
                <SelectTrigger data-testid="select-run-b-trigger">
                  <SelectValue placeholder="Select run" />
                </SelectTrigger>
                <SelectContent>
                  {snapshots?.map(s => (
                    <SelectItem key={s.analysisRunId} value={String(s.analysisRunId)} data-testid={`option-run-b-${s.analysisRunId}`}>
                      Run #{s.analysisRunId} — {new Date(s.createdAt).toLocaleDateString()} {new Date(s.createdAt).toLocaleTimeString()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button onClick={handleCompare} disabled={!canDiff || isDiffLoading} data-testid="button-compare">
              {isDiffLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <GitCompare className="h-4 w-4 mr-2" />}
              Compare
            </Button>
          </div>

          {snapshots && snapshots.length < 2 && projectId && (
            <p className="text-sm text-muted-foreground mt-3" data-testid="text-insufficient-snapshots">
              This project needs at least 2 analysis runs to generate a diff. Currently has {snapshots.length} snapshot(s).
              Run analysis again to create more.
            </p>
          )}
        </CardContent>
      </Card>

      {diff && (
        <>
          <SummaryBar summary={diff.summary} />
          <SecuritySection security={diff.security} />

          <ChangesList
            title="Endpoints"
            icon={Shield}
            changes={diff.endpoints}
            renderItem={(ep, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg border" data-testid={`row-endpoint-change-${i}`}>
                <ChangeBadge type={ep.changeType} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs font-mono">{ep.method}</Badge>
                    <code className="text-sm truncate">{ep.path}</code>
                  </div>
                  {ep.modifications && (
                    <div className="mt-1 space-y-0.5">
                      {ep.modifications.map((mod: string, j: number) => (
                        <p key={j} className="text-xs text-muted-foreground">{mod}</p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          />

          <ChangesList
            title="Screens"
            icon={RefreshCw}
            changes={diff.screens}
            renderItem={(screen, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-lg border" data-testid={`row-screen-change-${i}`}>
                <ChangeBadge type={screen.changeType} />
                <span className="font-medium text-sm">{screen.name}</span>
                {screen.modifications && (
                  <span className="text-xs text-muted-foreground">{screen.modifications.join(", ")}</span>
                )}
              </div>
            )}
          />

          <ChangesList
            title="Roles"
            icon={ShieldAlert}
            changes={diff.roles}
            renderItem={(role, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg border" data-testid={`row-role-change-${i}`}>
                <ChangeBadge type={role.changeType} />
                <div>
                  <span className="font-medium text-sm">{role.name}</span>
                  {role.endpointsAdded && <p className="text-xs text-green-600 mt-1">+{role.endpointsAdded.length} endpoint access</p>}
                  {role.endpointsRemoved && <p className="text-xs text-red-600">-{role.endpointsRemoved.length} endpoint access</p>}
                </div>
              </div>
            )}
          />

          <ChangesList
            title="Entities"
            icon={AlertTriangle}
            changes={diff.entities}
            renderItem={(entity, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg border" data-testid={`row-entity-change-${i}`}>
                <ChangeBadge type={entity.changeType} />
                <div>
                  <span className="font-medium text-sm">{entity.name}</span>
                  {entity.sensitiveFieldsAdded && <p className="text-xs text-yellow-600 mt-1">+sensitive: {entity.sensitiveFieldsAdded.join(", ")}</p>}
                  {entity.sensitiveFieldsRemoved && <p className="text-xs text-green-600">-sensitive: {entity.sensitiveFieldsRemoved.join(", ")}</p>}
                </div>
              </div>
            )}
          />
        </>
      )}
    </div>
  );
}
