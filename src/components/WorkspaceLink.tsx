import type {AnchorHTMLAttributes,MouseEvent} from 'react';
import {workspaceHref} from '../tab-session';
import {isPlainNavigationClick} from '../navigation';

export default function WorkspaceLink({href,onNavigate,sessionKey,...props}:Omit<AnchorHTMLAttributes<HTMLAnchorElement>,'href'|'onClick'> & {href:string;onNavigate:()=>void;sessionKey?:string}){
  function click(event:MouseEvent<HTMLAnchorElement>){
    if(!isPlainNavigationClick(event)||props.target&&props.target!=='_self')return;
    event.preventDefault();onNavigate();
  }
  return <a {...props} href={workspaceHref(href,sessionKey)} onClick={click}/>;
}
