import {createHash,randomBytes} from "node:crypto";
export const shareTokenHash=(token:string)=>createHash("sha256").update(token).digest("hex");
export const newReportShareToken=()=>randomBytes(32).toString("hex");
export function decodeReportPdf(value:string){
  if(value.length>16_000_000||!value||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw new Error("Report PDF is invalid or too large");
  const bytes=Buffer.from(value,"base64");if(bytes.length>12_000_000||bytes.subarray(0,5).toString()!=="%PDF-")throw new Error("Select a valid report PDF up to 12 MB");return bytes;
}
