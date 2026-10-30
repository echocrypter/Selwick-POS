export type OfflineRole = 'owner' | 'manager' | 'cashier';
export type OfflineMember = {id:string;name:string;role:OfflineRole;salt:string;hash:string;businessId?:string};
export const LEGACY_BUSINESS_ID = 'legacy-installation';
export const KEY='selwick_offline_users_v1';
export function readUsers():OfflineMember[]{try {const v=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(v)?v:[];}catch{return [];}}
export async function hashPin(pin:string,salt:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveBits']);const bytes=Uint8Array.from(salt.match(/../g)!.map(x=>parseInt(x,16)));const result=await crypto.subtle.deriveBits({name:'PBKDF2',salt:bytes,iterations:150000,hash:'SHA-256'},key,256);return Array.from(new Uint8Array(result),x=>x.toString(16).padStart(2,'0')).join('');}
export async function createUser(name:string,role:OfflineRole,pin:string,businessId?:string):Promise<OfflineMember>{const salt=Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');return {id:crypto.randomUUID(),name,role,salt,hash:await hashPin(pin,salt),businessId};}

// Offline identities are local display names, never cloud email identities.
export function offlineDisplayName(user: Pick<OfflineMember,'name'|'role'>):string {
 const name = user.name.trim();
 return user.role === 'owner' && (!name || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name)) ? 'Offline Owner' : (name || 'Offline User');
}
