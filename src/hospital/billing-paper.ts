// Half an A4 sheet, retaining the width used by hospital bill templates.
export const BILL_PDF_OPTIONS = {unit: "mm", format: "a5", orientation: "landscape"} as const;
export const BILL_PAGE = {width: 210, height: 148, margin: 8, footerTop: 124} as const;

// Append after each document's styles so historical A4 dimensions cannot win.
export const BILL_PRINT_CSS = `
@page{size:A5 landscape;margin:7mm}
html{min-height:0!important}
body{box-sizing:border-box;margin:0!important;min-height:132mm!important;font-size:10px;overflow-wrap:anywhere}
table{width:100%;border-collapse:collapse}thead{display:table-header-group}
tr{break-inside:avoid}th,td{padding:4px!important;overflow-wrap:anywhere}
.header img,.template-header img{max-width:100%;max-height:18mm!important;object-fit:contain}
.title{margin:5px 0!important;padding:5px 0!important;font-size:15px!important}
.title h1{font-size:15px!important}.meta,.details{gap:4px 16px!important;padding:6px!important;margin-bottom:8px!important}
.totals{max-width:100%;width:75mm!important;margin:8px 0 10px auto!important;break-inside:avoid}
.totals p,.totals div{padding:3px!important}.totals .grand{font-size:12px!important}
.receipt,.payment{padding:6px 0!important;gap:8px!important;break-inside:avoid}
.token{padding:8px!important;margin:5px 0 8px!important}.token strong{margin:4px 0!important;font-size:22px!important}
.footer,.template-footer{padding-top:4px!important;font-size:9px;break-inside:avoid}
.footer img,.template-footer img{max-width:100%;max-height:14mm;object-fit:contain}
@media screen{body{max-width:196mm;margin:7mm auto!important}}
`;

// OPD bills use a portrait half sheet; keep the other billing formats unchanged.
export const OPD_BILL_PRINT_CSS = `${BILL_PRINT_CSS}
@page{size:A5 portrait;margin:7mm}
html{margin:0;padding:0}
body{display:block;min-height:0!important;height:auto!important;width:auto;font:10px/1.3 Arial,sans-serif;background:#fff}
.header,.template-header{width:100%;break-inside:avoid}
.header img,.template-header img,.footer img,.template-footer img{display:block;width:100%!important;height:auto!important;max-height:none!important;object-position:left center}
.meta{gap:3px 10px!important;margin:0 0 6px!important}
.meta div{grid-template-columns:65px minmax(0,1fr)}
.title{margin:4px 0!important;padding:4px 0!important}
.totals{width:65mm!important;margin:6px 0!important;margin-left:auto!important}
.totals div{padding:2px!important}
.receipt{margin:0;padding:5px 0!important}
.footer{margin-top:4mm;white-space:normal;font-size:8px;line-height:1.2}
.footer p{margin:2px 0}.footer table{width:100%!important;font-size:inherit}
.footer th,.footer td{padding:1px 2px!important;font-size:inherit}
@media screen{body{max-width:134mm}}
`;
