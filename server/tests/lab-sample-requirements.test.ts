import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chartSampleForTest} from '../src/lab-sample-requirements.js';
import {primarySampleNames} from '../src/lab-report-specimens.js';

test('the sample labels match all 38 required-sample entries in the supplied chart',()=>{
  const cases=[
    ['CBC','EDTA whole blood'],['ESR','Whole blood'],['HbA1c','EDTA whole blood'],
    ['Blood Grouping & Rh Typing','Whole blood'],['Peripheral Blood Smear','EDTA blood or fresh smear'],
    ['Reticulocyte Count','EDTA whole blood'],['Malaria Parasite','Capillary or EDTA blood'],['Hemoglobin HPLC / electrophoresis','EDTA whole blood'],
    ['PT / INR','Citrated plasma'],['APTT','Citrated plasma'],['D-dimer','Citrated plasma'],['Fibrinogen','Citrated plasma'],['Lupus Anticoagulant','Citrated plasma'],
    ['Fasting Blood Glucose','Serum/plasma as validated'],['Post-prandial Glucose','Serum/plasma as validated'],
    ['Lipid Profile','Serum'],['Liver Function Test (LFT)','Serum'],['Kidney Function Test (KFT/RFT)','Serum or validated plasma'],
    ['Thyroid Profile (T3/T4/TSH)','Serum'],['Vitamin B12','Serum'],['Vitamin D (25-OH)','Serum'],['Calcium','Serum or validated plasma'],
    ['Electrolytes','Serum or plasma per method'],['Uric Acid','Serum'],['CRP','Serum/plasma per assay'],['ASO Titre','Serum'],['Rheumatoid Factor (RF)','Serum'],['Anti-CCP','Serum'],
    ['Beta-hCG','Serum or validated plasma'],['HIV 1 & 2 Screening','Serum/plasma per assay'],['HBsAg','Serum/plasma per assay'],['Anti-HCV','Serum/plasma per assay'],
    ['TORCH Panel','Serum'],['ANA','Serum'],['Anti-dsDNA','Serum'],['Antiphospholipid Antibodies','Serum'],['Blood Culture','Blood in culture bottles'],['Crossmatch / Compatibility Testing','Blood-bank sample'],
  ];
  assert.equal(cases.length,38);
  for(const [name,sample] of cases)assert.equal(chartSampleForTest(name),sample,name);
});

test('existing lab test names and legacy identifiers resolve to the chart without changing test data',()=>{
  const cases=[['Complete Blood Count (CBC)','EDTA whole blood'],['HbA1c (Glycosylated Haemoglobin)','EDTA whole blood'],['LIVER FUNCTION TEST (LFT)','Serum'],['RFT (RENAL FUNCTION TEST)','Serum or validated plasma'],['TFT (T3,T4,TSH )','Serum']];
  for(const [name,sample] of cases){
    const test={name:`${name} [123]`,specimen_names:['Existing generic specimen'],parameters:[{value:'12',specimen:'Old name'}]};
    const previous=JSON.stringify(test);assert.equal(primarySampleNames(test),sample);assert.equal(JSON.stringify(test),previous);
  }
});

test('tests not listed in the chart retain explicit specimens without guessing a blood sample',()=>{
  assert.equal(chartSampleForTest('CBC + ESR'),undefined);
  assert.equal(chartSampleForTest('Urine R/E'),undefined);
  assert.equal(primarySampleNames({name:'Urine R/E',specimen_names:['Urine']}),'Urine');
  assert.equal(primarySampleNames({name:'Unlisted test',parameters:[{specimen:'Configured sample'}]}),'Configured sample');
  assert.equal(primarySampleNames({name:'Unlisted test',parameters:[]}), '');
});
