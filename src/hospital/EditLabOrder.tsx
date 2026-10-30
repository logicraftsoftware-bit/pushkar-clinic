import {CreateLabOwnBill} from './RoleWorkspace';
type Row=Record<string,any>;
export default function EditLabOrder({order,token,onClose,onSaved}:{order:Row;token:string;onClose:()=>void;onSaved:()=>void}){
  return <CreateLabOwnBill key={order.id} token={token} editOrder={order} onClose={onClose} onCreated={onSaved}/>;
}
