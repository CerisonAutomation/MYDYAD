import log from "electron-log";
import { readSettings, writeSettings } from "../main/settings";
import { listSupabaseOrganizations } from "./supabase_management_client";

const logger = log.scope("supabase_return_handler");

export interface SupabaseOAuthReturnParams {
  token: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Handles OAuth return by storing organization credentials.
 * Stores ALL organizations the token has access to (not just the first).
 * Falls back to legacy fields only if no organizations are found.
 */
export async function handleSupabaseOAuthReturn({
  token,
  refreshToken,
  expiresIn,
}: SupabaseOAuthReturnParams) {
  let orgs: any[] = [];
  let errorOccurred = false;

  try {
    orgs = await listSupabaseOrganizations(token);
  } catch (error) {
    logger.error("Error listing Supabase organizations:", error);
    errorOccurred = true;
  }

  // Re-read settings right before writing to avoid stale-read race conditions.
  // The async listSupabaseOrganizations call above may take time, during which
  // other org credentials could be written (e.g. token refreshes). Reading here
  // ensures we merge into the latest state.
  const settings = readSettings();

  if (!errorOccurred && orgs.length > 0) {
    // Store ALL organizations the token has access to
    const existingOrgs = settings.supabase?.organizations ?? {};
    const newOrgs: Record<string, any> = { ...existingOrgs };

    for (const org of orgs) {
      newOrgs[org.slug] = {
        accessToken: {
          value: token,
        },
        refreshToken: {
          value: refreshToken,
        },
        expiresIn,
        tokenTimestamp: Math.floor(Date.now() / 1000),
        name: org.name,
      };
    }

    logger.info(`Connected ${orgs.length} Supabase organization(s) via OAuth`);

    writeSettings({
      supabase: {
        ...settings.supabase,
        organizations: newOrgs,
      },
    });
  } else {
    // Fallback to legacy fields only if no organizations were found
    writeSettings({
      supabase: {
        ...settings.supabase,
        accessToken: {
          value: token,
        },
        refreshToken: {
          value: refreshToken,
        },
        expiresIn,
        tokenTimestamp: Math.floor(Date.now() / 1000),
      },
    });
  }
}
