type Department={id?:string;branch_id?:string;is_active?:boolean};
type Doctor={id?:string;branch_id?:string;department_id?:string};
export function appointmentSelection<D extends Department,U extends Doctor>(departments:D[],doctors:U[],branchId:string,departmentId:string,doctorId:string){
  const branchDepartments=branchId?departments.filter(item=>item.branch_id===branchId&&item.is_active!==false):[];
  const department=branchDepartments.find(item=>item.id===departmentId);
  const departmentDoctors=department?doctors.filter(item=>item.branch_id===branchId&&item.department_id===departmentId):[];
  return {departments:branchDepartments,doctors:departmentDoctors,department,doctor:departmentDoctors.find(item=>item.id===doctorId)};
}
