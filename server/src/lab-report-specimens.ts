import {chartSampleForTest} from './lab-sample-requirements.js';
type Row=Record<string,any>;
export function primarySampleNames(test:Row):string{
  const chart=chartSampleForTest(test.name||test.test_name);
  if(chart)return chart;
  const clean=(values:unknown[])=>[...new Set(values.filter((value):value is string=>typeof value==='string').map(value=>value.trim()).filter(Boolean))];
  const configured=clean([...(Array.isArray(test.specimen_names)?test.specimen_names:[]),test.specimen_name,test.specimen]);
  return (configured.length?configured:clean((test.parameters||[]).map((parameter:Row)=>parameter.specimen||parameter.specimen_name))).join(', ');
}
