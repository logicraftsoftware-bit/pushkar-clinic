export function combinedDiagnosticTests(pathology, radiology) {
    const tests = [
        ...pathology.map((test)=>({
                ...test,
                test_type: test.test_type || 'Pathology'
            })),
        ...radiology.map((test)=>({
                ...test,
                test_type: 'Radiology'
            }))
    ];
    return [
        ...new Map(tests.map((test)=>[
                test.test_id || `${test.test_type}:${String(test.name).toLowerCase()}`,
                test
            ])).values()
    ];
}
export function comparableDiagnosticTests(tests) {
    return tests.map(({ test_type: _type, ...test })=>test);
}
