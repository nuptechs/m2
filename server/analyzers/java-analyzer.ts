export interface JavaEndpoint {
  className: string;
  methodName: string;
  httpMethod: string;
  path: string;
  fullPath: string;
  serviceCalls: string[];
  repositoryCalls: string[];
  entitiesTouched: string[];
  sourceFile: string;
  lineNumber: number;
}

export interface JavaServiceMethod {
  className: string;
  methodName: string;
  repositoryCalls: string[];
  entitiesTouched: string[];
  nestedServiceCalls: string[];
  sourceFile: string;
}

export interface JavaEntity {
  className: string;
  tableName: string;
  fields: string[];
  sourceFile: string;
}

const CONTROLLER_ANNOTATION = /@(?:Rest)?Controller/;
const REQUEST_MAPPING_CLASS = /@RequestMapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/;
const REQUEST_MAPPING_CLASS_BARE = /@RequestMapping\s*(?:\(\s*\))?$/;
const METHOD_MAPPINGS = [
  { regex: /@GetMapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/, method: "GET" },
  { regex: /@PostMapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/, method: "POST" },
  { regex: /@PutMapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/, method: "PUT" },
  { regex: /@DeleteMapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/, method: "DELETE" },
  { regex: /@PatchMapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/, method: "PATCH" },
  { regex: /@GetMapping\s*(?:\(\s*\))?$/, method: "GET" },
  { regex: /@PostMapping\s*(?:\(\s*\))?$/, method: "POST" },
  { regex: /@PutMapping\s*(?:\(\s*\))?$/, method: "PUT" },
  { regex: /@DeleteMapping\s*(?:\(\s*\))?$/, method: "DELETE" },
  { regex: /@PatchMapping\s*(?:\(\s*\))?$/, method: "PATCH" },
];

const REQUEST_MAPPING_METHOD = /@RequestMapping\s*\([^)]*method\s*=\s*RequestMethod\.(GET|POST|PUT|DELETE|PATCH)[^)]*value\s*=\s*["']([^"']+)["']/;
const REQUEST_MAPPING_METHOD_ALT = /@RequestMapping\s*\([^)]*value\s*=\s*["']([^"']+)["'][^)]*method\s*=\s*RequestMethod\.(GET|POST|PUT|DELETE|PATCH)/;

const ENTITY_ANNOTATION = /@Entity/;
const TABLE_ANNOTATION = /@Table\s*\(\s*name\s*=\s*["']([^"']+)["']/;
const SERVICE_ANNOTATION = /@Service/;
const REPOSITORY_ANNOTATION = /@Repository|extends\s+(?:JpaRepository|CrudRepository|PagingAndSortingRepository)/;

const REPO_METHOD_CALLS = /(\w+Repository|\w+Repo)\s*\.\s*(\w+)/g;
const SERVICE_METHOD_CALLS = /(\w+Service)\s*\.\s*(\w+)/g;

const SAVE_METHODS = ["save", "saveAll", "saveAndFlush", "persist", "merge", "saveAllAndFlush"];
const DELETE_METHODS = ["delete", "deleteById", "deleteAll", "deleteAllById", "deleteAllInBatch", "remove"];
const READ_METHODS = ["findById", "findAll", "findOne", "getById", "getOne", "existsById", "count", "findAllById", "getReferenceById"];

function getClassName(content: string): string {
  const match = content.match(/(?:public\s+)?(?:abstract\s+)?class\s+(\w+)/);
  return match ? match[1] : "Unknown";
}

function getLineNumber(content: string, index: number): number {
  return content.substring(0, index).split("\n").length;
}

function extractMethodBody(content: string, startIndex: number): string {
  let braceCount = 0;
  let foundFirstBrace = false;
  let bodyStart = startIndex;

  for (let i = startIndex; i < content.length; i++) {
    if (content[i] === "{") {
      if (!foundFirstBrace) {
        foundFirstBrace = true;
        bodyStart = i;
      }
      braceCount++;
    } else if (content[i] === "}") {
      braceCount--;
      if (foundFirstBrace && braceCount === 0) {
        return content.substring(bodyStart, i + 1);
      }
    }
  }
  return content.substring(bodyStart, Math.min(bodyStart + 500, content.length));
}

function extractFields(content: string): string[] {
  const fields: string[] = [];
  const fieldRegex = /(?:@Column|@Id|@JoinColumn|private|protected)\s+(?:\w+(?:<[^>]+>)?)\s+(\w+)\s*[;=]/g;
  let match;
  while ((match = fieldRegex.exec(content)) !== null) {
    fields.push(match[1]);
  }
  return fields;
}

function findInjectedServices(content: string): Map<string, string> {
  const services = new Map<string, string>();

  const fieldPatterns = [
    /@Autowired\s+(?:private\s+)?(\w+)\s+(\w+)/g,
    /private\s+(?:final\s+)?(\w+)\s+(\w+)/g,
    /(?:@Inject|@Resource)\s+(?:private\s+)?(\w+)\s+(\w+)/g,
  ];

  for (const pattern of fieldPatterns) {
    const re = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = re.exec(content)) !== null) {
      const typeName = match[1];
      const fieldName = match[2];
      if (typeName.endsWith("Service") || typeName.endsWith("Repository") || typeName.endsWith("Repo")) {
        services.set(fieldName, typeName);
      }
    }
  }

  const className = getClassName(content);
  const constructorRegex = new RegExp(
    `(?:public\\s+)?${className}\\s*\\(([^)]*)\\)`,
    "g"
  );
  let ctorMatch;
  while ((ctorMatch = constructorRegex.exec(content)) !== null) {
    const params = ctorMatch[1];
    const paramRegex = /(\w+)\s+(\w+)/g;
    let paramMatch;
    while ((paramMatch = paramRegex.exec(params)) !== null) {
      const typeName = paramMatch[1];
      const fieldName = paramMatch[2];
      if (typeName.endsWith("Service") || typeName.endsWith("Repository") || typeName.endsWith("Repo")) {
        services.set(fieldName, typeName);
      }
    }
  }

  return services;
}

