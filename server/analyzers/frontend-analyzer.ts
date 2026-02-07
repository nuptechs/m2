import * as ts from "typescript";
import * as vueSfc from "@vue/compiler-sfc";
import * as ngCompiler from "@angular/compiler";
import type { ApplicationGraph, GraphNode } from "./application-graph";

export interface FrontendInteraction {
  component: string;
  elementType: string;
  actionName: string;
  httpMethod: string | null;
  url: string | null;
  mappedBackendNode: GraphNode | null;
  sourceFile: string;
  lineNumber: number;
}

interface HandlerInfo {
  name: string;
  elementType: string;
  lineNumber: number;
}

interface HttpCall {
  method: string;
  url: string;
  lineNumber: number;
  callerFunction: string | null;
}

interface TemplateBinding {
  elementType: string;
  eventType: string;
  handlerName: string;
  lineNumber: number;
}

function getComponentName(filePath: string): string {
  const parts = filePath.split("/");
  const fileName = parts[parts.length - 1];
  const name = fileName.replace(/\.(vue|jsx|tsx|ts|js|html)$/, "");
  return name.charAt(0).toUpperCase() + name.slice(1).replace(/[-_]/g, " ");
}

function parseTypeScript(code: string, fileName: string): ts.SourceFile {
  let scriptKind = ts.ScriptKind.TS;
  if (fileName.endsWith(".tsx") || fileName.endsWith(".jsx")) {
    scriptKind = ts.ScriptKind.TSX;
  } else if (fileName.endsWith(".js")) {
    scriptKind = ts.ScriptKind.JS;
  }
  return ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, scriptKind);
}

function getLineNumber(sourceFile: ts.SourceFile, pos: number): number {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

function extractHttpCallsFromAST(sourceFile: ts.SourceFile): HttpCall[] {
  const calls: HttpCall[] = [];

  function getEnclosingFunctionName(node: ts.Node): string | null {
    let current = node.parent;
    while (current) {
      if (ts.isFunctionDeclaration(current) && current.name) {
        return current.name.text;
      }
      if (ts.isMethodDeclaration(current) && ts.isIdentifier(current.name)) {
        return current.name.text;
      }
      if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
        const parent = current.parent;
        if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
          return parent.name.text;
        }
        if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
          return parent.name.text;
        }
        if (ts.isPropertyDeclaration(parent) && ts.isIdentifier(parent.name)) {
          return parent.name.text;
        }
      }
      current = current.parent;
    }
    return null;
  }

  function extractUrlFromNode(node: ts.Node): string | null {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return node.text;
    }
    if (ts.isTemplateExpression(node)) {
      let result = node.head.text;
      for (const span of node.templateSpans) {
        result += "{param}" + span.literal.text;
      }
      return result;
    }
    return null;
  }

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const expr = node.expression;

      if (ts.isPropertyAccessExpression(expr)) {
        const methodName = expr.name.text.toLowerCase();
        const httpMethods = ["get", "post", "put", "delete", "patch"];

        if (httpMethods.includes(methodName)) {
          const objectText = expr.expression.getText(sourceFile).toLowerCase();
          const httpPatterns = [
            "axios", "http", "httpclient", "api", "apirequest",
            "apiservice", "instance", "client", "request", "this.http",
            "this.$http", "this.httpclient",
          ];
          const isHttp = httpPatterns.some(
            (p) => objectText === p || objectText.endsWith("." + p) || objectText.includes(p)
          );

          if (isHttp && node.arguments.length > 0) {
            const urlArg = node.arguments[0];
            const url = extractUrlFromNode(urlArg);
            if (url) {
              calls.push({
                method: methodName.toUpperCase(),
                url,
                lineNumber: getLineNumber(sourceFile, node.getStart(sourceFile)),
                callerFunction: getEnclosingFunctionName(node),
              });
            }
          }
        }
      }

      if (ts.isIdentifier(expr) && expr.text === "fetch") {
        if (node.arguments.length > 0) {
          const urlArg = node.arguments[0];
          const url = extractUrlFromNode(urlArg);
          if (url) {
            let method = "GET";
            if (node.arguments.length > 1 && ts.isObjectLiteralExpression(node.arguments[1])) {
              for (const prop of node.arguments[1].properties) {
                if (
                  ts.isPropertyAssignment(prop) &&
                  ts.isIdentifier(prop.name) &&
                  prop.name.text === "method" &&
                  ts.isStringLiteral(prop.initializer)
                ) {
                  method = prop.initializer.text.toUpperCase();
                }
              }
            }
            calls.push({
              method,
              url,
              lineNumber: getLineNumber(sourceFile, node.getStart(sourceFile)),
              callerFunction: getEnclosingFunctionName(node),
            });
          }
        }
      }

      if (ts.isIdentifier(expr)) {
        const fnName = expr.text.toLowerCase();
        if (fnName === "apirequest" || fnName === "request") {
          if (node.arguments.length >= 2) {
            const methodArg = node.arguments[0];
            const urlArg = node.arguments[1];
            if (ts.isStringLiteral(methodArg)) {
              const url = extractUrlFromNode(urlArg);
              if (url) {
                calls.push({
                  method: methodArg.text.toUpperCase(),
                  url,
                  lineNumber: getLineNumber(sourceFile, node.getStart(sourceFile)),
                  callerFunction: getEnclosingFunctionName(node),
                });
              }
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return calls;
}

function buildFunctionToHttpMap(httpCalls: HttpCall[]): Map<string, HttpCall[]> {
  const map = new Map<string, HttpCall[]>();
  for (const call of httpCalls) {
    const key = call.callerFunction || "__top_level__";
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key)!.push(call);
  }
  return map;
}

function buildASTFunctionCallMap(sourceFile: ts.SourceFile): Map<string, string[]> {
  const callMap = new Map<string, string[]>();

  function visit(node: ts.Node) {
    let fnName: string | null = null;

    if (ts.isFunctionDeclaration(node) && node.name) {
      fnName = node.name.text;
    } else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
      fnName = node.name.text;
    } else if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node))) {
      const parent = node.parent;
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
        fnName = parent.name.text;
      } else if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
        fnName = parent.name.text;
      } else if (ts.isPropertyDeclaration(parent) && ts.isIdentifier(parent.name)) {
        fnName = parent.name.text;
      }
    }

    if (fnName) {
      const calledFns: string[] = [];

      const walkBody = (n: ts.Node) => {
        if (ts.isCallExpression(n)) {
          if (ts.isIdentifier(n.expression)) {
            calledFns.push(n.expression.text);
          } else if (ts.isPropertyAccessExpression(n.expression)) {
            const obj = n.expression.expression;
            if (obj.kind === ts.SyntaxKind.ThisKeyword || (ts.isIdentifier(obj) && obj.text === "this")) {
              calledFns.push(n.expression.name.text);
            }
          }
        }
        ts.forEachChild(n, walkBody);
      };

      if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
        if (node.body) walkBody(node.body);
      } else if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
        walkBody(node.body);
      }

      callMap.set(fnName, calledFns);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return callMap;
}

