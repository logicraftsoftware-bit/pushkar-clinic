import {createLabReportPdf} from "./lab-report-pdf";
import {optimiseReportImages} from "./lab-report-images";

self.onmessage=async(event:MessageEvent)=>{
  try{
    const input=event.data.record;
    const record=await optimiseReportImages(input.report_preprinted?{...input,pathology_header_image:undefined,pathology_footer_content:"",hospital_logo:undefined}:input);
    const report=await createLabReportPdf(record,event.data.tests);
    self.postMessage({blob:report.output("blob")});
  }catch(error){self.postMessage({error:error instanceof Error?error.message:"Unable to prepare report PDF"});}
};
