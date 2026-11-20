import jwt from 'jsonwebtoken';

const certificatesUrl='https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const invalid=()=>Object.assign(Error('Phone verification expired or invalid. Request a new OTP.'),{status:401,code:'INVALID_FIREBASE_TOKEN'});
export function firebasePhoneVerifier(fetcher=(...args)=>globalThis.fetch(...args)) {
  let cache,expires=0,pending;
  async function certificates(){
    if(cache&&Date.now()<expires)return cache;
    if(!pending)pending=(async()=>{
      const response=await fetcher(certificatesUrl,{signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw Error('Certificate provider unavailable');
      const keys=await response.json();
      if(!keys||typeof keys!=='object'||Array.isArray(keys))throw Error('Invalid certificates');
      cache=keys;
      const seconds=Number(/max-age=(\d+)/.exec(response.headers.get('cache-control')??'')?.[1]??300);
      expires=Date.now()+Math.min(21600,seconds)*1000;
      return keys;
    })().finally(()=>{pending=null;});
    return pending;
  }
  return async(token,project)=>{
    const decoded=jwt.decode(token,{complete:true});
    if(!project||decoded?.header.alg!=='RS256'||typeof decoded.header.kid!=='string')throw invalid();
    let keys;
    try{keys=await certificates();}catch{throw Object.assign(Error('Phone verification service is temporarily unavailable. Try again.'),{status:503});}
    const key=Object.hasOwn(keys,decoded.header.kid)?keys[decoded.header.kid]:null;
    if(typeof key!=='string')throw invalid();
    try{
      const claims=jwt.verify(token,key,{algorithms:['RS256'],audience:project,issuer:`https://securetoken.google.com/${project}`});
      const now=Math.floor(Date.now()/1000);
      if(typeof claims.sub!=='string'||!claims.sub.length||claims.sub.length>128||!Number.isInteger(claims.exp)||!Number.isInteger(claims.iat)||claims.iat>now||!Number.isInteger(claims.auth_time)||claims.auth_time>now||claims.auth_time<now-600||claims.firebase?.sign_in_provider!=='phone'||!/^\+91[6-9]\d{9}$/.test(claims.phone_number??''))throw invalid();
      return claims;
    }catch{throw invalid();}
  };
}
export const verifyFirebasePhoneToken=firebasePhoneVerifier();
