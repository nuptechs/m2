import type { IGitProvider, GitFile, GitBranch, GitPullRequest, GitDiffFile, GitPRDiff, GitProviderConfig } from "./git-provider";
import { parseRepoUrl, isSourceFile } from "./git-provider";

export class GitLabProvider implements IGitProvider {
  private projectPath: string;
  private token: string;
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(config: GitProviderConfig) {
    const parsed = parseRepoUrl(config.repoUrl);
    this.projectPath = encodeURIComponent(`${parsed.owner}/${parsed.repo}`);
    this.token = config.token;

    const urlMatch = config.repoUrl.match(/https?:\/\/([^/]+)/);
    this.baseUrl = urlMatch ? `https://${urlMatch[1]}/api/v4` : "https://gitlab.com/api/v4";

    this.headers = {
      "PRIVATE-TOKEN": this.token,
      "Content-Type": "application/json",
    };
  }

  private async request(path: string): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, { headers: this.headers });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitLab API error ${res.status}: ${body}`);
    }

    return res.json();
  }

  private async requestPaginated(basePath: string, maxPages = 10): Promise<any[]> {
    const results: any[] = [];
    let page = 1;

    while (page <= maxPages) {
      const separator = basePath.includes("?") ? "&" : "?";
      const data = await this.request(`${basePath}${separator}per_page=100&page=${page}`);
      if (!Array.isArray(data) || data.length === 0) break;
      results.push(...data);
      if (data.length < 100) break;
      page++;
    }

    return results;
  }

  async fetchBranches(): Promise<GitBranch[]> {
    const [branches, project] = await Promise.all([
      this.requestPaginated(`/projects/${this.projectPath}/repository/branches`),
      this.request(`/projects/${this.projectPath}`),
    ]);

    const defaultBranch = project.default_branch;

    return branches.map((b: any) => ({
      name: b.name,
      isDefault: b.name === defaultBranch,
      lastCommitSha: b.commit.id,
      lastCommitDate: b.commit.committed_date,
    }));
  }

  async fetchFileTree(branch: string): Promise<string[]> {
    const items = await this.requestPaginated(
      `/projects/${this.projectPath}/repository/tree?ref=${branch}&recursive=true`
    );

    return items
      .filter((item: any) => item.type === "blob")
      .map((item: any) => item.path);
  }

  async fetchFiles(branch: string, extensions?: string[]): Promise<GitFile[]> {
    const allPaths = await this.fetchFileTree(branch);
    const filterFn = extensions
      ? (p: string) => extensions.some(ext => p.endsWith(ext))
      : isSourceFile;

    const sourcePaths = allPaths.filter(filterFn);
    console.log(`[gitlab] Found ${sourcePaths.length} source files out of ${allPaths.length} total on branch ${branch}`);

    const batchSize = 15;
    const files: GitFile[] = [];

    for (let i = 0; i < sourcePaths.length; i += batchSize) {
      const batch = sourcePaths.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (filePath) => {
          try {
            const content = await this.fetchFileContent(branch, filePath);
            return { filePath, content };
          } catch (err) {
            console.warn(`[gitlab] Failed to fetch ${filePath}: ${err}`);
            return null;
          }
        })
      );
      files.push(...results.filter((f): f is GitFile => f !== null));
    }

    return files;
  }

  async fetchFileContent(branch: string, filePath: string): Promise<string> {
    const encodedPath = encodeURIComponent(filePath);
    const url = `${this.baseUrl}/projects/${this.projectPath}/repository/files/${encodedPath}/raw?ref=${branch}`;
    const res = await fetch(url, { headers: this.headers });

    if (!res.ok) {
      throw new Error(`GitLab content fetch failed for ${filePath}: ${res.status}`);
    }

    return res.text();
  }

  async fetchPullRequests(state: "open" | "closed" | "all" = "open"): Promise<GitPullRequest[]> {
    const glState = state === "open" ? "opened" : state === "all" ? "all" : "closed";
    const data = await this.requestPaginated(
      `/projects/${this.projectPath}/merge_requests?state=${glState}&order_by=updated_at&sort=desc`
    );

    return data.map((mr: any) => ({
      id: mr.iid,
      title: mr.title,
      description: mr.description || "",
      sourceBranch: mr.source_branch,
      targetBranch: mr.target_branch,
      state: mr.state === "merged" ? "merged" : mr.state === "opened" ? "open" : "closed",
      author: mr.author?.username || "unknown",
      createdAt: mr.created_at,
      updatedAt: mr.updated_at,
      url: mr.web_url,
    }));
  }

  async fetchPRDiff(prNumber: number): Promise<GitPRDiff> {
    const [mr, changes] = await Promise.all([
      this.request(`/projects/${this.projectPath}/merge_requests/${prNumber}`),
      this.request(`/projects/${this.projectPath}/merge_requests/${prNumber}/changes`),
    ]);

    const pullRequest: GitPullRequest = {
      id: mr.iid,
      title: mr.title,
      description: mr.description || "",
      sourceBranch: mr.source_branch,
      targetBranch: mr.target_branch,
      state: mr.state === "merged" ? "merged" : mr.state === "opened" ? "open" : "closed",
      author: mr.author?.username || "unknown",
      createdAt: mr.created_at,
      updatedAt: mr.updated_at,
      url: mr.web_url,
    };

    const changedFiles: GitDiffFile[] = (changes.changes || [])
      .filter((c: any) => isSourceFile(c.new_path) || isSourceFile(c.old_path))
      .map((c: any) => ({
        filePath: c.new_path,
        status: c.new_file ? "added" :
                c.deleted_file ? "removed" :
                c.renamed_file ? "renamed" : "modified",
        oldPath: c.renamed_file ? c.old_path : undefined,
        additions: (c.diff || "").split("\n").filter((l: string) => l.startsWith("+") && !l.startsWith("+++")).length,
        deletions: (c.diff || "").split("\n").filter((l: string) => l.startsWith("-") && !l.startsWith("---")).length,
      }));

    const baseBranch = mr.target_branch;
    const headBranch = mr.source_branch;

    const [baseFiles, headFiles] = await Promise.all([
      this.fetchFiles(baseBranch),
      this.fetchFiles(headBranch),
    ]);

    return {
      pullRequest,
      changedFiles,
      baseFiles,
      headFiles,
    };
  }
}
