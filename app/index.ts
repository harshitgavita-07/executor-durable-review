import {defineApp,object,string,number,query,mutation,router,workflow,NonRetryableError,type MutationContext,type QueryContext} from 'apps';
import {always} from 'apps/operations/approval';
import {canonicalPayload,validateTtl,validateKey,effectiveState,checkDigest,decisionTarget,type ReviewState} from './core.js';
type Row={id:string;request_key:string;title:string;payload:string;digest:string;state:ReviewState;created_at:number;expires_at:number;decided_at:number|null;applied_at:number|null;note_id:string|null;reason:string|null};
const requirements={};
type MC=MutationContext<typeof requirements>;
type QC=QueryContext<typeof requirements>;
const Id=object({id:string()});
function getRow(sql:QC['sql'],id:string):Row {
 const row=sql.exec<Row>('SELECT * FROM reviews WHERE id=?',id).toArray()[0];
 if(!row)throw new Error('Review not found.');return row;
}
function audit(sql:QC['sql'],id:string,event:string,at:number,detail:string){sql.exec('INSERT INTO audit (review_id,event,at,detail) VALUES (?,?,?,?)',id,event,at,detail);}
function view(row:Row){return {...row,state:effectiveState(row.state,row.expires_at,Date.now()),payload:JSON.parse(row.payload)};}
async function digest(payload:string){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload));return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');}
export const inspect=query({description:'Read the immutable saved payload and its digest before deciding.',input:Id},async({sql}, {id})=>view(getRow(sql,id)));
export const list=query({description:'List the latest 100 review requests with effective expiry state.',input:object({})},async({sql})=>sql.exec<Row>('SELECT * FROM reviews ORDER BY created_at DESC,id DESC LIMIT 100').toArray().map(view));
export const history=query({description:'Read the local app audit trail. It is not a tamper-proof compliance log.',input:Id},async({sql},{id})=>{getRow(sql,id);return sql.exec('SELECT * FROM audit WHERE review_id=? ORDER BY id',id).toArray();});
export const notes=query({description:'Read synthetic notes applied by approved requests.',input:object({})},async({sql})=>sql.exec('SELECT * FROM notes ORDER BY created_at,id').toArray());
export const runs=query({description:'Read durable workflow run status.',input:object({})},async(ctx)=>await ctx.workflows.list({limit:100}));
export const create=mutation({description:'Prepare an immutable synthetic note for review. Idempotent by requestKey; never applies a note.',input:object({requestKey:string(),title:string(),body:string(),ttlSeconds:number().default(600)})},async(ctx,{requestKey,title,body,ttlSeconds})=>{
 validateKey(requestKey);validateTtl(ttlSeconds);const payload=canonicalPayload(title,body),hash=await digest(payload),now=Date.now(),id=crypto.randomUUID();
 return ctx.sql.transaction(sql=>{
  const previous=sql.exec<Row>('SELECT * FROM reviews WHERE request_key=?',requestKey).toArray()[0];
  if(previous){if(previous.payload!==payload)throw new Error('Request key already identifies a different payload.');return view(previous);}
  sql.exec('INSERT INTO reviews (id,request_key,title,payload,digest,state,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)',id,requestKey,title,payload,hash,'pending',now,now+ttlSeconds*1000);
  audit(sql,id,'prepared',now,hash);return view(getRow(sql,id));
 });
});
export const decide=mutation({description:'Review the saved payload, then approve or reject this exact digest. Requires Executor approval. Does not apply an action. Use Executor dashboard Tools or an interactive MCP connection, not the app UI.',input:object({id:string(),expectedDigest:string(),decision:string(),reason:string().default('')}),approval:always()},async(ctx,{id,expectedDigest,decision,reason})=>{
 const target=decisionTarget(decision);if(reason.length>1000)throw new Error('Reason must be at most 1000 characters.');const now=Date.now();
 return ctx.sql.transaction(sql=>{
  const row=getRow(sql,id);checkDigest(expectedDigest,row.digest);const current=effectiveState(row.state,row.expires_at,now);
  if(current==='expired')throw new Error('Review has expired; prepare a new request.');
  if(current===target)return view(row);
  if(current!=='pending')throw new Error('A terminal or already decided request cannot change decision.');
  sql.exec('UPDATE reviews SET state=?,decided_at=?,reason=? WHERE id=? AND state=\'pending\'',target,now,reason,id);
  audit(sql,id,target,now,reason);return view(getRow(sql,id));
 });
});
export const cancel=mutation({description:'Cancel a pending or approved request before apply. Once applied, cancellation cannot undo it.',input:Id},async(ctx,{id})=>{
 const now=Date.now();return ctx.sql.transaction(sql=>{
  const row=getRow(sql,id);if(row.state==='cancelled')return view(row);
  if(row.state!=='pending'&&row.state!=='approved')throw new Error('Only pending or approved requests can be cancelled.');
  const state=effectiveState(row.state,row.expires_at,now)==='expired'?'expired':'cancelled';
  sql.exec('UPDATE reviews SET state=?,reason=? WHERE id=?',state,'Cancelled before apply',id);audit(sql,id,state,now,'Cancelled before apply');return view(getRow(sql,id));
 });
});
// One synchronous transaction includes both the note and review receipt. The workflow engine
// records its own step receipt around this transaction. No external effect is claimed atomic.
export const apply=mutation({description:'Apply only an approved, unexpired exact payload to this app\'s synthetic notes table. Repeating returns the stored receipt.',input:Id},async(ctx,{id})=>{
 const now=Date.now();return ctx.sql.transaction(sql=>{
  const row=getRow(sql,id);if(row.state==='applied')return {state:'applied',noteId:row.note_id,replayed:true};
  const state=effectiveState(row.state,row.expires_at,now);
  if(state==='expired') {sql.exec('UPDATE reviews SET state=\'expired\' WHERE id=?',id);audit(sql,id,'expired',now,'No action applied');return {state:'expired',noteId:null,replayed:false};}
  if(state!=='approved')return {state,noteId:null,replayed:false};
  const payload=JSON.parse(row.payload),noteId='note:'+id;
  sql.exec('INSERT INTO notes (id,review_id,title,body,created_at) VALUES (?,?,?,?,?)',noteId,id,payload.title,payload.body,now);
  sql.exec('UPDATE reviews SET state=\'applied\',note_id=?,applied_at=? WHERE id=? AND state=\'approved\'',noteId,now,id);
  audit(sql,id,'applied',now,noteId);return {state:'applied',noteId,replayed:false};
 });
});
export const afterReview=workflow({description:'Durably wait for a separately reviewed request, then apply once. Bounded by the request expiry.',input:Id},async(ctx,{id})=>{
 for(let i=0;i<185;i++){
  const row=await ctx.step.runQuery('review-state-'+i,inspect,{id}) as ReturnType<typeof view>;
  if(row.state==='approved'||row.state==='expired'||row.state==='applied')return await ctx.step.runMutation('apply-'+i,apply,{id});
  if(row.state==='rejected'||row.state==='cancelled')return {state:row.state,noteId:null};
  await ctx.step.sleep('review-wait-'+i,'10 seconds');
 }
 throw new NonRetryableError('Review wait exceeded its bounded loop. Inspect the request; no action was applied.');
});
export const start=mutation({description:'Start or recover the wait workflow for one saved request. Stable per request id; repeated calls do not create another run.',input:Id},async(ctx,{id})=>{
 getRow(ctx.sql,id);return await ctx.workflows.start({workflow:'afterReview',input:{id},key:'review:'+id});
});
export default defineApp(requirements,{tools:router({create,inspect,list,history,notes,runs,decide,cancel,apply,start}),workflows:{afterReview}});
