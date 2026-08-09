// REAL X12 850 generation — genuine ISA/GS/ST...SE/GE/IEA envelope structure, not simulated.
// What IS simulated: actual transmission (no real VAN/AS2 connection — see GAPS.md item
// "EDI Transport"), and the distributor's 855/856 responses (auto-generated on a timer
// to complete the demo loop, not a real distributor system responding).

const controlCounters = new Map(); // key: distributorId -> last control number

function nextControlNumber(distributorId) {
  const n = (controlCounters.get(distributorId) || 0) + 1;
  controlCounters.set(distributorId, n);
  return String(n).padStart(9, '0');
}

function pad(n, w) { return String(n).padStart(w, '0'); }
function ymd(d) { return d.replace(/-/g, ''); }

export function renderX12_850({ po, lines, store, distributor, formularyByNdc }) {
  const isaCtrl = nextControlNumber(distributor.id);
  const date = new Date().toISOString().slice(0, 10);
  const out = [];
  out.push(`ISA*00*          *00*          *ZZ*RXFORECASTBUY  *ZZ*${distributor.id.padEnd(15)}*${ymd(date).slice(2)}*1200*U*00401*${isaCtrl}*0*P*>`);
  out.push(`GS*PO*RXFORECASTBUY*${distributor.id}*${ymd(date)}*1200*1*X*004010`);
  out.push(`ST*850*0001`);
  out.push(`BEG*00*NE*${po.id}**${ymd(date)}`);
  out.push(`REF*IA*${store.storeId}`);
  out.push(`N1*ST*${store.name}*92*${store.storeId}`);
  out.push(`N3*${store.city} Pharmacy Distribution Point`);
  out.push(`N4*${store.city}*${store.state}`);
  lines.forEach((line, i) => {
    const drug = formularyByNdc.get(line.ndc);
    out.push(`PO1*${i + 1}*${line.quantityFinal}*EA*${line.unitPrice.toFixed(2)}**IN*${line.ndc}*VN*${(drug?.genericName || '').toUpperCase()} ${drug?.strength || ''}`);
    out.push(`PID*F****${drug?.genericName || ''} ${drug?.strength || ''} ${drug?.dosageForm || ''} PK${drug?.packSize || ''}`);
  });
  out.push(`CTT*${lines.length}`);
  out.push(`SE*${8 + lines.length * 2}*0001`);
  out.push(`GE*1*1`);
  out.push(`IEA*1*${isaCtrl}`);
  return out.join('\n') + '\n';
}

export function renderX12_855({ po, lines, distributor, status, promisedDate }) {
  const isaCtrl = nextControlNumber(`${distributor.id}-ack`);
  const date = new Date().toISOString().slice(0, 10);
  const out = [];
  out.push(`ISA*00*          *00*          *ZZ*${distributor.id.padEnd(15)}*ZZ*RXFORECASTBUY  *${ymd(date).slice(2)}*1200*U*00401*${isaCtrl}*0*P*>`);
  out.push(`GS*PR*${distributor.id}*RXFORECASTBUY*${ymd(date)}*1200*1*X*004010`);
  out.push(`ST*855*0001`);
  out.push(`BAK*00*AC*${po.id}**${ymd(date)}`);
  lines.forEach((line, i) => {
    out.push(`PO1*${i + 1}*${line.quantityFinal}*EA*${line.unitPrice.toFixed(2)}**IN*${line.ndc}`);
    out.push(`ACK*${status === 'Accepted' ? 'IA' : status === 'Backordered' ? 'IB' : 'IP'}*${line.quantityFinal}*EA*${ymd(promisedDate)}`);
  });
  out.push(`CTT*${lines.length}`);
  out.push(`SE*${6 + lines.length * 2}*0001`);
  out.push(`GE*1*1`);
  out.push(`IEA*1*${isaCtrl}`);
  return out.join('\n') + '\n';
}