function findIndirectHttpCallsAST(
  handlerName: string,
  functionCallMap: Map<string, string[]>,
  functionMap: Map<string, HttpCall[]>
): HttpCall[] {
  const visited = new Set<string>();
  const results: HttpCall[] = [];

  function trace(fnName: string) {
    if (visited.has(fnName)) return;
    visited.add(fnName);

    const direct = functionMap.get(fnName);
    if (direct) {
      results.push(...direct);
      return;
    }

    const calledFns = functionCallMap.get(fnName);
    if (calledFns) {
      for (const fn of calledFns) {
        trace(fn);
      }
    }
  }

  trace(handlerName);
  return results;
}

function parseVueTemplateAST(content: string): { bindings: TemplateBinding[]; scriptContent: string; scriptOffset: number } {
  const sfcResult = vueSfc.parse(content);
  const descriptor = sfcResult.descriptor;

  const bindings: TemplateBinding[] = [];

  if (descriptor.template && descriptor.template.ast) {
    walkVueASTNode(descriptor.template.ast.children, bindings);
  }

  let scriptContent = "";
  let scriptOffset = 0;
  if (descriptor.scriptSetup) {
    scriptContent = descriptor.scriptSetup.content;
    scriptOffset = descriptor.scriptSetup.loc.start.line - 1;
  } else if (descriptor.script) {
    scriptContent = descriptor.script.content;
    scriptOffset = descriptor.script.loc.start.line - 1;
  }

  return { bindings, scriptContent, scriptOffset };
}

