import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createAppClient,queryReference} from 'apps/client';
import {json} from 'apps';
import type {list,history,notes} from '../index.js';
import './style.css';
const client=createAppClient();
function App(){
 const [rows,setRows]=useState<any[]>([]),[selected,setSelected]=useState<string|null>(null),[events,setEvents]=useState<any[]>([]),[saved,setSaved]=useState<any[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[asOf,setAsOf]=useState('');
 async function refresh(){setBusy(true);setError('');try{
  const r=await client.query(queryReference<typeof list>('list'),{},json() as any) as any[];setRows(r);
  setSaved(await client.query(queryReference<typeof notes>('notes'),{},json() as any) as any[]);
  if(selected)setEvents(await client.query(queryReference<typeof history>('history'),{id:selected},json() as any) as any[]);
  setAsOf(new Date().toLocaleTimeString());
 }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
 async function select(id:string){setSelected(id);setError('');try{setEvents(await client.query(queryReference<typeof history>('history'),{id},json() as any) as any[]);}catch(e){setError(String(e));}}
 const row=rows.find(x=>x.id===selected);
 return <main><header><div><p className="eyebrow">EXECUTOR / WORKFLOW EXTENSION</p><h1>Durable Review</h1><p className="sub">Prepare now. Review later. Apply the saved payload once.</p></div><button onClick={refresh} disabled={busy}>{busy?'Loading…':'Load / refresh'}</button></header>
 <section className="notice"><strong>Synthetic notes only.</strong> This console is read-only. Review decisions go through Executor's approval-gated <code>decide</code> tool, in the dashboard Tools tab or an interactive MCP client. This is not a human-only or tamper-proof approval channel.</section>
 {error&&<p role="alert" className="error">{error}</p>}
 <div className="stats"><div><strong>{rows.filter(x=>x.state==='pending').length}</strong><span>Awaiting review</span></div><div><strong>{rows.filter(x=>x.state==='applied').length}</strong><span>Applied</span></div><div><strong>{saved.length}</strong><span>Saved notes</span></div><p>{asOf?'Read at '+asOf:'Load the queue to begin. No background polling.'}</p></div>
 <div className="grid"><section className="queue"><h2>Review queue <span>{rows.length}</span></h2>{rows.length===0?<p className="empty">No requests loaded. Use the create tool to prepare a synthetic note, then load the queue.</p>:rows.map(r=><button className={'request '+(selected===r.id?'selected':'')} key={r.id} onClick={()=>select(r.id)}><div><strong>{r.title}</strong><span className={'badge '+r.state}>{r.state}</span></div><small>{r.request_key}</small><small>Expires {new Date(r.expires_at).toLocaleString()}</small></button>)}</section>
 <section className="detail"><h2>Exact saved action</h2>{!row?<p className="empty">Choose a request to inspect its immutable payload, digest and audit trail.</p>:<><p className="label">CREATE NOTE</p><h3>{row.payload.title}</h3><pre className="body">{row.payload.body}</pre><p className="label">SHA-256 PAYLOAD DIGEST</p><code className="digest">{row.digest}</code><p className="label">DECISION INPUT</p><pre>{JSON.stringify({id:row.id,expectedDigest:row.digest,decision:'approve',reason:'Reviewed exact synthetic note'},null,2)}</pre><p className="hint">Copy these fields into Executor's decide tool only after inspecting the payload. Then answer its separate approval prompt. Approval expires with the request, not with this page.</p><h3>Audit trail</h3><ol>{events.map(e=><li key={e.id}><strong>{e.event}</strong><time>{new Date(e.at).toLocaleString()}</time><p>{e.detail}</p></li>)}</ol></>}</section></div>
 <footer>At-most-once local SQL apply receipt. No external API, money, message or private account is connected. App editors can change its data and code.</footer></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
