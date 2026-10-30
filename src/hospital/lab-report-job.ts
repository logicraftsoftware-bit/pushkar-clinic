export function startReportPdf(record:Record<string,any>,tests:Record<string,any>[]){
  const worker=new Worker(new URL("./lab-report.worker.ts",import.meta.url),{type:"module"});
  let rejectJob:(reason:Error)=>void=()=>{};
  let timer:ReturnType<typeof setTimeout>;
  const stop=()=>{clearTimeout(timer);worker.terminate();};
  const promise=new Promise<Blob>((resolve,reject)=>{
    rejectJob=reject;
    timer=setTimeout(()=>{stop();reject(new Error("Report preparation timed out. Please retry."));},30000);
    worker.onmessage=event=>{stop();if(event.data.error)reject(new Error(event.data.error));else resolve(event.data.blob);};
    worker.onerror=()=>{stop();reject(new Error("Unable to prepare report PDF. Refresh and try again."));};
    worker.postMessage({record,tests});
  });
  return {promise,cancel:()=>{stop();rejectJob(new Error("Report preparation cancelled"));}};
}
