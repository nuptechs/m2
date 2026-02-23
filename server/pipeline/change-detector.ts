import crypto from "crypto";

export interface FileData {
  filePath: string;
  content: string;
}

export interface FileHash {
  filePath: string;
  hash: string;
}

export interface ChangeAnalysis {
  backendChanged: boolean;
  frontendChanged: boolean;
  bothChanged: boolean;
  noChanges: boolean;
  changedFiles: string[];
  addedFiles: string[];
  removedFiles: string[];
  backendChangedFiles: string[];
  frontendChangedFiles: string[];
  summary: string;
}

const BACKEND_EXTENSIONS = [".java"];
const FRONTEND_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".vue", ".html"];

function isBackendFile(filePath: string): boolean {
  return BACKEND_EXTENSIONS.some(ext => filePath.endsWith(ext));
}

function isFrontendFile(filePath: string): boolean {
  return FRONTEND_EXTENSIONS.some(ext => filePath.endsWith(ext));
}

export function computeFileHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function computeFileHashes(files: FileData[]): FileHash[] {
  return files.map(f => ({
    filePath: f.filePath,
    hash: computeFileHash(f.content),
  }));
}

export function detectChanges(
  oldHashes: FileHash[],
  newFiles: FileData[]
): ChangeAnalysis {
  const oldMap = new Map<string, string>();
  oldHashes.forEach(h => oldMap.set(h.filePath, h.hash));

  const newHashes = computeFileHashes(newFiles);
  const newMap = new Map<string, string>();
  newHashes.forEach(h => newMap.set(h.filePath, h.hash));

  const changedFiles: string[] = [];
  const addedFiles: string[] = [];
  const removedFiles: string[] = [];

  newMap.forEach((hash, filePath) => {
    const oldHash = oldMap.get(filePath);
    if (!oldHash) {
      addedFiles.push(filePath);
    } else if (oldHash !== hash) {
      changedFiles.push(filePath);
    }
  });

  oldMap.forEach((_, filePath) => {
    if (!newMap.has(filePath)) {
      removedFiles.push(filePath);
    }
  });

  const allChanged = [...changedFiles, ...addedFiles, ...removedFiles];
  const backendChangedFiles = allChanged.filter(isBackendFile);
  const frontendChangedFiles = allChanged.filter(isFrontendFile);

  const backendChanged = backendChangedFiles.length > 0;
  const frontendChanged = frontendChangedFiles.length > 0;
  const noChanges = allChanged.length === 0;

  const parts: string[] = [];
  if (noChanges) parts.push("No changes detected");
  else {
    if (changedFiles.length > 0) parts.push(`${changedFiles.length} modified`);
    if (addedFiles.length > 0) parts.push(`${addedFiles.length} added`);
    if (removedFiles.length > 0) parts.push(`${removedFiles.length} removed`);
    if (backendChanged && frontendChanged) parts.push("(backend + frontend)");
    else if (backendChanged) parts.push("(backend only)");
    else if (frontendChanged) parts.push("(frontend only)");
  }

  return {
    backendChanged,
    frontendChanged,
    bothChanged: backendChanged && frontendChanged,
    noChanges,
    changedFiles,
    addedFiles,
    removedFiles,
    backendChangedFiles,
    frontendChangedFiles,
    summary: parts.join(", "),
  };
}