export function analyzeJavaController(
  filePath: string,
  content: string
): JavaEndpoint[] {
  if (!CONTROLLER_ANNOTATION.test(content)) return [];

  const endpoints: JavaEndpoint[] = [];
  const className = getClassName(content);
  const injectedServices = findInjectedServices(content);

  let basePath = "";
  const basePathMatch = content.match(REQUEST_MAPPING_CLASS);
  if (basePathMatch) {
    basePath = basePathMatch[1];
  }

  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const mapping of METHOD_MAPPINGS) {
      const match = line.match(mapping.regex);
      if (match) {
        const methodPath = match[1] || "";
        const fullPath = `${basePath}${methodPath}`.replace(/\/+/g, "/");

        const methodLineIndex = content.indexOf(line);
        const methodBody = extractMethodBody(content, methodLineIndex);

        const serviceCalls: string[] = [];
        const repositoryCalls: string[] = [];
        const entitiesTouched: string[] = [];

        const serviceCallRegex = new RegExp(SERVICE_METHOD_CALLS.source, SERVICE_METHOD_CALLS.flags);
        let scMatch;
        while ((scMatch = serviceCallRegex.exec(methodBody)) !== null) {
          serviceCalls.push(`${scMatch[1]}.${scMatch[2]}`);
        }

        const repoCallRegex = new RegExp(REPO_METHOD_CALLS.source, REPO_METHOD_CALLS.flags);
        let rcMatch;
        while ((rcMatch = repoCallRegex.exec(methodBody)) !== null) {
          repositoryCalls.push(`${rcMatch[1]}.${rcMatch[2]}`);
          const entityName = rcMatch[1].replace(/Repository|Repo$/, "");
          if (entityName && !entitiesTouched.includes(entityName)) {
            entitiesTouched.push(entityName);
          }
        }

        let methodName = "unknown";
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const methodMatch = lines[j].match(/(?:public|private|protected)\s+\w+(?:<[^>]+>)?\s+(\w+)\s*\(/);
          if (methodMatch) {
            methodName = methodMatch[1];
            break;
          }
        }

        endpoints.push({
          className,
          methodName,
          httpMethod: mapping.method,
          path: methodPath,
          fullPath: fullPath || basePath || "/",
          serviceCalls: [...new Set(serviceCalls)],
          repositoryCalls: [...new Set(repositoryCalls)],
          entitiesTouched: [...new Set(entitiesTouched)],
          sourceFile: filePath,
          lineNumber: i + 1,
        });
      }
    }

    const rmMatch = line.match(REQUEST_MAPPING_METHOD) || line.match(REQUEST_MAPPING_METHOD_ALT);
    if (rmMatch) {
      const httpMethod = rmMatch[1] === rmMatch[1].toUpperCase() ? rmMatch[1] : rmMatch[2];
      const path = rmMatch[1] === rmMatch[1].toUpperCase() ? rmMatch[2] : rmMatch[1];
      const fullPath = `${basePath}${path}`.replace(/\/+/g, "/");

      endpoints.push({
        className,
        methodName: "unknown",
        httpMethod,
        path,
        fullPath,
        serviceCalls: [],
        repositoryCalls: [],
        entitiesTouched: [],
        sourceFile: filePath,
        lineNumber: i + 1,
      });
    }
  }

  return endpoints;
}

