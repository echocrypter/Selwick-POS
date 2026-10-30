'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { UserPlus, RefreshCw, Trash2, ShieldCheck } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase/client';

type Role = 'owner' | 'manager' | 'cashier';
type Member = { user_id: string; email: string; role: Role };
export function UsersView({businessId, role}: {businessId: string; role: 'owner'|'manager'}) {
  const [members,setMembers] = useState<Member[]>([]);
  const [email,setEmail] = useState('');
  const [newRole,setNewRole] = useState<'manager'|'cashier'>('cashier');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const refresh = useCallback(async () => {
    const client=getSupabaseClient();
    if (!client) throw new Error('Cloud connection unavailable.');
    const {data,error:err}=await client.rpc('list_pos_team_members',{p_business_id:businessId});
    if(err) throw err;
    setMembers((data??[]) as Member[]);
  },[businessId]);
  useEffect(()=>{let active=true; refresh().catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[refresh]);
  const add=async(e:React.FormEvent)=>{
    e.preventDefault(); setError('');setNotice('');setBusy(true);
    try {
      const client=getSupabaseClient();if(!client)throw new Error('Cloud connection unavailable');
      const {error:err}=await client.rpc('manage_pos_team_member',{p_business_id:businessId,p_action:'add',p_email:email.trim(),p_role:newRole,p_user_id:null});
      if(err)throw err;
      setEmail('');setNotice('Member added. They can sign in and select this business.');await refresh();
    }catch(e){setError(e instanceof Error?e.message:'Could not add member')}finally{setBusy(false)}
  };
  const remove=async(member:Member)=>{
    if(!window.confirm(`Remove ${member.email} from this business?`))return;
    setBusy(true);setError('');setNotice('');
    try{const client=getSupabaseClient();if(!client)throw new Error('Cloud connection unavailable');
      const {error:err}=await client.rpc('manage_pos_team_member',{p_business_id:businessId,p_action:'remove',p_email:null,p_role:null,p_user_id:member.user_id});
      if(err)throw err;setNotice('Member removed.');await refresh();
    }catch(e){setError(e instanceof Error?e.message:'Could not remove member')}finally{setBusy(false)}
  };
  return <section className="mx-auto w-full max-w-5xl space-y-5 p-4 md:p-7 text-[#242824]">
    <div className="rounded-2xl border border-[#DDE4D7] bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-2"><div><h2 className="text-xl font-bold">Team Members</h2><p className="text-sm text-[#59645B]">Cloud business access · Owner and manager controls</p></div><button type="button" disabled={busy} onClick={()=>refresh().catch(e=>setError(e.message))} aria-label="Refresh team" className="rounded-lg border p-2"><RefreshCw size={18}/></button></div>
      <form onSubmit={add} className="flex flex-wrap items-end gap-3 rounded-xl bg-[#F1F2EC] p-4">
        <label className="flex min-w-52 flex-1 flex-col gap-1 text-sm font-semibold">Existing account email<input type="email" required autoComplete="off" value={email} onChange={e=>setEmail(e.target.value)} placeholder="cashier@example.com" className="rounded-lg border border-[#D0D8CA] bg-white p-2.5 text-[#242824]"/></label>
        <label className="flex flex-col gap-1 text-sm font-semibold">Role<select value={newRole} onChange={e=>setNewRole(e.target.value as 'cashier'|'manager')} className="rounded-lg border border-[#D0D8CA] bg-white p-2.5 text-[#242824]"><option value="cashier">Cashier</option>{role==='owner'&&<option value="manager">Manager</option>}</select></label>
        <button disabled={busy} type="submit" className="inline-flex items-center gap-2 rounded-lg bg-[#55772B] px-4 py-2.5 font-bold text-white disabled:opacity-50"><UserPlus size={17}/> Add User</button>
      </form>
      <p className="mt-2 text-xs text-[#59645B]">The staff member must first sign up in the same Supabase project. Adding a user does not create an account or send an invitation.</p>
      {error&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}{notice&&<p role="status" className="mt-3 rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
    </div>
    <div className="overflow-hidden rounded-2xl border border-[#DDE4D7] bg-white shadow-sm"><div className="border-b p-4 font-bold">Business Users ({members.length})</div><div className="divide-y divide-[#E5E9E0]">{members.map(member=><div key={member.user_id} className="flex items-center justify-between gap-3 p-4"><div className="min-w-0"><p className="truncate font-semibold">{member.email}</p><p className="mt-1 inline-flex items-center gap-1 text-xs capitalize text-[#59645B]"><ShieldCheck size={13}/>{member.role}</p></div>{member.role!=='owner'&&(role==='owner'||member.role==='cashier')&&<button disabled={busy} type="button" onClick={()=>remove(member)} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"><Trash2 size={15}/> Remove</button>}</div>)}{members.length===0&&<p className="p-5 text-sm text-[#59645B]">No members loaded. Check that the SQL migration has been installed.</p>}</div></div>
  </section>;
}
