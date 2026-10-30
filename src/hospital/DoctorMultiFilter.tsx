type Doctor = { id: string; name: string };

export default function DoctorMultiFilter({ doctors, value, onChange }: { doctors: Doctor[]; value: string[]; onChange: (value: string[]) => void }) {
  const options = [...new Map(doctors.map(doctor => [doctor.id, doctor])).values()];
  return <div className="co-doctor-multi-filter">
    <label><span>Filter by doctors</span><div className="co-doctor-select"><select multiple aria-label="Search and select doctors" value={value} onChange={event => onChange(Array.from(event.target.selectedOptions, option => option.value))}>
      {options.map(doctor => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}
    </select><span aria-hidden="true">{value.length ? `${value.length} doctors selected` : "All doctors"}<b>⌄</b></span></div></label>
    <small>{value.length ? `${value.length} doctors selected` : "All doctors · Click to search and select multiple"}</small>
    {value.length > 0 && <div className="co-doctor-filter-chips">{value.map(id => <button type="button" key={id} onClick={() => onChange(value.filter(item => item !== id))}>{options.find(doctor => doctor.id === id)?.name || "Doctor"}<span aria-label="Remove doctor">×</span></button>)}<button type="button" onClick={() => onChange([])}>Clear filters</button></div>}
  </div>;
}
