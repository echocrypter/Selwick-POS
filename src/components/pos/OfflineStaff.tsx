'use client';
import React, {useEffect,useState} from 'react';
import {createUser,hashPin,readUsers,offlineDisplayName,KEY,LEGACY_BUSINESS_ID,type OfflineMember} from '@/lib/offlineUsers';
import {BUSINESS_TEMPLATES,normalizeCategories} from '@/data/businessTemplates';
import {setOfflineBusiness,setBusinessItem} from '@/lib/offlineBusinessStorage';
import { Database, WifiOff } from 'lucide-react';
import { LocalStorageMigrationModal } from '@/components/pos/LocalStorageMigrationModal';
import { posApiClient } from '@/lib/api/posApiClient';
import { getDataAccessLayer } from '@/lib/data/dataAccessLayer';
import { INITIAL_SETTINGS } from '@/data/mockData';

const validUsername = (value:string) => value.trim().length >= 2 && !/\s/.test(value.trim()) && !value.includes('@');

export function OfflineLogin({onLogin}:{onLogin:(user:OfflineMember)=>void}) {
 const [users,setUsers] = useState<OfflineMember[]>([]);
 const [mode,setMode] = useState<'signin'|'signup'>('signin');
 const [ready,setReady] = useState(false);
 useEffect(() => {
  try {
   const saved = readUsers();
   setUsers(saved);
   setMode(saved.length ? "signin" : "signup");
  } catch (err) {
   console.error("Failed to load offline accounts:", err);
  } finally {
   setReady(true);
  }
 }, []);
 const [username,setUsername] = useState('');
 const [pin,setPin] = useState('');
 const [confirm,setConfirm] = useState('');
 const [error,setError] = useState('');
 const [busy,setBusy] = useState(false);
 const [migrationModalOpen, setMigrationModalOpen] = useState(false);
 const [signupStep,setSignupStep] = useState<'credentials'|'business'>('credentials');
 const [businessName,setBusinessName] = useState('');
 const [businessAddress,setBusinessAddress] = useState('');
 const [businessPhone,setBusinessPhone] = useState('');
 const [businessType,setBusinessType] = useState('retail');
 const [customCategories,setCustomCategories] = useState('');
 const firstAccount = users.length===0;
 // Sign Up always creates a NEW business Owner; staff is created inside Users.
 const canSelfRegister = true;
 const changeMode=(next:'signin'|'signup')=>{setMode(next);setSignupStep('credentials');setUsername('');setPin('');setConfirm('');setError('');};
 const submit = async (e:React.FormEvent) => {
  e.preventDefault();setError('');
  if(mode==='signup' && signupStep==='credentials') {
   if(!validUsername(username)){setError('Username must have at least 2 characters, with no spaces or email.');return;}
   if(!/^\d{4}$/.test(pin)){setError('PIN must be exactly 4 digits.');return;}
   if(pin!==confirm){setError('PINs do not match.');return;}
   if(readUsers().some(u=>offlineDisplayName(u).toLowerCase()===username.trim().toLowerCase())){setError('This username already exists.');return;}
   setSignupStep('business');return;
  }
  setBusy(true);
  try {
   
   if (!validUsername(username)) throw Error('Username must have at least 2 characters, with no spaces or email.');
   if (mode==='signup') {
    if (!/^\d{4}$/.test(pin)) throw Error('PIN must be exactly 4 digits.');
    if (pin!==confirm) throw Error('PINs do not match.');
    // Re-read storage before saving so signup cannot overwrite another user's account.
    const current=readUsers();
    if(current.some(u=>offlineDisplayName(u).toLowerCase()===username.trim().toLowerCase())) throw Error('This username already exists. Sign in instead.');
    {
     if(!businessName.trim()) throw Error('Enter your business name.');
     if(!businessAddress.trim()) throw Error('Enter your business address.');
     if(!businessPhone.trim()) throw Error('Enter your business phone number.');
     if(businessType==='custom'&&!customCategories.trim()) throw Error('Add at least one custom category.');
    }
    const businessId=crypto.randomUUID();
    const member=await createUser(username.trim(),'owner',pin,businessId);
    const updated=[...current,member];
    {
     setOfflineBusiness(businessId);
     const template=BUSINESS_TEMPLATES.find(t=>t.id===businessType);
     const categoryNames=businessType==='custom'?customCategories.split(','):Array.from(template?.categories??[]);
     const finalCategories = normalizeCategories(categoryNames);
     const settingsPayload = {
       ...INITIAL_SETTINGS,
       storeName: businessName.trim(),
       address: businessAddress.trim(),
       phone: businessPhone.trim(),
       theme: 'light' as const,
     };
     // Persist to SQLite (authoritative store).
     try {
       const dal = getDataAccessLayer();
       await dal.saveSettings(settingsPayload);
       await dal.saveCategories(finalCategories);
     } catch (dalErr) {
       console.error('[SQLITE_ONBOARD] Failed to persist onboarding data to SQLite:', dalErr);
     }
     // Keep localStorage writes for migration wizard backward-compatibility only.
     setBusinessItem('pos_settings',JSON.stringify({storeName:businessName.trim(),address:businessAddress.trim(),phone:businessPhone.trim()}));
     setBusinessItem('pos_categories',JSON.stringify(finalCategories));
     setBusinessItem('selwick_offline_business_type',businessType);
    }
    localStorage.setItem(KEY,JSON.stringify(updated));setUsers(updated);onLogin(member);
   } else {
    const current=readUsers();
    if(!current.length) throw Error('No offline account exists yet. Please sign up.');
    // Existing accounts may have older, longer PINs; do not lock them out.
    if(!/^\d{4,12}$/.test(pin)) throw Error('Enter your PIN.');
    const matches=current.filter(u=>offlineDisplayName(u).toLowerCase()===username.trim().toLowerCase());
    let member:OfflineMember|undefined;
    for(const candidate of matches){if(await hashPin(pin,candidate.salt)===candidate.hash){member=candidate;break;}}
    if(!member) throw Error('Invalid username or PIN.');
    setOfflineBusiness(member.businessId || LEGACY_BUSINESS_ID);
    try {
      await posApiClient.login({
        name: offlineDisplayName(member),
        pin,
        businessId: member.businessId || LEGACY_BUSINESS_ID,
      });
    } catch (err) {
      console.debug('SQLite session sync deferred (offline LocalStorage mode):', err);
    }
    onLogin(member);
   }
  } catch (e) {setError(e instanceof Error?e.message:'Could not continue.');}
  finally {setBusy(false);setPin('');setConfirm('');}
 };
 const field='w-full rounded-xl border border-[#E1DDF1] bg-white px-4 py-3 text-[#211D35] placeholder:text-[#77718E] outline-none transition focus:border-[#7357E8] focus:ring-2 focus:ring-[#7357E8]/15';
 if(!ready) return <div className="flex min-h-screen items-center justify-center bg-[#F8F7FC] text-[#625B78]" aria-live="polite">Loading offline accounts...</div>;
 return <div className="min-h-dvh bg-white text-[#161A3C] lg:grid lg:grid-cols-[48%_52%]">
  <div className="relative hidden min-h-dvh overflow-hidden bg-[#F1EEFF] lg:block">
    <img src="/selwick-login-left.jpg" alt="Selwick POS retail counter and brand illustration" className="absolute inset-0 h-full w-full object-cover object-center" />
  </div>
  <div className="flex min-h-dvh items-center justify-center bg-white px-5 py-10 sm:px-10 lg:px-12">
   <div className="w-full max-w-[590px] rounded-3xl border border-[#EAE6F6] bg-white px-6 py-9 shadow-[0_12px_50px_rgba(54,39,105,0.035)] sm:px-10 sm:py-12">
    <div className="mb-8">
     <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-[#F3F0FF] px-3 py-1.5 text-sm font-medium text-[#343052]">
      <img src="/selwick-logo.png" alt="" className="h-6 w-6 rounded-md object-cover" />
      Selwick POS
     </div>
     <h1 className="text-3xl font-extrabold tracking-tight text-[#111638] sm:text-4xl">{mode==='signin'?'Welcome back':'Get started'}</h1>
     <p className="mt-3 text-sm text-[#77758E]">{mode==='signin'?'Sign in to continue to Selwick POS':'Create your offline business account'}</p>
    </div>
   <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-[#F3F0FC] p-1" role="tablist" aria-label="Offline account access">
    <button type="button" role="tab" aria-selected={mode==='signin'} onClick={()=>changeMode('signin')} className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition ${mode==='signin'?'bg-white text-[#5435C5] shadow-sm':'text-[#625B78] hover:text-[#211D35]'}`}>Sign In</button>
    {canSelfRegister ? <button type="button" role="tab" aria-selected={mode==='signup'} onClick={()=>changeMode('signup')} className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition ${mode==='signup'?'bg-white text-[#5435C5] shadow-sm':'text-[#625B78] hover:text-[#211D35]'}`}>Sign Up</button> : <span className="flex items-center justify-center px-2 text-center text-xs font-medium text-[#625B78]">Staff accounts: ask Owner</span>}
   </div>
   {mode==='signup' && signupStep==='business' && <p className="mb-4 rounded-xl bg-[#F0ECFF] px-4 py-3 text-sm font-semibold text-[#5435C5]">Step 2 of 2 · Set up your business</p>}
   <form onSubmit={submit} className="space-y-4" autoComplete="off">
    {!(mode==='signup'&&signupStep==='business') && <><div><label htmlFor="offline-username" className="mb-1.5 block text-sm font-semibold">Username</label><input id="offline-username" name="offline-username" placeholder="Enter username" required autoComplete="off" value={username} onChange={e=>setUsername(e.target.value)} className={field}/></div>
    <div><label htmlFor="offline-pin" className="mb-1.5 block text-sm font-semibold">4-Digit PIN</label><input id="offline-pin" name="offline-pin" placeholder="Enter PIN" required type="password" inputMode="numeric" autoComplete="new-password" maxLength={mode==='signup'?4:12} value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,''))} className={field}/></div>
    {mode==='signup'&&<div><label htmlFor="offline-confirm-pin" className="mb-1.5 block text-sm font-semibold">Confirm PIN</label><input id="offline-confirm-pin" name="offline-confirm-pin" placeholder="Re-enter 4-digit PIN" required type="password" inputMode="numeric" autoComplete="new-password" maxLength={4} value={confirm} onChange={e=>setConfirm(e.target.value.replace(/\D/g,''))} className={field}/></div>}
    </>}
    {mode==='signup'&&signupStep==='business'&&<>
     <div><label htmlFor="onboarding-business-name" className="mb-1.5 block text-sm font-semibold">Business Name *</label><input id="onboarding-business-name" className={field} required autoComplete="off" value={businessName} onChange={e=>setBusinessName(e.target.value)} placeholder="e.g. Dwatson Pharmacy" /></div>
     <div><label htmlFor="onboarding-business-address" className="mb-1.5 block text-sm font-semibold">Business Address *</label><input id="onboarding-business-address" className={field} required autoComplete="off" value={businessAddress} onChange={e=>setBusinessAddress(e.target.value)} placeholder="Shop address" /></div>
     <div><label htmlFor="onboarding-business-phone" className="mb-1.5 block text-sm font-semibold">Business Phone *</label><input id="onboarding-business-phone" className={field} required autoComplete="off" type="tel" value={businessPhone} onChange={e=>setBusinessPhone(e.target.value)} placeholder="03XX-XXXXXXX" /></div>
     <div><p className="mb-2 text-sm font-semibold">Business Type *</p><div className="grid grid-cols-2 gap-2">{BUSINESS_TEMPLATES.map(t=><button type="button" key={t.id} onClick={()=>setBusinessType(t.id)} aria-pressed={businessType===t.id} className={`rounded-xl border px-3 py-3 text-left text-xs font-semibold transition ${businessType===t.id?'border-[#7357E8] bg-[#F0ECFF] text-[#5435C5]':'border-[#E1DDF1] bg-white text-[#211D35] hover:border-[#9B88ED]'}`}>{t.name}</button>)}</div></div>
     {businessType==='custom'&&<div><label htmlFor="onboarding-custom-categories" className="mb-1.5 block text-sm font-semibold">Categories (comma separated) *</label><input id="onboarding-custom-categories" className={field} required autoComplete="off" value={customCategories} onChange={e=>setCustomCategories(e.target.value)} placeholder="Books, Gifts, Stationery" /></div>}
     <p className="text-xs text-[#625B78]">Your business details will appear on receipts. You can edit them later in Settings.</p>
    </>}
    {error&&<p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
    <button disabled={busy} className="w-full rounded-xl bg-[#7357E8] px-4 py-3 font-bold text-white shadow-md shadow-[#7357E8]/20 transition hover:bg-[#6045D2] disabled:opacity-60">{busy?'Please wait...':mode==='signin'?'Sign In':(signupStep==='credentials'?'Continue to Business Setup':'Create Owner Account')}</button>
    {mode==='signup'&&signupStep==='business'&&<button type="button" onClick={()=>{setSignupStep('credentials');setError('');}} className="w-full rounded-xl border border-[#E1DDF1] px-4 py-2 text-sm font-semibold text-[#5435C5]">Back to Account Details</button>}
   </form>
   <p className="mt-5 text-center text-xs leading-relaxed text-[#625B78]">{mode==='signup'?'Create a new business Owner account with its own local inventory. Staff accounts are created by the Owner or Manager from Users.': 'Sign in with the username and PIN provided by your Owner or Manager. New staff accounts are created from Users.'}</p>
   <p className="mt-3 text-center text-xs text-[#756E89]">Offline PINs are basic device access controls, not secure against browser-storage tampering.</p>
   <div className="mt-5 border-t border-[#EAE6F6] pt-4 text-center">
    <button
      type="button"
      onClick={() => setMigrationModalOpen(true)}
      className="inline-flex items-center gap-1.5 text-xs font-bold text-[#7357E8] hover:text-[#5435C5] transition"
    >
      <Database className="h-3.5 w-3.5" />
      Migrate / Restore POS Data Backup
    </button>
   </div>
   <LocalStorageMigrationModal
     isOpen={migrationModalOpen}
     onClose={() => setMigrationModalOpen(false)}
     onSuccess={() => {
       const updated = readUsers();
       setUsers(updated);
       setMode(updated.length ? 'signin' : 'signup');
     }}
   />
   <div className="mt-7 flex items-center justify-center gap-2 text-xs text-[#85829D]"><WifiOff className="h-4 w-4" /> Offline-ready point of sale</div>
   </div>
  </div>
 </div>;
}

