export interface FrontendInteraction {
  screen: string;
  interaction: string;
  interactionType: string;
  endpoint: string | null;
  httpMethod: string | null;
  sourceFile: string;
  lineNumber: number;
}

const HTTP_CALL_PATTERNS = [
  { regex: /axios\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi, methodIdx: 1, urlIdx: 2 },
  { regex: /\$http\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi, methodIdx: 1, urlIdx: 2 },
  { regex: /fetch\s*\(\s*['"`]([^'"`]+)['"`]\s*(?:,\s*\{[^}]*method\s*:\s*['"`](GET|POST|PUT|DELETE|PATCH)['"`])?/gi, methodIdx: 2, urlIdx: 1 },
  { regex: /this\.http\.(get|post|put|delete|patch)\s*(?:<[^>]*>)?\s*\(\s*['"`]([^'"`]+)['"`]/gi, methodIdx: 1, urlIdx: 2 },
  { regex: /HttpClient\.\w+\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi, methodIdx: 1, urlIdx: 2 },
  { regex: /apiRequest\s*\(\s*['"`](GET|POST|PUT|DELETE|PATCH)['"`]\s*,\s*['"`]([^'"`]+)['"`]/gi, methodIdx: 1, urlIdx: 2 },
  { regex: /request\s*\(\s*\{[^}]*url\s*:\s*['"`]([^'"`]+)['"`][^}]*method\s*:\s*['"`](GET|POST|PUT|DELETE|PATCH)['"`]/gi, methodIdx: 2, urlIdx: 1 },
  { regex: /api\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi, methodIdx: 1, urlIdx: 2 },
  { regex: /instance\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi, methodIdx: 1, urlIdx: 2 },
  { regex: /client\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi, methodIdx: 1, urlIdx: 2 },
  { regex: /useMutation\s*\([^)]*['"`](GET|POST|PUT|DELETE|PATCH)['"`]\s*,\s*['"`]([^'"`]+)['"`]/gi, methodIdx: 1, urlIdx: 2 },
];

const BUTTON_PATTERNS = [
  /<button[^>]*@click\s*=\s*['"]([^'"]+)['"]/gi,
  /<button[^>]*\(click\)\s*=\s*['"]([^'"]+)['"]/gi,
  /<button[^>]*onClick\s*=\s*\{([^}]+)\}/gi,
  /<el-button[^>]*@click\s*=\s*['"]([^'"]+)['"]/gi,
  /<a-button[^>]*@click\s*=\s*['"]([^'"]+)['"]/gi,
  /<v-btn[^>]*@click\s*=\s*['"]([^'"]+)['"]/gi,
  /Button[^>]*onClick\s*=\s*\{([^}]+)\}/gi,
];

const FORM_PATTERNS = [
  /<form[^>]*@submit(?:\.prevent)?\s*=\s*['"]([^'"]+)['"]/gi,
  /<form[^>]*\(ngSubmit\)\s*=\s*['"]([^'"]+)['"]/gi,
  /<form[^>]*onSubmit\s*=\s*\{([^}]+)\}/gi,
  /handleSubmit\s*\(/gi,
  /onFinish\s*=\s*\{([^}]+)\}/gi,
];

const ROUTER_PATTERNS = [
  /path\s*:\s*['"]([^'"]+)['"]/gi,
  /<Route\s+path\s*=\s*['"]([^'"]+)['"]/gi,
  /<router-link\s+to\s*=\s*['"]([^'"]+)['"]/gi,
  /routerLink\s*=\s*['"]([^'"]+)['"]/gi,
  /navigate\s*\(\s*['"]([^'"]+)['"]/gi,
  /push\s*\(\s*['"]([^'"]+)['"]/gi,
  /router\.push\s*\(\s*\{[^}]*path\s*:\s*['"]([^'"]+)['"]/gi,
  /useNavigate\s*\(\s*\)\s*;\s*\n[^]*?navigate\s*\(\s*['"]([^'"]+)['"]/gi,
  /history\.push\s*\(\s*['"]([^'"]+)['"]/gi,
];

const MENU_PATTERNS = [
  /<el-menu-item[^>]*@click\s*=\s*['"]([^'"]+)['"]/gi,
  /<a-menu-item[^>]*@click\s*=\s*['"]([^'"]+)['"]/gi,
  /<MenuItem[^>]*onClick\s*=\s*\{([^}]+)\}/gi,
  /<v-list-item[^>]*@click\s*=\s*['"]([^'"]+)['"]/gi,
  /<DropdownMenuItem[^>]*onClick\s*=\s*\{([^}]+)\}/gi,
];

function getScreenFromFilePath(filePath: string): string {
  const parts = filePath.split("/");
  const fileName = parts[parts.length - 1];
  const name = fileName.replace(/\.(vue|jsx|tsx|ts|js)$/, "");
  return name.charAt(0).toUpperCase() + name.slice(1).replace(/[-_]/g, " ");
}

function getLineNumber(content: string, index: number): number {
  return content.substring(0, index).split("\n").length;
}

export function analyzeFrontendFile(
  filePath: string,
  content: string
): FrontendInteraction[] {
  const interactions: FrontendInteraction[] = [];
  const screen = getScreenFromFilePath(filePath);

  for (const pattern of HTTP_CALL_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match;
    while ((match = regex.exec(content)) !== null) {
      const method = match[pattern.methodIdx]?.toUpperCase() || "GET";
      const url = match[pattern.urlIdx] || "";
      interactions.push({
        screen,
        interaction: `HTTP ${method} call to ${url}`,
        interactionType: "http_call",
        endpoint: url,
        httpMethod: method,
        sourceFile: filePath,
        lineNumber: getLineNumber(content, match.index),
      });
    }
  }

  for (const regex of BUTTON_PATTERNS) {
    const re = new RegExp(regex.source, regex.flags);
    let match;
    while ((match = re.exec(content)) !== null) {
      const handler = match[1]?.trim() || "unknown";
      interactions.push({
        screen,
        interaction: `Button click: ${handler}`,
        interactionType: "button_click",
        endpoint: null,
        httpMethod: null,
        sourceFile: filePath,
        lineNumber: getLineNumber(content, match.index),
      });
    }
  }

  for (const regex of FORM_PATTERNS) {
    const re = new RegExp(regex.source, regex.flags);
    let match;
    while ((match = re.exec(content)) !== null) {
      const handler = match[1]?.trim() || "form submission";
      interactions.push({
        screen,
        interaction: `Form submit: ${handler}`,
        interactionType: "form_submit",
        endpoint: null,
        httpMethod: "POST",
        sourceFile: filePath,
        lineNumber: getLineNumber(content, match.index),
      });
    }
  }

  for (const regex of ROUTER_PATTERNS) {
    const re = new RegExp(regex.source, regex.flags);
    let match;
    while ((match = re.exec(content)) !== null) {
      const route = match[1]?.trim() || "";
      if (route && route !== "/" && !route.startsWith("http")) {
        interactions.push({
          screen,
          interaction: `Navigation to ${route}`,
          interactionType: "navigation",
          endpoint: null,
          httpMethod: null,
          sourceFile: filePath,
          lineNumber: getLineNumber(content, match.index),
        });
      }
    }
  }

  for (const regex of MENU_PATTERNS) {
    const re = new RegExp(regex.source, regex.flags);
    let match;
    while ((match = re.exec(content)) !== null) {
      const handler = match[1]?.trim() || "menu action";
      interactions.push({
        screen,
        interaction: `Menu action: ${handler}`,
        interactionType: "menu_action",
        endpoint: null,
        httpMethod: null,
        sourceFile: filePath,
        lineNumber: getLineNumber(content, match.index),
      });
    }
  }

  return interactions;
}

export function analyzeFrontendFiles(
  files: { filePath: string; content: string }[]
): FrontendInteraction[] {
  const frontendExtensions = [".vue", ".jsx", ".tsx", ".ts", ".js", ".html"];
  const interactions: FrontendInteraction[] = [];

  for (const file of files) {
    const ext = file.filePath.substring(file.filePath.lastIndexOf("."));
    if (frontendExtensions.includes(ext)) {
      interactions.push(...analyzeFrontendFile(file.filePath, file.content));
    }
  }

  return interactions;
}
