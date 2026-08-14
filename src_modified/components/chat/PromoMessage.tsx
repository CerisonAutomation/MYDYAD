/**
 * PromoMessage — Dyad Pro subscription promos removed.
 * All trial/upgrade CTAs stripped. Only returns null.
 */
import { useAtomValue } from "jotai";

import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useSettings } from "@/hooks/useSettings";

export interface PromoMessageConfig {
  id: string;
  text: string;
  cta: string;
  target: { type: "trial-dialog" } | { type: "url"; url: string };
  weight: number;
}

/** No promo messages — all subscription marketing removed. */
export const PROMO_MESSAGES: PromoMessageConfig[] = [];

export function usePromoMessage(_chatId?: number) {
  return { visible: false, seed: 0 };
}

export function PromoMessage(_props: { seed?: number }) {
  return null;
}