export function analyzeJavaService(
  filePath: string,
  content: string
): JavaServiceMethod[] {
  if (!SERVICE_ANNOTATION.test(content)) return [];

  const className = getClassName(content);
  const methods: JavaServiceMethod[] = [];
  const injectedDeps = findInjectedServices(content);

  const methodRegex = /(?:public|private|protected)\s+\w+(?:<[^>]+>)?\s+(\w+)\s*\([^)]*\)/g;
  let methodMatch;

  while ((methodMatch = methodRegex.exec(content)) !== null) {
    const methodName = methodMatch[1];
    const methodBody = extractMethodBody(content, methodMatch.index);

    const repositoryCalls: string[] = [];
    const entitiesTouched: string[] = [];
    const nestedServiceCalls: string[] = [];

    const repoCallRegex = new RegExp(REPO_METHOD_CALLS.source, REPO_METHOD_CALLS.flags);
    let rcMatch;
    while ((rcMatch = repoCallRegex.exec(methodBody)) !== null) {
      repositoryCalls.push(`${rcMatch[1]}.${rcMatch[2]}`);
      const entityName = rcMatch[1].replace(/Repository|Repo$/, "");
      if (entityName && !entitiesTouched.includes(entityName)) {
        entitiesTouched.push(entityName);
      }
    }

    const serviceCallRegex = new RegExp(SERVICE_METHOD_CALLS.source, SERVICE_METHOD_CALLS.flags);
    let scMatch;
    while ((scMatch = serviceCallRegex.exec(methodBody)) !== null) {
      const calledService = scMatch[1];
      if (calledService !== className) {
        nestedServiceCalls.push(`${calledService}.${scMatch[2]}`);
      }
    }

    if (repositoryCalls.length > 0 || nestedServiceCalls.length > 0) {
      methods.push({
        className,
        methodName,
        repositoryCalls: [...new Set(repositoryCalls)],
        entitiesTouched: [...new Set(entitiesTouched)],
        nestedServiceCalls: [...new Set(nestedServiceCalls)],
        sourceFile: filePath,
      });
    }
  }

  return methods;
}

export function analyzeJavaEntity(
  filePath: string,
  content: string
): JavaEntity | null {
  if (!ENTITY_ANNOTATION.test(content)) return null;

  const className = getClassName(content);
  const tableMatch = content.match(TABLE_ANNOTATION);
  const tableName = tableMatch ? tableMatch[1] : className.toLowerCase();
  const fields = extractFields(content);

  return {
    className,
    tableName,
    fields,
    sourceFile: filePath,
  };
}

export function analyzeJavaFiles(files: { filePath: string; content: string }[]) {
  const endpoints: JavaEndpoint[] = [];
  const serviceMethods: JavaServiceMethod[] = [];
  const entities: JavaEntity[] = [];

  const javaFiles = files.filter((f) => f.filePath.endsWith(".java"));

  for (const file of javaFiles) {
    endpoints.push(...analyzeJavaController(file.filePath, file.content));
    serviceMethods.push(...analyzeJavaService(file.filePath, file.content));
    const entity = analyzeJavaEntity(file.filePath, file.content);
    if (entity) entities.push(entity);
  }

  return { endpoints, serviceMethods, entities };
}

export function inferOperationType(
  serviceCalls: string[],
  repositoryCalls: string[],
  httpMethod: string | null
): string {
  for (const call of repositoryCalls) {
    const methodName = call.split(".").pop() || "";
    if (DELETE_METHODS.some((d) => methodName.toLowerCase().includes(d.toLowerCase()))) {
      return "DELETE";
    }
    if (SAVE_METHODS.some((s) => methodName.toLowerCase().includes(s.toLowerCase()))) {
      if (httpMethod === "PUT" || httpMethod === "PATCH") return "STATE_CHANGE";
      return "WRITE";
    }
    if (READ_METHODS.some((r) => methodName.toLowerCase().includes(r.toLowerCase()))) {
      return "READ";
    }
  }

  if (httpMethod) {
    const methodMap: Record<string, string> = {
      GET: "READ",
      POST: "WRITE",
      PUT: "STATE_CHANGE",
      PATCH: "STATE_CHANGE",
      DELETE: "DELETE",
    };
    return methodMap[httpMethod] || "READ";
  }

  return "READ";
}
