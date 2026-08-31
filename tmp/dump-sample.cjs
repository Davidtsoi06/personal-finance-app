const XLSX = require('xlsx');
const fs = require('fs');
const buf = fs.readFileSync('D:/家/home/个人理财投资软件/excel/TransactionHistory (20)HF.xlsx');
const wb = XLSX.read(buf, { type: 'buffer' });
console.log('sheets:', wb.SheetNames.join(', '));
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  console.log('=== sheet:', name, 'range:', ws['!ref'], '=== ');
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  rows.forEach((r, i) => {
    if (i < 30) console.log('row' + i + ':', JSON.stringify(r));
  });
}
const ws = wb.Sheets[wb.SheetNames[0]];
console.log('=== 单元格原始信息 ===');
for (const addr of Object.keys(ws).filter(k => !k.startsWith('!'))) {
  const c = ws[addr];
  console.log(addr, 'v=', JSON.stringify(c.v), 'w=', JSON.stringify(c.w), 't=', c.t, 'z=', JSON.stringify(c.z), 'f=', c.f || '');
}