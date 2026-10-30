import assert from "node:assert/strict";
import { test } from "node:test";
import { laboratoryWorksheetHtml } from "../../src/hospital/lab-worksheet.js";
test("worksheet uses Admin template and leaves measured results blank",()=>{
  const html=laboratoryWorksheetHtml({patient_name:"Patient <A>",pathology_header_image:"https://example.com/header.png",pathology_footer_content:"Approved hospital footer",tests:[{name:"CBC",parameters:[{name:"Haemoglobin",value:"13.4",unit:"g/dL",reference_text:"Source reference interval"}]}]});
  assert.match(html,/header\.png/);assert.match(html,/Approved hospital footer/);assert.match(html,/PATIENT &lt;A&gt;/);assert.match(html,/Haemoglobin/);assert.doesNotMatch(html,/13\.4/);
  assert.match(html,/Source reference interval/);
});
