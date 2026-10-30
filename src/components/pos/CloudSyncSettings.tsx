'use client';

import React, { useEffect, useState } from 'react';
import { Cloud, UploadCloud, Download, RefreshCw, ShieldCheck } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { clearActiveBusinessId } from '@/lib/supabase/posSync';
import { activeOfflineBusiness } from '@/lib/offlineBusinessStorage';
import { collectPosData, validateBackup, restorePosBackup, type PosBackupData } from '@/utils/localBackup';

const CONFIG_KEY = 'selwick_supabase_config';
const BUCKET = 'selwick-local-backups';
type FileRow = { name: string; created_at?: string | null; metadata?: { size?: number } | null };
type StoredBackup = { format: 'selwick-offline-cloud-v1'; businessId: string; ownerId: string; backup: PosBackupData };

export function CloudSyncSettings() {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Cloud backup is optional. Daily POS usage remains offline.');
  const [error, setError] = useState(false);
  const notify = (text: string, failed = false) => { setMessage(text); setError(failed); };
  const getClient = () => {
    const client = getSupabaseClient();
    if (!client) throw new Error('Save a valid Supabase Project URL and publishable key first.');
    return client;
  };
  const withBusy = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await action(); } catch (e) { notify(e instanceof Error ? e.message : 'Operation failed.', true); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
      if (typeof stored.url === 'string') setUrl(stored.url);
      if (typeof stored.publishableKey === 'string') setKey(stored.publishableKey);
      const client = getSupabaseClient();
      let unsubscribe: (() => void) | undefined;
      if (client) {
        void client.auth.getUser().then(({ data }) => setUserId(data.user?.id || null));
        const { data: subscription } = client.auth.onAuthStateChange((_event, session) => {
          setUserId(session?.user?.id || null);
          if (!session) setFiles([]);
        });
        unsubscribe = () => subscription.subscription.unsubscribe();
      }
      return () => unsubscribe?.();
    } catch { /* invalid or missing settings */ }
  }, []);
  const save = () => {
    try {
      const normalized = new URL(url.trim());
      if (normalized.protocol !== 'https:' && !(normalized.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(normalized.hostname))) throw new Error('Supabase URL must use HTTPS.');
      if (!normalized.hostname.endsWith('.supabase.co') && !['localhost', '127.0.0.1'].includes(normalized.hostname)) throw new Error('Enter a Supabase project URL.');
      if (!key.trim() || key.trim().startsWith('sb_secret_')) throw new Error('Use the publishable key, never a secret key.');
      localStorage.setItem(CONFIG_KEY, JSON.stringify({ url: normalized.href.replace(/\/$/, ''), publishableKey: key.trim() }));
    clearActiveBusinessId();

      setUserId(null); setFiles([]); notify('Configuration saved. Sign in to Supabase to enable private backups.');
    } catch (e) { notify(e instanceof Error ? e.message : 'Invalid settings.', true); }
  };
  const authenticate = (signup: boolean) => withBusy(async () => {
    const client = getClient();
    if (!email.trim() || !password) throw new Error('Enter your Supabase email and password.');
    // Prevent a newly authenticated Supabase identity from reusing a stale local cloud business id.
    clearActiveBusinessId();

    if (signup) {
      // Do not let a previously persisted Supabase session survive account creation.
      await client.auth.signOut();
      const { error: authError } = await client.auth.signUp({ email: email.trim(), password });
      if (authError) throw authError;
      notify('Account requested. If email confirmation is enabled, verify your email, then select Sign In.');
    } else {
      const { data, error: authError } = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (authError) throw authError;
      setUserId(data.user.id); setPassword(''); notify('Supabase connected. Private cloud backups are available.');
    }
  });
  const authorized = async () => {
    const client = getClient();
    const { data, error: authError } = await client.auth.getUser();
    if (authError || !data.user) throw new Error('Supabase session expired. Sign in again.');
    const businessId = activeOfflineBusiness();
    if (!businessId) throw new Error('Sign in to an offline POS business first.');
    return { client, uid: data.user.id, businessId };
  };
  const refresh = () => withBusy(async () => {
    const { client, uid, businessId } = await authorized();
    const { data, error: storageError } = await client.storage.from(BUCKET).list(`${uid}/${businessId}`, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });
    if (storageError) throw storageError;
    setFiles((data || []).filter(f => f.name.endsWith('.json')));
    notify(`${(data || []).length} cloud backup(s) found for this business.`);
  });
  const upload = () => withBusy(async () => {
    const { client, uid, businessId } = await authorized();
    const backup: PosBackupData = { app: 'pos-app', version: 3, createdAt: new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, source: 'manual', data: collectPosData() };
    validateBackup(backup);
    const payload: StoredBackup = { format: 'selwick-offline-cloud-v1', ownerId: uid, businessId, backup };
    const name = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const { error: storageError } = await client.storage.from(BUCKET).upload(`${uid}/${businessId}/${name}`, new Blob([JSON.stringify(payload)], { type: 'application/json' }), { contentType: 'application/json', upsert: false });
    if (storageError) throw storageError;
    notify(`Backup uploaded: ${name}. Your offline POS data is unchanged.`);
    const { data } = await client.storage.from(BUCKET).list(`${uid}/${businessId}`, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });
    setFiles((data || []).filter(f => f.name.endsWith('.json')));
  });
  const download = (name: string, restore: boolean) => withBusy(async () => {
    const { client, uid, businessId } = await authorized();
    if (!/^backup-[a-zA-Z0-9T-]+\.json$/.test(name)) throw new Error('Invalid backup filename.');
    const { data, error: storageError } = await client.storage.from(BUCKET).download(`${uid}/${businessId}/${name}`);
    if (storageError || !data) throw storageError || new Error('Backup not found.');
    if (data.size > 25 * 1024 * 1024) throw new Error('Backup exceeds the 25 MB safety limit.');
    const payload = JSON.parse(await data.text()) as StoredBackup;
    if (payload.format !== 'selwick-offline-cloud-v1' || payload.ownerId !== uid || payload.businessId !== businessId) throw new Error('Backup belongs to a different account or business. Restore blocked.');
    const backup = validateBackup(payload.backup);
    if (restore) {
      if (!window.confirm(`Restore ${name}? This REPLACES the current business products, sales, customers, expenses and settings. Export a local backup first. Continue?`)) return;
      // Preserve an automatic local recovery copy before overwriting anything.
      const safety: PosBackupData = { app: 'pos-app', version: 3, createdAt: new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, source: 'manual', data: collectPosData() };
      const a = document.createElement('a'); const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(safety, null, 2)], { type: 'application/json' }));
      a.href = objectUrl; a.download = `selwick-before-cloud-restore-${Date.now()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 15000);
      restorePosBackup(backup);
      notify('Backup restored. Reload the POS to display restored records. A safety backup was downloaded.');
    } else {
      const a = document.createElement('a'); const objectUrl = URL.createObjectURL(data);
      a.href = objectUrl; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 15000);
      notify(`Downloaded ${name}.`);
    }
  });
  const logout = () => withBusy(async () => {
    const { error: authError } = await getClient().auth.signOut();
    if (authError) throw authError;
    clearActiveBusinessId();

    setUserId(null); setFiles([]); notify('Disconnected from Supabase. Local POS data remains available.');
  });
  const input = 'w-full rounded-xl border border-[#DAD4EF] bg-white px-3 py-2.5 text-sm text-[#211D35] placeholder:text-[#756E89] focus:outline-none focus:ring-2 focus:ring-[#7357E8]';
  const btn = 'rounded-xl bg-[#7357E8] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#6045D2] disabled:opacity-50';
  return <section className="space-y-4 rounded-2xl border border-[#E5E0F2] bg-white p-5 shadow-sm">
    <div className="flex items-center gap-2"><Cloud className="h-5 w-5 text-[#7357E8]"/><h3 className="text-base font-bold text-[#211D35]">Optional Supabase Cloud Backup</h3></div>
    <p className="text-sm text-[#625B78]">Billing stays offline. Internet is needed only to sign in and upload, download or restore backups.</p>
    <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-[#392879]">Project URL<input className={`${input} mt-1`} value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://project.supabase.co"/></label><label className="text-xs font-semibold text-[#392879]">Publishable Key<input className={`${input} mt-1`} value={key} onChange={e=>setKey(e.target.value)} type="password" placeholder="sb_publishable_..."/></label></div>
    <button type="button" className={btn} onClick={save}>Save Connection</button>
    <div className="rounded-xl border border-[#E5E0F2] bg-[#F8F6FF] p-4 space-y-3"><div className="flex items-center gap-2 text-sm font-semibold text-[#392879]"><ShieldCheck className="h-4 w-4"/> Private Backup Authentication</div>
    {userId ? <div className="flex flex-wrap items-center gap-3"><span className="text-sm text-[#392879]">Supabase signed in</span><button type="button" disabled={busy} className={btn} onClick={logout}>Sign Out</button></div> : <><p className="text-xs text-[#625B78]">Use an account in your own Supabase project. This does not change your offline POS username or PIN.</p><div className="grid gap-3 sm:grid-cols-2" data-form-type="other"><input className={input} type="email" name="selwick-supabase-email" placeholder="Supabase email" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} value={email} onChange={e=>setEmail(e.target.value)}/><input className={input} type="password" name="selwick-supabase-password" placeholder="Supabase password" autoComplete="new-password" autoCorrect="off" autoCapitalize="none" spellCheck={false} value={password} onChange={e=>setPassword(e.target.value)}/></div><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className={btn} onClick={()=>authenticate(false)}>Cloud Sign In</button><button type="button" disabled={busy} className="rounded-xl border border-[#7357E8] px-4 py-2.5 text-sm font-semibold text-[#5435C8]" onClick={()=>authenticate(true)}>Create Cloud Account</button></div></>}
    </div>
    {userId && <div className="space-y-3"><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className={`${btn} flex items-center gap-2`} onClick={upload}><UploadCloud className="h-4 w-4"/>Upload Backup</button><button type="button" disabled={busy} className="flex items-center gap-2 rounded-xl border border-[#DAD4EF] px-4 py-2.5 text-sm font-semibold text-[#392879]" onClick={refresh}><RefreshCw className="h-4 w-4"/>Refresh History</button></div>{files.map(f=><div key={f.name} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#E5E0F2] p-3"><span className="break-all text-xs font-medium text-[#211D35]">{f.name}</span><div className="flex gap-2"><button type="button" disabled={busy} onClick={()=>download(f.name,false)} className="flex items-center gap-1 text-sm font-semibold text-[#5435C8]"><Download className="h-4 w-4"/>Download</button><button type="button" disabled={busy} onClick={()=>download(f.name,true)} className="text-sm font-semibold text-[#A43D50]">Restore</button></div></div>)}</div>}
    <div role="status" aria-live="polite" className={`rounded-xl border p-3 text-sm ${error?'border-red-200 bg-red-50 text-red-800':'border-[#DAD4EF] bg-[#F8F6FF] text-[#392879]'}`}>{message}</div>
    <p className="text-xs text-[#625B78]">Run the included SQL setup in your Supabase project before uploading. Cloud restore replaces local business data after confirmation. Always keep a separate local backup. Never use a service-role or secret key here.</p>
  </section>;
}

