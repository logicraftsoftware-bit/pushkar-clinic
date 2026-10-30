// Canonical active doctor catalogue shared by OPD and laboratory referrals.
export const clinicalDoctorLookupSql=`SELECT u.id,concat(s.first_name,' ',s.last_name)name,
        coalesce(uba.branch_id,u.branch_id) branch_id,s.professional->>'doctor_qualification' doctor_qualification,
        coalesce(nullif(s.professional->'branch_fees'->coalesce(uba.branch_id,u.branch_id)::text->>'department_id','')::uuid,s.department_id,u.department_id) department_id,
        coalesce(nullif(s.professional->'branch_fees'->coalesce(uba.branch_id,u.branch_id)::text->>'consultation_fee','')::numeric,nullif(trim(s.professional->>'consultation_fee'),'')::numeric,0) consultation_fee,
        coalesce(nullif(trim(s.professional->'branch_fees'->coalesce(uba.branch_id,u.branch_id)::text->>'registration_fee'),'')::numeric,nullif(trim(s.professional->>'registration_fee'),'')::numeric,100) registration_fee,
        coalesce(nullif(trim(s.professional->'branch_fees'->coalesce(uba.branch_id,u.branch_id)::text->>'maintenance_fee'),'')::numeric,nullif(trim(s.professional->>'maintenance_fee'),'')::numeric,100) maintenance_fee,
        coalesce(nullif(trim(s.professional->>'follow_up_fee'),'')::numeric,0) follow_up_fee,
        coalesce(nullif(trim(s.professional->>'slot_duration'),'')::int,20) slot_duration,
        coalesce(nullif(trim(s.professional->>'maximum_appointments'),'')::int,0) maximum_appointments,
        coalesce(s.professional->'appointment_schedule','[]'::jsonb) appointment_schedule,s.professional->'appointment_default_schedule' appointment_default_schedule,coalesce(s.professional->'appointment_unavailable_dates','[]'::jsonb) appointment_unavailable_dates
       FROM users u
       JOIN staff_members s ON s.user_id=u.id AND s.tenant_id=u.tenant_id AND s.staff_type='Doctor' AND s.status='Active'
       LEFT JOIN user_branch_access uba ON uba.user_id=u.id AND uba.tenant_id=u.tenant_id
       WHERE u.tenant_id=$1
         AND ($2::uuid[] IS NULL OR coalesce(uba.branch_id,u.branch_id)=ANY($2))
         AND u.role='doctor' AND u.is_active=true
       ORDER BY s.first_name`;

export const labDoctorLookupSql=`SELECT DISTINCT ON (id) id,name,doctor_qualification FROM (${clinicalDoctorLookupSql}) doctors ORDER BY id,name`;

export const appointmentDoctorSelectionSql=`SELECT doctor.id,doctor.registration_fee,doctor.maintenance_fee FROM (${clinicalDoctorLookupSql}) doctor
  JOIN departments department ON department.id=doctor.department_id AND department.tenant_id=$1
    AND department.branch_id=doctor.branch_id AND department.is_active=true
  WHERE doctor.id=$3 AND doctor.department_id=$4`;
