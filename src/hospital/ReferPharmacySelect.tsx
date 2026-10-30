type Pharmacy={id:string;name:string;address?:string;discount_percentage?:number|string};
// The application's GlobalSelectSearch supplies search and keyboard selection.
export default function ReferPharmacySelect({rows,value,onChange,disabled=false}:{rows:Pharmacy[];value:string;onChange:(id:string)=>void;disabled?:boolean}){
  return <label><span>Refer Pharmacy</span><select aria-label="Refer Pharmacy" value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}>
    <option value="">Not Applicable</option>
    {rows.map(row=><option key={row.id} value={row.id}>{row.name} · {Number(row.discount_percentage||0)}%{row.address?` · ${row.address}`:''}</option>)}
  </select></label>;
}
