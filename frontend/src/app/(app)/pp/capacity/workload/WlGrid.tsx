"use client";

import { f0, f1 } from "@/lib/pp";
import { EN, WL_FIELDS, WL_GROUPS, signed, type WlField, type WlMonth, type WlPlan, type WlTable } from "./wl";

// 👥 ตาราง WORKLOAD (แบบชีท 9. ManPower) ใช้ร่วมกัน: CAPACITY › WORKLOAD (กรอกคนที่มีจริงได้) · DASHBOARD (ดูอย่างเดียว)
//   cell = ช่องคนที่มีจริง (Current / Actual) · ไม่ส่ง = แสดงตัวเลขอย่างเดียว
export function WlGrid({ table, ms, upd, cell }: { table: WlTable; ms: WlMonth[]; upd: string; cell?: (m: string, row: string, f: WlField, label: string) => React.ReactNode }) {
  const prevM = ms[0].month,
    curM = ms[1].month;
  const C = table.tot.cur;
  const show = (m: string, row: string, f: WlField, label: string, v: number) => (cell ? cell(m, row, f, label) : f0(v));
  return (
    <div className="pp-scroll wl-scroll">
      <table className="wl-table">
        <thead>
          <tr className="wl-h1">
            <th className="wl-stick wl-year" rowSpan={3} colSpan={2}>
              <span>YEAR</span>
              {curM.slice(0, 4)}
            </th>
            <th colSpan={11} className="wl-mon is-prev">
              {EN(prevM)} <span>N-1</span>
            </th>
            <th rowSpan={2} colSpan={4} className="wl-mon is-cur">
              Current ({EN(curM).slice(0, 3)})<span>Update {upd}</span>
            </th>
            {ms.slice(1).map((m, i) => (
              <th key={m.month} colSpan={6} className={`wl-mon ${i === 0 ? "is-n" : ""}`}>
                {EN(m.month)} <span>N{i ? `+${i}` : ""}</span>
              </th>
            ))}
          </tr>
          <tr className="wl-h2">
            <th colSpan={4} className="wl-blk">
              Plan
            </th>
            <th className="is-day">{ms[0].workdays.length} Day</th>
            <th>Actual</th>
            <th colSpan={5} className="wl-blk">
              Actual
            </th>
            {ms.slice(1).map((m) => (
              <FragmentHead key={m.month} days={m.workdays.length} />
            ))}
          </tr>
          <tr className="wl-h3">
            <th className="wl-blk">PDT</th>
            <th>Direct</th>
            <th>Ind1</th>
            <th>Ind2</th>
            <th className="is-day">Total</th>
            <th>Total</th>
            <th className="wl-blk">Production</th>
            <th>Direct</th>
            <th>Ind1</th>
            <th>Ind2</th>
            <th className="is-cur">Total</th>
            <th className="wl-blk">Direct</th>
            <th>Ind1</th>
            <th>Ind2</th>
            <th className="is-cur">Total</th>
            {ms.slice(1).map((m) => (
              <SubHead key={m.month} />
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((x, i) => {
            const g = WL_GROUPS.find((g) => g.grp === x.r.grp)!;
            const first = i === 0 || table.rows[i - 1].r.grp !== x.r.grp;
            return (
              <tr key={x.r.key} className={`wl-row ${first ? "is-first" : ""}`} style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
                {first && (
                  <td rowSpan={g.n} className="wl-stick wl-grp">
                    {x.r.grp}
                  </td>
                )}
                <td className="wl-stick wl-name">
                  <span>{x.r.name}</span>
                  {x.r.dept && <i title="ดึง PDT / Direct จาก Capacity">CAP</i>}
                </td>
                <PlanCells p={x.prevPlan} />
                <td className="wl-blk">{f0(x.prevAct.prod)}</td>
                {WL_FIELDS.map((f) => (
                  <td key={f} className={cell ? "wl-edit" : ""}>
                    {show(prevM, x.r.key, f, `${x.r.name} ${f} ${EN(prevM)}`, x.prevAct[f])}
                  </td>
                ))}
                <td className="is-cur">{f0(x.prevAct.total)}</td>
                {WL_FIELDS.map((f, j) => (
                  <td key={f} className={`${cell ? "wl-edit" : ""} ${j === 0 ? "wl-blk" : ""}`}>
                    {show(curM, x.r.key, f, `${x.r.name} ${f} current`, x.cur[f])}
                  </td>
                ))}
                <td className="is-cur">{f0(x.cur.total)}</td>
                {x.plans.map((p, j) => (
                  <PlanCells key={j} p={p} />
                ))}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="wl-tot">
            <td className="wl-stick wl-totlab" colSpan={2}>
              TOTAL
            </td>
            <PlanCells p={table.tot.prevPlan} total sum={sumOf(table.rows.map((x) => x.prevPlan.diff))} />
            <td className="wl-blk">{f0(table.tot.prevAct.prod)}</td>
            <td>{f0(table.tot.prevAct.direct)}</td>
            <td>{f0(table.tot.prevAct.ind1)}</td>
            <td>{f0(table.tot.prevAct.ind2)}</td>
            <td className="is-sum">{f1(table.tot.prevAct.total)}</td>
            <td className="wl-blk">{f0(C.direct)}</td>
            <td>{f0(C.ind1)}</td>
            <td>{f0(C.ind2)}</td>
            <td className="is-sum">{f1(C.total)}</td>
            {table.tot.plans.map((p, j) => (
              <PlanCells key={j} p={p} total sum={sumOf(table.rows.map((x) => x.plans[j].diff))} />
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function WlLegend() {
  return (
    <div className="wl-legend">
      <span>
        <i className="is-day" /> Total แผน (Direct + Ind1 + Ind2)
      </span>
      <span>
        <i className="is-cur" /> คนที่มีจริง
      </span>
      <span>
        <b className="wl-pos">+n</b> / <b className="wl-neg">−n</b> Actual = คนที่มีจริง (Direct) − แผน (Direct) · ติดลบ = คนขาด
      </span>
      <span>PDT / Direct / Production = ยอดจากไฟล์ Work load (IMPORT WORK LOAD EXCEL) · เดือนที่ยังไม่ได้ Import ใช้ยอดที่ระบบคำนวณจาก Capacity</span>
    </div>
  );
}

function FragmentHead({ days }: { days: number }) {
  return (
    <>
      <th colSpan={4} className="wl-blk">
        Plan
      </th>
      <th className="is-day">{days} Day</th>
      <th>Actual</th>
    </>
  );
}
function SubHead() {
  return (
    <>
      <th className="wl-blk">PDT</th>
      <th>Direct</th>
      <th>Ind1</th>
      <th>Ind2</th>
      <th className="is-day">Total</th>
      <th>Total</th>
    </>
  );
}
// Actual ของแถว TOTAL: รวมส่วนที่เกิน (+) และส่วนที่ขาด (−) แยกกัน (ปัดรายหน่วยงานแบบเดียวกับช่องในตาราง)
const sumOf = (ds: number[]) => {
  const r = ds.map((d) => Math.round(d));
  return { pos: r.filter((d) => d > 0).reduce((a, b) => a + b, 0), neg: r.filter((d) => d < 0).reduce((a, b) => a + b, 0) };
};

function PlanCells({ p, total, sum }: { p: WlPlan; total?: boolean; sum?: { pos: number; neg: number } }) {
  const d = Math.round(p.diff);
  return (
    <>
      <td className="wl-blk">{f0(p.pdt)}</td>
      <td>{f1(p.direct)}</td>
      <td>{total ? f0(p.ind1) : f1(p.ind1)}</td>
      <td>{total ? f0(p.ind2) : f1(p.ind2)}</td>
      <td className={total ? "is-sum" : "is-day"}>{f1(p.total)}</td>
      {total ? (
        <td className="wl-actsum" title={sum ? `เกิน +${sum.pos} · ขาด ${sum.neg} · สุทธิ ${signed(sum.pos + sum.neg)} คน` : undefined}>
          {sum && (
            <>
              <b className="wl-pos">+{sum.pos}</b>
              <b className="wl-neg">{sum.neg < 0 ? `−${Math.abs(sum.neg)}` : "−0"}</b>
              <small className={sum.pos + sum.neg < 0 ? "wl-neg" : sum.pos + sum.neg > 0 ? "wl-pos" : "wl-zero"}>สุทธิ {signed(sum.pos + sum.neg)}</small>
            </>
          )}
        </td>
      ) : (
        <td className={d > 0 ? "wl-pos" : d < 0 ? "wl-neg" : "wl-zero"}>{signed(d)}</td>
      )}
    </>
  );
}
