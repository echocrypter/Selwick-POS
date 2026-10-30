/** Offline-only data partitioning by business. Not a security boundary against device access. */
export const BUSINESS_KEYS = ['pos_products','pos_customers','pos_sales','pos_expenses','pos_settings','pos_held','pos_categories','selwick_offline_business_type'] as const;
export const LEGACY_ID = 'legacy-installation';
const ACTIVE_KEY = 'selwick_active_offline_business_v1';
export function setOfflineBusiness(id: string | null): void {
  if (id) sessionStorage.setItem(ACTIVE_KEY,id);
  else sessionStorage.removeItem(ACTIVE_KEY);
}
export function activeOfflineBusiness(): string | null { return sessionStorage.getItem(ACTIVE_KEY); }
export function scopedKey(key: string, id: string): string { return `selwick_business:${id}:${key}`; }
export function migrateLegacyBusiness(): void {
  const marker = scopedKey('migration_done',LEGACY_ID);
  if (localStorage.getItem(marker)) return;
  // Copy old installation records, never remove original values.
  for (const key of BUSINESS_KEYS) {
    const oldValue = localStorage.getItem(key);
    if (oldValue !== null && localStorage.getItem(scopedKey(key,LEGACY_ID)) === null)
      localStorage.setItem(scopedKey(key,LEGACY_ID),oldValue);
  }
  localStorage.setItem(marker,'1');
}
export function getBusinessItem(key:string):string|null {
  const id=activeOfflineBusiness();
  if (!id) return null;
  if (id===LEGACY_ID) migrateLegacyBusiness();
  return localStorage.getItem(scopedKey(key,id));
}
export function setBusinessItem(key:string,value:string):void {
  const id=activeOfflineBusiness();
  if (!id) throw new Error('Sign in before editing business data.');
  if (id===LEGACY_ID) migrateLegacyBusiness();
  localStorage.setItem(scopedKey(key,id),value);
}
export function removeBusinessItem(key:string):void {
  const id=activeOfflineBusiness();
  if (!id) throw new Error('Sign in before editing business data.');
  if (id===LEGACY_ID) migrateLegacyBusiness();
  localStorage.removeItem(scopedKey(key,id));
}
