import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getDyadAppPath } from "@/paths/paths";
import { eq } from "drizzle-orm";
import log from "electron-log";
import { db } from "../../db";
import { apps } from "../../db/schema";
import {
  getTypeCheckPreconditionGuidance,
  getTypeCheckPreconditionKind,
  runTypeScriptCheck,
} from "../processors/tsc";
import { miscContracts } from "../types/misc";
import { createTypedHandler } from "./base";

const logger = log.scope("problems_handlers");

export function registerProblemsHandlers() {
  createTypedHandler(miscContracts.checkProblems, async (_, params) => {
    let appPath = "";
    try {
      // Get the app to find its path
      const app = await db.query.apps.findFirst({
        where: eq(apps.id, params.appId),
      });

      if (!app) {
        throw new DyadError(
          `App not found: ${params.appId}`,
          DyadErrorKind.NotFound,
        );
      }

      appPath = getDyadAppPath(app.path);

      const problemReport = await runTypeScriptCheck({ appPath });

      return problemReport;
    } catch (error) {
      const preconditionKind = getTypeCheckPreconditionKind(error);
      if (preconditionKind) {
        if (!appPath) {
          throw error;
        }

        const message = await getTypeCheckPreconditionGuidance({
          kind: preconditionKind,
          appPath,
        });
        logger.info("Type checking precondition failed:", message);
        throw new DyadError(message, DyadErrorKind.Precondition, {
          cause: error,
        });
      }

      logger.error("Error checking problems:", error);
      throw error;
    }
  });
}
