declare module "jsbarcode" {
  export default function JsBarcode(target:{encodings?:Array<{data:string}>},value:string,options:Record<string,unknown>):unknown;
}
