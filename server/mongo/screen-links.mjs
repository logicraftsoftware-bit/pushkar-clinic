import {createHash,createHmac} from 'node:crypto';

// Derive a stable, opaque share link from each screen's random credential seed.
// Existing random-token links remain valid; rotating the seed invalidates both.
export function screenShareLink(screen,secret){
  const token=createHmac('sha256',secret).update(JSON.stringify(['pushkar-screen-share-v1',screen.tenant_id,screen.id,screen.token_hash])).digest('base64url');
  return {path:`/waiting/${token}`,hash:createHash('sha256').update(token).digest('hex')};
}
