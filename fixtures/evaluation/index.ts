import { defineApp, object, string, query, mutation, workflow, router } from 'apps';
import { always } from 'apps/operations/approval';
const put = mutation({input:object({message:string()}), approval:always()},async(ctx,{message})=>ctx.sql.exec('INSERT INTO notes (message) VALUES (?) RETURNING id,message',message).one());
const list = query({input:object({})},async(ctx)=>ctx.sql.exec('SELECT * FROM notes').toArray());
const approvalFlow=workflow({input:object({message:string()})},async(ctx,input)=>await ctx.step.runMutation('review-and-save',put,input));
const start=mutation({input:object({message:string()})},async(ctx,input)=>await ctx.workflows.start({workflow:'approvalFlow',input,key:input.message}));
const runs=query({input:object({})},async(ctx)=>await ctx.workflows.list({limit:20}));
export default defineApp({}, {tools:router({put,list,start,runs}),workflows:{approvalFlow}});
