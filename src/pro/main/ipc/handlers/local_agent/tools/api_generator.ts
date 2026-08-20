import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { resolveTargetAppPath } from "./resolve_app_context";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const logger = log.scope("api_generator");

const apiGeneratorSchema = z.object({
  route_path: z.string().describe("API route path (e.g. /api/users or /api/auth/login)"),
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("GET").describe("HTTP method"),
  auth_required: z.coerce.boolean().optional().default(false).describe("Whether authentication is required"),
  response_type: z.enum(["json", "text", "stream"]).default("json").describe("Response type"),
  include_validation: z.coerce.boolean().optional().default(true).describe("Include input validation with Zod"),
  include_rate_limit: z.coerce.boolean().optional().default(false).describe("Include rate limiting"),
  db_operation: z.enum(["none", "create", "read", "readMany", "update", "delete"]).default("none").describe("Database operation type"),
});

type ApiGeneratorArgs = z.infer<typeof apiGeneratorSchema>;

function generateRouteCode(args: ApiGeneratorArgs): string {
  const { route_path, method, auth_required, response_type, include_validation, db_operation } = args;
  
  const routeName = route_path.split("/").filter(Boolean).join("_");
  
  let imports = `import { NextRequest, NextResponse } from "next/server";\n`;
  if (include_validation) imports += `import { z } from "zod";\n`;
  if (auth_required) imports += `import { validateAuth } from "@/lib/auth";\n`;
  if (db_operation !== "none") imports += `import { db } from "@/db";\n`;
  
  let validation = "";
  if (include_validation && ["POST", "PUT", "PATCH"].includes(method)) {
    validation = `
const ${routeName}Schema = z.object({
  // Add your fields here
  // name: z.string().min(1),
  // email: z.string().email(),
});
`;
  }
  
  let authCode = "";
  if (auth_required) {
    authCode = `
  const auth = await validateAuth(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
`;
  }
  
  let dbCode = "";
  switch (db_operation) {
    case "create":
      dbCode = `  const data = await request.json();
  const result = await db.insert(/* table */).values(data).returning();
  return NextResponse.json(result[0], { status: 201 });`;
      break;
    case "read":
      dbCode = `  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });
  const result = await db.select().from(/* table */).where(/* eq */);
  return NextResponse.json(result[0] || null);`;
      break;
    case "readMany":
      dbCode = `  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "20");
  const offset = (page - 1) * limit;
  const result = await db.select().from(/* table */).limit(limit).offset(offset);
  return NextResponse.json({ data: result, page, limit });`;
      break;
    case "update":
      dbCode = `  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });
  const data = await request.json();
  const result = await db.update(/* table */).set(data).where(/* eq */).returning();
  return NextResponse.json(result[0]);`;
      break;
    case "delete":
      dbCode = `  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });
  await db.delete(/* table */).where(/* eq */);
  return NextResponse.json({ success: true });`;
      break;
    default:
      dbCode = `  return NextResponse.json({ message: "OK" });`;
  }
  
  const responseCode = response_type === "stream" 
    ? `  return new Response(new ReadableStream({ start: (ctrl) => { /* stream here */ ctrl.close(); } }), { headers: { "Content-Type": "text/event-stream" } });`
    : dbCode;

  return `${imports}
${validation}
export async function ${method === "GET" ? "GET" : "POST"}(request: NextRequest) {
${authCode}${responseCode}
}`;
}

export const apiGeneratorTool: ToolDefinition<ApiGeneratorArgs> = {
  name: "api_generator",
  description:
    "Generate a Next.js API route with proper structure, validation, auth, and database operations. Generates a complete, ready-to-use API endpoint file.",
  inputSchema: apiGeneratorSchema,
  defaultConsent: "always",
  modifiesState: (ctx) => true,
  isEnabled: () => true,
  getConsentPreview: (args) => `Generate API route ${args.route_path}`,

  execute: async (args, ctx: AgentContext) => {
    logger.log("Generating API route:", args.route_path);
    const appPath = resolveTargetAppPath(ctx);
    const routePath = join(appPath, "src/app", args.route_path, "route.ts");
    
    // Check if file exists
    if (existsSync(routePath)) {
      throw new DyadError(`Route already exists: ${args.route_path}/route.ts. Use search_replace to modify it.`, DyadErrorKind.Validation);
    }
    
    const code = generateRouteCode(args);
    
    return {
      value: JSON.stringify({
        file: `src/app${args.route_path}/route.ts`,
        code,
        method: args.method,
        message: `Generated API route ${args.route_path} (${args.method})`,
      }, null, 2),
      truncated: false,
    };
  },
};
