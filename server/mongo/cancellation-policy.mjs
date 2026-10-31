export class CancellationError extends Error {
    status;
    constructor(status, message){
        super(message), this.status = status;
    }
}
export function moneyCents(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 99999999.99 || Math.abs(number * 100 - Math.round(number * 100)) > 0.00001) throw new CancellationError(400, 'Enter a valid amount with at most two decimal places.');
    return Math.round(number * 100);
}
export function cancellationBlockReason(type, records) {
    if (!records.length) return 'Bill not found.';
    if (type === 'OPD') return [
        'booked',
        'confirmed'
    ].includes(String(records[0].status).trim().toLowerCase()) ? '' : 'OPD cancellation is allowed only before Present, Absent or check-in is recorded.';
    if (records.some((row)=>String(row.status).toLowerCase() === 'cancelled')) return 'This lab order is already cancelled.';
    if (records.some((row)=>row.data?.collected_at || [
            'results',
            'verification',
            'reports'
        ].includes(String(row.kind).toLowerCase()) || [
            'sample collected',
            'processing',
            'completed'
        ].includes(String(row.status).toLowerCase()) || (row.data?.sample_records || []).some((sample)=>sample.collected_at || /collected/i.test(String(sample.status))))) return 'Lab cancellation is not allowed after sample collection.';
    return '';
}
export function refundBalance(approved, refunded, amount) {
    const approvedCents = moneyCents(approved), refundedCents = moneyCents(refunded), amountCents = moneyCents(amount);
    if (amountCents === 0) throw new CancellationError(400, 'Refund amount must be greater than zero.');
    if (amountCents > approvedCents - refundedCents) throw new CancellationError(400, 'Refund exceeds the remaining approved amount.');
    return {
        refunded: (refundedCents + amountCents) / 100,
        remaining: (approvedCents - refundedCents - amountCents) / 100,
        status: approvedCents === refundedCents + amountCents ? 'Completed' : 'Partially Refunded'
    };
}
export function cancellationBookedTests(invoice, orders) {
    const invoiceTests = invoice.data?.tests;
    const tests = Array.isArray(invoiceTests) && invoiceTests.length ? invoiceTests : orders.flatMap((order)=>Array.isArray(order.data?.tests) ? order.data.tests : []);
    const unique = new Map();
    for (const test of tests){
        const name = String(test.name || test.test_name || '').trim();
        if (!name) continue;
        const amount = Number(test.amount || 0), key = String(test.test_id || `${name.toLowerCase()}:${amount}`);
        if (!unique.has(key)) unique.set(key, {
            test_id: test.test_id || null,
            name,
            amount
        });
    }
    return [
        ...unique.values()
    ];
}
