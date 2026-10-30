import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hasMenuAccess} from '../../src/menu-access.js';
test('module view grants expose matching menus without granting unrelated modules',()=>{
 const permissions=new Set(['billing.view','lab.order.view','appointment.view']);
 for(const menu of ['billing','lab-orders','appointments','queue'])assert.equal(hasMenuAccess('menu.'+menu+'.view',permissions),true);
 for(const menu of ['staff','access','settings'])assert.equal(hasMenuAccess('menu.'+menu+'.view',permissions),false);
 permissions.delete('lab.order.view');assert.equal(hasMenuAccess('menu.lab-orders.view',permissions),false);
 assert.equal(hasMenuAccess('menu.lab-orders.view',new Set(['menu.lab-orders.view'])),true);
});
