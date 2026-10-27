import test from 'node:test';import assert from 'node:assert/strict';
import {canonicalPayload,validateTtl,validateKey,effectiveState,checkDigest,decisionTarget} from '../app/core.ts';
test('canonical payload keeps exact whitespace and meaning',()=>{assert.equal(canonicalPayload('A',' B '),'{"kind":"create-note","title":"A","body":" B "}');});
test('reject empty and excessive payload',()=>{for(const [t,b] of [['','body'],['title',' '],['x'.repeat(161),'body'],['title','x'.repeat(12001)]])assert.throws(()=>canonicalPayload(t,b));});
test('bounded integer expiry',()=>{for(const n of [19,1801,NaN,20.5])assert.throws(()=>validateTtl(n));assert.equal(validateTtl(20),20);assert.equal(validateTtl(1800),1800);});
test('bounded stable request key',()=>{for(const k of ['',':bad','a'.repeat(97),'a b'])assert.throws(()=>validateKey(k));assert.equal(validateKey('a.b:c_d-1'),'a.b:c_d-1');});
test('expiry applies only to unfinished eligible states',()=>{assert.equal(effectiveState('pending',10,10),'expired');assert.equal(effectiveState('approved',10,11),'expired');for(const s of ['rejected','cancelled','applied'])assert.equal(effectiveState(s,1,2),s);});
test('digest mismatch is rejected',()=>{assert.throws(()=>checkDigest('a','b'));checkDigest('same','same');});
test('decision enum is closed',()=>{assert.equal(decisionTarget('approve'),'approved');assert.equal(decisionTarget('reject'),'rejected');assert.throws(()=>decisionTarget('approved'));});
