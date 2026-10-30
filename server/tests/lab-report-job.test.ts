import {test} from "node:test";
import assert from "node:assert/strict";
import {startReportPdf} from "../../src/hospital/lab-report-job";

test("background report job returns the PDF and terminates on completion, errors and cancellation",async()=>{
  const original=globalThis.Worker;
  const instances:FakeWorker[]=[];
  class FakeWorker{
    onmessage:any;onerror:any;terminated=false;request:any;
    constructor(){instances.push(this);}
    postMessage(request:any){this.request=request;}
    terminate(){this.terminated=true;}
  }
  globalThis.Worker=FakeWorker as any;
  try{
    const job=startReportPdf({id:"report"},[]),worker=instances.at(-1)!;
    assert.equal(worker.request.record.id,"report");
    const blob=new Blob(["%PDF-1.4"],{type:"application/pdf"});
    worker.onmessage({data:{blob}});
    assert.equal(await job.promise,blob);assert.equal(worker.terminated,true);
    const failed=startReportPdf({},[]);instances.at(-1)!.onmessage({data:{error:"Invalid header image"}});
    await assert.rejects(failed.promise,/Invalid header image/);assert.equal(instances.at(-1)!.terminated,true);
    const cancelled=startReportPdf({},[]);cancelled.cancel();
    await assert.rejects(cancelled.promise,/cancelled/);assert.equal(instances.at(-1)!.terminated,true);
    const crashed=startReportPdf({},[]);instances.at(-1)!.onerror();
    await assert.rejects(crashed.promise,/Refresh and try again/);assert.equal(instances.at(-1)!.terminated,true);
  }finally{globalThis.Worker=original;}
});
