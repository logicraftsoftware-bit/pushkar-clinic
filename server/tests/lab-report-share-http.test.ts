import assert from "node:assert/strict";
import {test} from "node:test";
import express from "express";
import {once} from "node:events";
import type {AddressInfo} from "node:net";
process.env.DATABASE_URL="postgresql://test:test@localhost/test";
process.env.JWT_SECRET="test-report-sharing-secret-at-least-32-characters";
const {pool}=await import("../src/db.js");
const {publicReportRouter}=await import("../src/lab-report-sharing.js");
const {shareTokenHash}=await import("../src/lab-report-share-data.js");
const token="a".repeat(64),original=pool.query;
let row:Record<string,unknown>|null=null,queries=0;
(pool as any).query=async(sql:string,args:unknown[])=>{queries++;if(sql.startsWith("SELECT")){assert.equal(args[0],shareTokenHash(token));return {rows:row?[row]:[],rowCount:row?1:0};}return {rows:[]};};
const app=express();app.use("/reports",publicReportRouter);
const server=app.listen(0,"127.0.0.1");await once(server,"listening");
const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/reports/`;

test("report links serve a PDF without an ERP login and do not cache it",async()=>{
  row={pdf:Buffer.from("%PDF-1.7\nreport"),filename:"Lab-Report.pdf",require_payment:true,approval:{by:"doctor"},total:100,paid:100,due:0,status:"Paid"};
  const response=await fetch(url+token);assert.equal(response.status,200);assert.equal(response.headers.get("content-type"),"application/pdf");assert.match(response.headers.get("cache-control")||"",/no-store/);assert.equal(response.headers.get("x-robots-tag"),"noindex, nofollow");assert.match(await response.text(),/^%PDF-/);
});
test("reception links stop releasing the report when payment is incomplete",async()=>{
  row={pdf:Buffer.from("%PDF-1.7"),filename:"Lab-Report.pdf",require_payment:true,approval:{by:"doctor"},total:100,paid:80,due:20,status:"Unpaid"};assert.equal((await fetch(url+token)).status,404);
});
test("missing or withdrawn links and malformed tokens do not expose a PDF",async()=>{
  row=null;assert.equal((await fetch(url+token)).status,404);const before=queries;assert.equal((await fetch(url+"guess-this-link")).status,404);assert.equal(queries,before);
});
test.after(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));pool.query=original;await pool.end();});
