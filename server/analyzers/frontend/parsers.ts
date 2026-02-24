import _ts from "typescript";
import * as vueSfc from "@vue/compiler-sfc";
import * as ngCompiler from "@angular/compiler";

import ts = _ts;

export interface TemplateBinding {
  elementType: string;
  eventType: string;
  handlerName: string;
  lineNumber: number;
}

export function parseTypeScript(code: string, fileName: string): ts.SourceFile {
  let scriptKind = ts.ScriptKind.TS;
  if (fileName.endsWith(".tsx") || fileName.endsWith(".jsx")) {
    scriptKind = ts.ScriptKind.TSX;
  } else if (fileName.endsWith(".js")) {
    scriptKind = ts.ScriptKind.JS;
  }
  return ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, scriptKind);
}

export function getLineNumber(sourceFile: ts.SourceFile, pos: number): number {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

export function extractVueScript(content: string): string {
  const sfcResult = vueSfc.parse(content);
  const descriptor = sfcResult.descriptor;
  if (descriptor.scriptSetup) return descriptor.scriptSetup.content;
  if (descriptor.script) return descriptor.script.content;
  return "";
}

export function parseVueTemplateAST(content: string): { bindings: TemplateBinding[]; scriptContent: string; scriptOffset: number } {
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

export function walkVueASTNode(nodes: any[], bindings: TemplateBinding[]): void {
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

export function parseAngularTemplateAST(templateContent: string): TemplateBinding[] {
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

export function parseJSXTemplate(sourceFile: ts.SourceFile): TemplateBinding[] {
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
                handlerName = extractInlineHandlerTarget(expr);
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

export function extractInlineHandlerTarget(node: ts.ArrowFunction | ts.FunctionExpression): string {
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

export function classifyElement(tagName: string): string {
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

export function findDecoratorProperty(sourceFile: ts.SourceFile, propertyName: string): ts.Expression | null {
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

export function resolveTemplatePath(componentPath: string, templateUrl: string): string {
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
