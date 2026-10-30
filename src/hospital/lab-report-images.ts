type Row=Record<string,any>;
export async function optimiseReportImages(record:Row){
  const cached=new Map<string,Promise<string>>();
  function image(source:string,maxWidth:number,opaque=false){
    if(!source?.startsWith("data:image/"))return Promise.resolve(source);
    const key=`${maxWidth}:${opaque}:${source}`;
    if(!cached.has(key))cached.set(key,(async()=>{
      const response=await fetch(source),bitmap=await createImageBitmap(await response.blob());
      try{
        const scale=Math.min(1,maxWidth/bitmap.width,1200/bitmap.height);
        const canvas=new OffscreenCanvas(Math.max(1,Math.round(bitmap.width*scale)),Math.max(1,Math.round(bitmap.height*scale)));
        const context=canvas.getContext("2d")!;
        if(opaque){context.fillStyle="#fff";context.fillRect(0,0,canvas.width,canvas.height);}
        context.drawImage(bitmap,0,0,canvas.width,canvas.height);
        const blob=await canvas.convertToBlob({type:opaque?"image/jpeg":"image/png",quality:.9});
        const bytes=new Uint8Array(await blob.arrayBuffer()),chunks:string[]=[];
        for(let i=0;i<bytes.length;i+=8192)chunks.push(String.fromCharCode(...bytes.subarray(i,i+8192)));
        return `data:${blob.type};base64,${btoa(chunks.join(""))}`;
      }finally{bitmap.close();}
    })());
    return cached.get(key)!;
  }
  const [header,logo,signatories]=await Promise.all([
    image(record.pathology_header_image,1600,true),image(record.hospital_logo,1000),
    Promise.all((record.report_signatories||[]).map(async(doctor:Row)=>({...doctor,signature:doctor.approved?await image(doctor.signature,650):""}))),
  ]);
  let footer=String(record.pathology_footer_content||"");
  if(footer.includes('data-print-footer="image"')){
    const source=footer.match(/<img[^>]+src="([^"]+)"/)?.[1];if(source)footer=footer.replace(source,await image(source,1600,true));
  }
  return {...record,pathology_header_image:header,hospital_logo:logo,report_signatories:signatories,pathology_footer_content:footer};
}
