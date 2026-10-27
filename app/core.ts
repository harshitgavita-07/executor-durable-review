// Pure validation is shared by the deployed app and fast unit tests.
export type ReviewState='pending'|'approved'|'rejected'|'cancelled'|'expired'|'applied';
export function canonicalPayload(title:string,body:string){
 if(!title.trim() || title.length>160)throw new Error('Title must contain 1-160 characters.');
 if(!body.trim() || body.length>12000)throw new Error('Body must contain 1-12000 characters.');
 return JSON.stringify({kind:'create-note',title,body});
}
export function validateTtl(ttl:number){
 if(!Number.isInteger(ttl)||ttl<20||ttl>1800)throw new Error('Review lifetime must be an integer from 20 to 1800 seconds.');
 return ttl;
}
export function validateKey(key:string){
 if(!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,95}$/.test(key))throw new Error('Request key must be 1-96 letters, digits, dots, colons, underscores or hyphens.');
 return key;
}
export function effectiveState(state:ReviewState,expiresAt:number,now:number):ReviewState {
 return (state==='pending'||state==='approved')&&expiresAt<=now?'expired':state;
}
export function checkDigest(expected:string,actual:string){
 if(expected!==actual)throw new Error('Digest changed. Read the exact saved payload before deciding.');
}
export function decisionTarget(decision:string):'approved'|'rejected'{
 if(decision==='approve')return 'approved';
 if(decision==='reject')return 'rejected';
 throw new Error('Decision must be approve or reject.');
}
