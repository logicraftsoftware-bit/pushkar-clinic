export type CropRect={x:number;y:number;width:number;height:number};
export function cropPixels(crop:CropRect,width:number,height:number){
  const x=Math.max(0,Math.min(99,crop.x)),y=Math.max(0,Math.min(99,crop.y));
  const left=Math.min(width-1,Math.round(x*width/100)),top=Math.min(height-1,Math.round(y*height/100));
  return {x:left,y:top,width:Math.min(width-left,Math.max(1,Math.round(Math.max(1,Math.min(100-x,crop.width))*width/100))),height:Math.min(height-top,Math.max(1,Math.round(Math.max(1,Math.min(100-y,crop.height))*height/100)))};
}
export function footerImageHtml(image:string){
  if(!/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(image))throw new Error("Choose a PNG, JPG or WEBP footer image");
  return `<div data-print-footer="image"><img src="${image}" alt="Hospital footer" style="display:block;width:100%;height:auto;max-height:35mm;object-fit:contain;margin:0 auto"></div>`;
}
