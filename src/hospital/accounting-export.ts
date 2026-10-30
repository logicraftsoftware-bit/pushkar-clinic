const xml=(value:unknown)=>String(value??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const encoder=new TextEncoder();
export function downloadAccountingWorkbook(headers:string[],rows:(string|number)[][],filename:string){
  const bytes=accountingWorkbook(headers,rows),url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const link=document.createElement('a');link.href=url;link.download=filename;link.style.display='none';
  document.body.appendChild(link);
  try{link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
}
export function accountingPrintDocument(title:string,subtitle:string,headers:string[],rows:(string|number)[][],summary:(string|number)[][]=[]){
  return `<!doctype html><html><head><meta charset="utf-8"><title>${xml(title)}</title><style>@page{size:A4 landscape;margin:10mm}body{font:10px Arial,sans-serif;color:#142139;margin:0}h1{font-size:18px;margin:0 0 8px}p{margin:0 0 15px;color:#52627a}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #ccd4df;padding:6px;text-align:left;white-space:pre-line;overflow-wrap:anywhere}th{background:#eff3f9}thead{display:table-header-group}tr{break-inside:avoid}</style></head><body><h1>${xml(title)}</h1><p>${xml(subtitle)}</p><table><thead><tr>${headers.map(label=>`<th>${xml(label)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(value=>`<td>${xml(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>${summary.length?`<table style="width:400px;margin:20px 0 0 auto"><tbody>${summary.map(row=>`<tr>${row.map(value=>`<td>${xml(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`:''}</body></html>`;
}
export function printAccountingDocument(html:string,onError:(message:string)=>void){
  const frame=document.createElement('iframe');frame.title='Accounting report print';frame.setAttribute('aria-hidden','true');
  frame.style.cssText='position:fixed;left:-10000px;top:0;width:1100px;height:700px;border:0;';
  const cleanup=()=>frame.remove();
  frame.onload=()=>{try{
    const target=frame.contentWindow;if(!target)throw Error('Unable to open the print document');
    target.addEventListener('afterprint',cleanup,{once:true});target.focus();target.print();
  }catch(error){cleanup();onError(error instanceof Error?error.message:'Unable to print accounting report');}};
  frame.srcdoc=html;document.body.appendChild(frame);
  setTimeout(cleanup,120000);
}
function crc32(bytes:Uint8Array){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function zip(files:Record<string,string>){
  const chunks:Uint8Array[]=[],central:Uint8Array[]=[];let offset=0;
  for(const [name,content] of Object.entries(files)){
    const filename=encoder.encode(name),data=encoder.encode(content),crc=crc32(data);
    const local=new Uint8Array(30+filename.length),view=new DataView(local.buffer);
    view.setUint32(0,0x04034b50,true);view.setUint16(4,20,true);view.setUint32(14,crc,true);view.setUint32(18,data.length,true);view.setUint32(22,data.length,true);view.setUint16(26,filename.length,true);local.set(filename,30);
    const directory=new Uint8Array(46+filename.length),cv=new DataView(directory.buffer);
    cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint32(16,crc,true);cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);cv.setUint16(28,filename.length,true);cv.setUint32(42,offset,true);directory.set(filename,46);
    chunks.push(local,data);central.push(directory);offset+=local.length+data.length;
  }
  const end=new Uint8Array(22),ev=new DataView(end.buffer),size=central.reduce((n,x)=>n+x.length,0);
  ev.setUint32(0,0x06054b50,true);ev.setUint16(8,central.length,true);ev.setUint16(10,central.length,true);ev.setUint32(12,size,true);ev.setUint32(16,offset,true);
  const output=new Uint8Array(offset+size+22);let index=0;for(const chunk of [...chunks,...central,end]){output.set(chunk,index);index+=chunk.length;}return output;
}
export function accountingWorkbook(headers:string[],rows:(string|number)[][]){
  const column=(index:number)=>{let name='';for(let value=index+1;value;value=Math.floor((value-1)/26))name=String.fromCharCode(65+(value-1)%26)+name;return name;};
  const sheet=[headers,...rows].map((row,i)=>`<row r="${i+1}">${row.map((value,j)=>typeof value==='number'?`<c r="${column(j)}${i+1}"><v>${Number.isFinite(value)?value:0}</v></c>`:`<c r="${column(j)}${i+1}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join('')}</row>`).join('');
  return zip({
    '[Content_Types].xml':'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels':'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':'<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Accounting" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${sheet}</sheetData><autoFilter ref="A1:${column(headers.length-1)}${rows.length+1}"/></worksheet>`,
  });
}
