import type {RequestHandler} from 'express';
import {gzip,constants} from 'node:zlib';

// Compress serialized JSON asynchronously, without buffering downloads or SSE.
// Fast compression saves network time while keeping the API event loop free.
export const jsonCompression:RequestHandler=(request,response,next)=>{
  const send=response.send.bind(response);
  response.send=body=>{
    if(typeof body!=='string'||!String(response.getHeader('Content-Type')||'').includes('application/json')||
      Buffer.byteLength(body)<2048||request.method==='HEAD'||response.statusCode===204||response.statusCode===304||
      response.hasHeader('Content-Encoding')||/\bno-transform\b/i.test(String(response.getHeader('Cache-Control')||'')))return send(body);
    response.vary('Accept-Encoding');
    if(request.acceptsEncodings('gzip')!=='gzip')return send(body);
    gzip(body,{level:constants.Z_BEST_SPEED},(error,compressed)=>{
      if(response.destroyed||response.writableEnded)return;
      if(error){next(error);return;}
      if(compressed.length>=Buffer.byteLength(body)){send(body);return;}
      response.setHeader('Content-Encoding','gzip');
      response.removeHeader('Content-Length');
      send(compressed);
    });
    return response;
  };
  next();
};