function walkVueASTNode(nodes: any[], bindings: TemplateBinding[]): void {
  for (const node of nodes) {
    if (node.type === 1) {
      const tagName = node.tag || "";
      const elementType = classifyElement(tagName);

      if (node.props) {
        for (const prop of node.props) {
          if (prop.type === 7 && prop.name === "on" && prop.arg) {
            const eventType = prop.arg.content || "";
            let handlerName = "";

            if (prop.exp) {
              const expContent = (prop.exp.content || "").trim();
              const cleaned = expContent.replace(/\(.*\)$/, "").trim();
              const dotIdx = cleaned.lastIndexOf(".");
              handlerName = dotIdx >= 0 ? cleaned.substring(dotIdx + 1) : cleaned;
            }

            if (handlerName) {
              bindings.push({
                elementType,
                eventType,
                handlerName,
                lineNumber: node.loc?.start?.line || 1,
              });
            }
          }
        }
      }

      if (node.children) {
        walkVueASTNode(node.children, bindings);
      }
    }
  }
}

function parseAngularTemplateAST(templateContent: string): TemplateBinding[] {
  const result = ngCompiler.parseTemplate(templateContent, "template.html", {
    preserveWhitespaces: false,
  });

  const bindings: TemplateBinding[] = [];

  function walkNodes(nodes: any[]): void {
    for (const node of nodes) {
      if (node.name !== undefined) {
        const tagName = node.name || "";
        const elementType = classifyElement(tagName);

        if (node.outputs) {
          for (const output of node.outputs) {
            const eventType = output.name || "";
            let handlerName = "";

            if (output.handler) {
              const source = (output.handler.source || "").trim();
              const cleaned = source.replace(/\(.*\)$/, "").trim();
              const dotIdx = cleaned.lastIndexOf(".");
              handlerName = dotIdx >= 0 ? cleaned.substring(dotIdx + 1) : cleaned;
            }

            if (handlerName) {
              bindings.push({
                elementType,
                eventType,
                handlerName,
                lineNumber: output.sourceSpan?.start?.line != null
                  ? output.sourceSpan.start.line + 1
                  : 1,
              });
            }
          }
        }

        if (node.children) {
          walkNodes(node.children);
        }
      }
    }
  }

  if (result.nodes) {
    walkNodes(result.nodes);
  }

  return bindings;
}

