export const branchOverviewCountsSql = `SELECT
    (SELECT count(DISTINCT u.id)::int FROM users u WHERE u.tenant_id=$1 AND u.role='doctor'
      AND (u.branch_id=$2 OR EXISTS(SELECT 1 FROM user_branch_access a WHERE a.tenant_id=$1 AND a.user_id=u.id AND a.branch_id=$2))) doctors,
    (SELECT count(*)::int FROM patients WHERE tenant_id=$1 AND branch_id=$2) patients,
    (SELECT count(*)::int FROM role_work_items WHERE tenant_id=$1 AND branch_id=$2 AND workspace='laboratory'
      AND lower(kind) IN ('orders','pos','sample collection','results','verification','reports')) lab_orders,
    (SELECT count(*)::int FROM clinical_appointments WHERE tenant_id=$1 AND branch_id=$2) appointments,
    (SELECT count(*)::int FROM ipd_admissions WHERE tenant_id=$1 AND branch_id=$2) admissions,
    (SELECT count(*)::int FROM departments WHERE tenant_id=$1 AND branch_id=$2) departments,
    (SELECT count(*)::int FROM beds WHERE tenant_id=$1 AND branch_id=$2) beds`;
