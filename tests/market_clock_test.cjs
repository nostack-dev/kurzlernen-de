const assert=require('node:assert/strict');
const M=require('../market-clock-core.js');

let s=M.state(Date.parse('2026-09-22T07:00:00Z')); // 09:00 Berlin
assert.equal(s.phase,'premarket_countdown');
assert(s.text.includes('10:00'),s.text);

s=M.state(Date.parse('2026-09-22T09:00:00Z')); // 11:00 Berlin
assert.equal(s.phase,'open_countdown');
assert(s.text.includes('15:30'),s.text);

s=M.state(Date.parse('2026-09-22T14:00:00Z')); // 16:00 Berlin
assert.equal(s.phase,'open');
assert(s.text.includes('22:00'),s.text);

s=M.state(Date.parse('2026-09-22T20:30:00Z')); // 22:30 Berlin
assert.equal(s.phase,'closed');
assert(s.text.includes('morgen 15:30'),s.text);

s=M.state(Date.parse('2026-09-26T10:00:00Z')); // Saturday
assert.equal(s.phase,'closed');
assert(s.text.toLowerCase().includes('montag'),s.text);

assert.equal(M.isTradingDay(2026,11,26),false,'Thanksgiving must be closed');

// Europe has left DST, New York has not yet: actual German opening is 14:30.
s=M.state(Date.parse('2026-10-30T12:00:00Z'));
assert.equal(s.phase,'open_countdown');
assert(s.text.includes('14:30'),s.text);

console.log('market clock: OK');