export function OfflineUsers({role,onChange,businessId}:{role:'owner'|'manager';onChange:()=>void;businessId:string}) {
 const [users,setUsers]=useState<OfflineMember[]>([]);
 useEffect(()=>{setUsers(readUsers().filter(u=>(u.businessId||LEGACY_BUSINESS_ID)===businessId));},[businessId]);
 const [name,setName]=useState('');const [pin,setPin]=useState('');
 const [newRole,setNewRole]=useState<'manager'|'cashier'>('cashier');
 const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 const save=(list:OfflineMember[])=>{const others=readUsers().filter(u=>(u.businessId||LEGACY_BUSINESS_ID)!==businessId);localStorage.setItem(KEY,JSON.stringify([...others,...list]));setUsers(list);onChange();};
 const add=async(e:React.FormEvent)=>{
  e.preventDefault();setError('');
  if(!validUsername(name)){setError('Enter a username (at least 2 characters, no spaces or email).');return;}
  if(!/^\d{4}$/.test(pin)){setError('PIN must be exactly 4 digits.');return;}
  if(readUsers().some(u=>offlineDisplayName(u).toLowerCase()===name.trim().toLowerCase())){setError('Username already exists on this installation.');return;}
  setBusy(true);
  try{save([...users,await createUser(name.trim(),newRole,pin,businessId)]);setName('');setPin('');}
  catch{setError('Could not add user.');}finally{setBusy(false);}
 };
 return <section className="mx-auto w-full max-w-5xl space-y-5 p-5 text-[#242824]">
  <div className="rounded-2xl bg-white p-5">
   <h2 className="text-xl font-bold">Offline Users</h2>
   <p className="mt-1 text-sm text-[#59645B]">Only Owner and Manager can create staff usernames and 4-digit PINs. No email or Supabase account is needed.</p>
   <p className="mt-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Local access control is not secure against device/browser-storage access. Offline browser storage can be accessed by someone with device access. Use an authenticated backend for stronger security.</p>
   <form onSubmit={add} autoComplete="off" className="mt-4 flex flex-wrap items-end gap-3">
    <label className="flex flex-col gap-1 text-sm">Username<input name="new-offline-username" placeholder="Username" autoComplete="off" required value={name} onChange={e=>setName(e.target.value)} className="rounded-lg border p-2" /></label>
    <label className="flex flex-col gap-1 text-sm">4-Digit PIN<input name="new-offline-pin" placeholder="4-digit PIN" autoComplete="new-password" required type="password" inputMode="numeric" value={pin} maxLength={4} onChange={e=>setPin(e.target.value)} className="rounded-lg border p-2" /></label>
    <label className="flex flex-col gap-1 text-sm">Role<select value={newRole} onChange={e=>setNewRole(e.target.value as 'manager'|'cashier')} className="rounded-lg border p-2"><option value="cashier">Cashier</option>{role==='owner'&&<option value="manager">Manager</option>}</select></label>
    <button disabled={busy} className="rounded-lg bg-[#7357E8] px-4 py-2 font-semibold text-white hover:bg-[#6045D2]">Add User</button>
   </form>
   {error&&<p className="mt-2 text-sm text-red-700">{error}</p>}
  </div>
  <div className="rounded-2xl bg-white p-5"><h3 className="font-bold">Users ({users.length})</h3>
   {users.map(u=><div key={u.id} className="flex justify-between border-b py-3"><span>{offlineDisplayName(u)} · <span className="capitalize">{u.role}</span></span>{u.role!=='owner'&&(role==='owner'||u.role==='cashier')&&<button className="text-red-700" onClick={()=>{if(window.confirm(`Remove ${offlineDisplayName(u)}?`))save(users.filter(x=>x.id!==u.id));}}>Remove</button>}</div>)}
  </div>
 </section>;
}