function parseJSXTemplate(sourceFile: ts.SourceFile): TemplateBinding[] {
  const bindings: TemplateBinding[] = [];

  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = node.tagName.getText(sourceFile).toLowerCase();
      const elementType = classifyElement(tagName);

      for (const attr of node.attributes.properties) {
        if (ts.isJsxAttribute(attr) && attr.name) {
          const attrName = attr.name.getText(sourceFile);
          const eventMap: Record<string, string> = {
            onClick: "click",
            onSubmit: "submit",
            onChange: "change",
            onDoubleClick: "dblclick",
            onMouseDown: "mousedown",
          };

          const eventType = eventMap[attrName];
          if (eventType && attr.initializer) {
            let handlerName = "";
            if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
              const expr = attr.initializer.expression;
              if (ts.isIdentifier(expr)) {
                handlerName = expr.text;
              } else if (ts.isPropertyAccessExpression(expr)) {
                handlerName = expr.name.text;
              } else if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
                handlerName = extractInlineHandlerTarget(expr, sourceFile);
              } else if (ts.isCallExpression(expr)) {
                if (ts.isIdentifier(expr.expression)) {
                  handlerName = expr.expression.text;
                } else if (ts.isPropertyAccessExpression(expr.expression)) {
                  handlerName = expr.expression.name.text;
                }
              }
            }

            if (handlerName) {
              bindings.push({
                elementType,
                eventType,
                handlerName,
                lineNumber: getLineNumber(sourceFile, node.getStart(sourceFile)),
              });
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return bindings;
}

function extractInlineHandlerTarget(node: ts.ArrowFunction | ts.FunctionExpression, sourceFile: ts.SourceFile): string {
  let result = "";
  function visit(n: ts.Node) {
    if (result) return;
    if (ts.isCallExpression(n)) {
      if (ts.isIdentifier(n.expression)) {
        result = n.expression.text;
      } else if (ts.isPropertyAccessExpression(n.expression)) {
        result = n.expression.name.text;
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(node.body);
  return result || "__inline_handler__";
}

function classifyElement(tagName: string): string {
  const tag = tagName.toLowerCase();
  if (tag === "button" || tag.includes("button") || tag.includes("btn") || tag === "el-button" || tag === "a-button" || tag === "v-btn" || tag === "mat-button" || tag === "mat-raised-button" || tag === "mat-icon-button") {
    return "button";
  }
  if (tag === "a" || tag === "router-link" || tag === "link" || tag === "navlink") {
    return "link";
  }
  if (tag === "form" || tag === "el-form" || tag === "nz-form" || tag === "mat-form") {
    return "form";
  }
  if (tag.includes("menu-item") || tag.includes("menuitem") || tag.includes("dropdown") || tag.includes("list-item")) {
    return "menu";
  }
  if (tag === "input" || tag === "select" || tag === "textarea" || tag.includes("input") || tag.includes("select")) {
    return "input";
  }
  if (tag === "icon" || tag.includes("icon")) {
    return "icon";
  }
  return "element";
}

function normalizeUrl(url: string): string {
  return url
    .replace(/\$\{[^}]+\}/g, "{param}")
    .replace(/`/g, "")
    .replace(/\+\s*\w+/g, "")
    .replace(/\/+/g, "/")
    .trim();
}

function matchUrlToEndpoint(
  httpMethod: string,
  url: string,
  graph: ApplicationGraph
): GraphNode | null {
  const normalizedUrl = normalizeUrl(url);
  const controllers = graph.getNodesByType("CONTROLLER");
  let bestNode: GraphNode | null = null;
  let bestScore = 0;

  for (const node of controllers) {
    const meta = node.metadata as { httpMethod?: string; fullPath?: string };
    if (!meta.httpMethod || !meta.fullPath) continue;

    if (httpMethod && meta.httpMethod.toUpperCase() !== httpMethod.toUpperCase()) continue;

    const score = endpointMatchScore(normalizedUrl, meta.fullPath);
    if (score > bestScore && score >= 50) {
      bestScore = score;
      bestNode = node;
    }
  }

  if (!bestNode) {
    for (const node of controllers) {
      const meta = node.metadata as { httpMethod?: string; fullPath?: string };
      if (!meta.fullPath) continue;
      const score = endpointMatchScore(normalizedUrl, meta.fullPath);
      if (score > bestScore && score >= 40) {
        bestScore = score;
        bestNode = node;
      }
    }
  }

  return bestNode;
}

function endpointMatchScore(frontendUrl: string, backendPath: string): number {
  const normFront = frontendUrl.replace(/\/+/g, "/").replace(/\/$/, "");
  const normBack = backendPath.replace(/\/+/g, "/").replace(/\/$/, "");

  if (normFront === normBack) return 100;

  const frontParts = normFront.split("/").filter(Boolean);
  const backParts = normBack.split("/").filter(Boolean);

  if (frontParts.length !== backParts.length) {
    if (normFront.includes(normBack) || normBack.includes(normFront)) return 60;
    return 0;
  }

  let matchCount = 0;
  for (let i = 0; i < frontParts.length; i++) {
    const fp = frontParts[i];
    const bp = backParts[i];
    if (fp === bp) {
      matchCount++;
    } else if (bp.startsWith("{") || fp === "{param}" || fp.startsWith(":")) {
      matchCount += 0.8;
    }
  }

  return (matchCount / frontParts.length) * 100;
}

function resolveBindingsToInteractions(
  bindings: TemplateBinding[],
  functionMap: Map<string, HttpCall[]>,
  functionCallMap: Map<string, string[]>,
  component: string,
  filePath: string,
  graph: ApplicationGraph
): FrontendInteraction[] {
  const interactions: FrontendInteraction[] = [];

  for (const binding of bindings) {
    const callsInHandler = functionMap.get(binding.handlerName) || [];

    if (callsInHandler.length > 0) {
      for (const call of callsInHandler) {
        const backendNode = matchUrlToEndpoint(call.method, call.url, graph);
        interactions.push({
          component,
          elementType: binding.elementType,
          actionName: binding.handlerName,
          httpMethod: call.method,
          url: call.url,
          mappedBackendNode: backendNode,
          sourceFile: filePath,
          lineNumber: binding.lineNumber,
        });
      }
    } else {
      const indirectCalls = findIndirectHttpCallsAST(binding.handlerName, functionCallMap, functionMap);
      if (indirectCalls.length > 0) {
        for (const call of indirectCalls) {
          const backendNode = matchUrlToEndpoint(call.method, call.url, graph);
          interactions.push({
            component,
            elementType: binding.elementType,
            actionName: binding.handlerName,
            httpMethod: call.method,
            url: call.url,
            mappedBackendNode: backendNode,
            sourceFile: filePath,
            lineNumber: binding.lineNumber,
          });
        }
      } else {
        interactions.push({
          component,
          elementType: binding.elementType,
          actionName: binding.handlerName,
          httpMethod: null,
          url: null,
          mappedBackendNode: null,
          sourceFile: filePath,
          lineNumber: binding.lineNumber,
        });
      }
    }
  }

  return interactions;
}

function analyzeVueFile(
  filePath: string,
  content: string,
  graph: ApplicationGraph
): FrontendInteraction[] {
  const component = getComponentName(filePath);

  const { bindings: templateBindings, scriptContent, scriptOffset } = parseVueTemplateAST(content);

  let httpCalls: HttpCall[] = [];
  let functionMap = new Map<string, HttpCall[]>();
  let functionCallMap = new Map<string, string[]>();

  if (scriptContent.trim()) {
    const scriptSource = parseTypeScript(scriptContent, filePath + ".script.ts");
    httpCalls = extractHttpCallsFromAST(scriptSource);
    functionMap = buildFunctionToHttpMap(httpCalls);
    functionCallMap = buildASTFunctionCallMap(scriptSource);
  }

  const interactions = resolveBindingsToInteractions(
    templateBindings, functionMap, functionCallMap, component, filePath, graph
  );

  addUnmappedHttpCalls(interactions, httpCalls, component, filePath, graph);

  return interactions;
}

function analyzeReactFile(
  filePath: string,
  content: string,
  graph: ApplicationGraph
): FrontendInteraction[] {
  const component = getComponentName(filePath);
  const sourceFile = parseTypeScript(content, filePath);
  const httpCalls = extractHttpCallsFromAST(sourceFile);
  const functionMap = buildFunctionToHttpMap(httpCalls);
  const functionCallMap = buildASTFunctionCallMap(sourceFile);
  const jsxBindings = parseJSXTemplate(sourceFile);

  const interactions = resolveBindingsToInteractions(
    jsxBindings, functionMap, functionCallMap, component, filePath, graph
  );

  addUnmappedHttpCalls(interactions, httpCalls, component, filePath, graph);

  return interactions;
}

function analyzeAngularFile(
  filePath: string,
  content: string,
  graph: ApplicationGraph,
  htmlTemplates: Map<string, string>
): FrontendInteraction[] {
  const component = getComponentName(filePath);
  const interactions: FrontendInteraction[] = [];

  if (filePath.endsWith(".html")) {
    const bindings = parseAngularTemplateAST(content);
    for (const binding of bindings) {
      interactions.push({
        component,
        elementType: binding.elementType,
        actionName: binding.handlerName,
        httpMethod: null,
        url: null,
        mappedBackendNode: null,
        sourceFile: filePath,
        lineNumber: binding.lineNumber,
      });
    }
    return interactions;
  }

  const sourceFile = parseTypeScript(content, filePath);
  const httpCalls = extractHttpCallsFromAST(sourceFile);
  const functionMap = buildFunctionToHttpMap(httpCalls);
  const functionCallMap = buildASTFunctionCallMap(sourceFile);

  let templateContent = "";

  const templateUrlNode = findDecoratorProperty(sourceFile, "templateUrl");
  if (templateUrlNode && ts.isStringLiteral(templateUrlNode)) {
    const templatePath = templateUrlNode.text;
    const resolvedPath = resolveTemplatePath(filePath, templatePath);
    templateContent = htmlTemplates.get(resolvedPath) || "";
  }

  if (!templateContent) {
    const templateNode = findDecoratorProperty(sourceFile, "template");
    if (templateNode) {
      if (ts.isNoSubstitutionTemplateLiteral(templateNode)) {
        templateContent = templateNode.text;
      } else if (ts.isStringLiteral(templateNode)) {
        templateContent = templateNode.text;
      } else if (ts.isTemplateExpression(templateNode)) {
        templateContent = templateNode.getText(sourceFile).replace(/^`|`$/g, "");
      }
    }
  }

  if (templateContent) {
    const templateBindings = parseAngularTemplateAST(templateContent);
    const resolved = resolveBindingsToInteractions(
      templateBindings, functionMap, functionCallMap, component, filePath, graph
    );
    interactions.push(...resolved);
  }

  addUnmappedHttpCalls(interactions, httpCalls, component, filePath, graph);

  return interactions;
}

function findDecoratorProperty(sourceFile: ts.SourceFile, propertyName: string): ts.Expression | null {
  let result: ts.Expression | null = null;

  function visit(node: ts.Node) {
    if (result) return;

    if (ts.isDecorator(node) && ts.isCallExpression(node.expression)) {
      const decoratorName = node.expression.expression.getText(sourceFile);
      if (decoratorName === "Component") {
        for (const arg of node.expression.arguments) {
          if (ts.isObjectLiteralExpression(arg)) {
            for (const prop of arg.properties) {
              if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === propertyName) {
                result = prop.initializer;
                return;
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return result;
}

function resolveTemplatePath(componentPath: string, templateUrl: string): string {
  const dir = componentPath.substring(0, componentPath.lastIndexOf("/"));
  if (templateUrl.startsWith("./")) {
    return dir + "/" + templateUrl.substring(2);
  }
  if (templateUrl.startsWith("../")) {
    const parentDir = dir.substring(0, dir.lastIndexOf("/"));
    return parentDir + "/" + templateUrl.substring(3);
  }
  return templateUrl;
}

function addUnmappedHttpCalls(
  interactions: FrontendInteraction[],
  httpCalls: HttpCall[],
  component: string,
  filePath: string,
  graph: ApplicationGraph
) {
  const mappedUrls = new Set(
    interactions
      .filter((i) => i.url)
      .map((i) => `${i.httpMethod}:${i.url}`)
  );

  for (const call of httpCalls) {
    const key = `${call.method}:${call.url}`;
    if (!mappedUrls.has(key)) {
      const backendNode = matchUrlToEndpoint(call.method, call.url, graph);
      interactions.push({
        component,
        elementType: "http_call",
        actionName: call.callerFunction || "anonymous",
        httpMethod: call.method,
        url: call.url,
        mappedBackendNode: backendNode,
        sourceFile: filePath,
        lineNumber: call.lineNumber,
      });
      mappedUrls.add(key);
    }
  }
}

function detectFileType(filePath: string): "vue" | "react" | "angular" | "javascript" | "html" | null {
  if (filePath.endsWith(".vue")) return "vue";
  if (filePath.endsWith(".tsx") || filePath.endsWith(".jsx")) return "react";
  if (filePath.endsWith(".html") && !filePath.includes("index.html")) return "html";
  if (filePath.endsWith(".ts") || filePath.endsWith(".js")) {
    return "javascript";
  }
  return null;
}

function isAngularComponent(content: string): boolean {
  return content.includes("@Component") || content.includes("@NgModule") || content.includes("@Injectable");
}

export function analyzeFrontend(
  files: { filePath: string; content: string }[],
  graph: ApplicationGraph
): FrontendInteraction[] {
  const interactions: FrontendInteraction[] = [];
  const htmlTemplates = new Map<string, string>();

  for (const file of files) {
    if (file.filePath.endsWith(".html")) {
      htmlTemplates.set(file.filePath, file.content);
    }
  }

  for (const file of files) {
    const fileType = detectFileType(file.filePath);
    if (!fileType) continue;

    if (file.filePath.includes("node_modules") || file.filePath.includes("dist/") || file.filePath.includes("build/")) {
      continue;
    }

    try {
      switch (fileType) {
        case "vue":
          interactions.push(...analyzeVueFile(file.filePath, file.content, graph));
          break;

        case "react":
          interactions.push(...analyzeReactFile(file.filePath, file.content, graph));
          break;

        case "javascript":
          if (isAngularComponent(file.content)) {
            interactions.push(...analyzeAngularFile(file.filePath, file.content, graph, htmlTemplates));
          } else {
            interactions.push(...analyzeReactFile(file.filePath, file.content, graph));
          }
          break;

        case "html":
          const bindings = parseAngularTemplateAST(file.content);
          const component = getComponentName(file.filePath);
          for (const binding of bindings) {
            interactions.push({
              component,
              elementType: binding.elementType,
              actionName: binding.handlerName,
              httpMethod: null,
              url: null,
              mappedBackendNode: null,
              sourceFile: file.filePath,
              lineNumber: binding.lineNumber,
            });
          }
          break;
      }
    } catch (err) {
      console.error(`[frontend-analyzer] Error analyzing ${file.filePath}:`, err instanceof Error ? err.message : err);
    }
  }

  return interactions;
}

export function analyzeFrontendFiles(
  files: { filePath: string; content: string }[]
): FrontendInteraction[] {
  const { ApplicationGraph: AG } = require("./application-graph");
  const emptyGraph = new AG();
  return analyzeFrontend(files, emptyGraph);
}
