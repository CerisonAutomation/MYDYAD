// Promo message — disabled in Agent2 mode (no promotions needed).

export function usePromoMessage(_chatId?: number) {
  return { visible: false, seed: 0 };
}

export function PromoMessage(_props: { seed: number }) {
  return null;
}
