import assert from "node:assert/strict";
import {test} from "node:test";
import {cropPixels,footerImageHtml} from "../../src/hospital/print-image.js";
import {printTemplateBody} from "../src/print-template-validation.js";

test("uploaded image footers larger than the old text limit save without changing the artwork",()=>{
  const image=`data:image/png;base64,${"A".repeat(150000)}`,footer=footerImageHtml(image);
  assert.equal(printTemplateBody.parse({footer_content:footer}).footer_content,footer);
  assert.ok(footer.includes('data-print-footer="image"'));
  assert.ok(footer.includes('width:100%'));
  assert.equal(printTemplateBody.parse({footer_content:"<p>Hospital address</p>"}).footer_content,"<p>Hospital address</p>");
});
test("oversized footer has an actionable validation error",()=>{
  const result=printTemplateBody.safeParse({footer_content:"x".repeat(8000001)});
  assert.equal(result.success,false);
  if(!result.success)assert.match(result.error.issues[0].message,/Crop or resize/);
});
test("crop maps the selected area to original pixels and stays inside even very small images",()=>{
  assert.deepEqual(cropPixels({x:10,y:20,width:50,height:30},2000,1000),{x:200,y:200,width:1000,height:300});
  assert.deepEqual(cropPixels({x:0,y:0,width:100,height:100},2230,300),{x:0,y:0,width:2230,height:300});
  assert.deepEqual(cropPixels({x:100,y:100,width:100,height:100},1,1),{x:0,y:0,width:1,height:1});
});
test("footer image markup refuses executable or malformed image sources",()=>{
  for(const value of ['javascript:alert(1)','data:image/svg+xml;base64,AAAA','data:image/png;base64,AA" onerror="x'])assert.throws(()=>footerImageHtml(value));
});
