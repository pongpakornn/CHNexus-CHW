"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { GroupRow, useCollapsed } from "@/components/tables/GroupRow";
import {
  Card,
  Empty,
  Loading,
  PageBody,
  PageHeader,
  SearchBox,
} from "@/components/layout/Page";
import { useToast } from "@/components/notifications/Toasts";
import { api, download } from "@/lib/api";
import { useLive } from "@/lib/live";
import { useDebounced } from "@/lib/useDebounced";
import { EdpBar } from "../EdpBar";
import { dmy, type Meta, type Scope } from "../edp";
import "../edp.css";

// 🏭 EDP › EDP PLANNING (ตารางติดตาม) - ย้ายจากหน้า EDP Planning ของ EDP Systems
//   กะ DAY / NIGHT = รวมยอดตามชิ้นงาน · ALL = รายการ์ด · ไม่เลือกวันที่ (LIVE) = แผนล่าสุดของกะ อัพเดทเองทุก 5 วินาที
//   แก้ OPERATOR / REMARK / DONE ในแถวได้ (สิทธิ์ EDIT) · EXPORT EXCEL ของวันที่ (DAY + NIGHT + รวม)
type Row = {
  id: number;
  customer: string | null;
  partCode: string | null;
  partNo: string | null;
  partName: string | null;
  plan: number;
  actual: number;
  qtyHg: number;
  hgAct: number;
  cycleTime: number | null;
  totalTimeMin: number | null;
  operator: string | null;
  remark: string | null;
  isDone: boolean;
  isProblem: boolean;
  shift: string;
};
type Res = { date: string | null; rows: Row[] };

// TOTAL TIME (ชั่วโมง จาก Server = HG ACT × 195 ÷ 3600) แสดงเป็นทศนิยม เช่น 1.3
const hhmm = (h: number | null) => (h == null ? "-" : (Math.round(h * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 }));

export default function EdpPlanning() {
  const toast = useToast();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [live, setLive] = useState(true);
  const [date, setDate] = useState("");
  const [shift, setShift] = useState<Scope>("DAY");
  const [key, setKey] = useState("");
  const q = useDebounced(key, 250);
  const [data, setData] = useState<Res | null>(null);
  const [draft, setDraft] = useState<Record<number, Partial<Row>>>({});
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  });

  useEffect(() => {
    api<Meta>("/edp/meta")
      .then(setMeta)
      .catch((e) =>
        toastRef.current.show("ERROR", (e as Error).message, "error"),
      );
  }, []);

  const load = useCallback(
    async (quiet = false) => {
      try {
        const r = await api<Res>("/edp/monitor", {
          query: { date: live ? undefined : date, shift, q },
        });
        setData(r);
        if (live && r.date) setDate(r.date.slice(0, 10));
      } catch (e) {
        if (!quiet)
          toastRef.current.show(
            "ERROR",
            "โหลดข้อมูลไม่สำเร็จ\n" + (e as Error).message,
            "error",
          );
        if (!quiet) setData({ date: null, rows: [] });
      }
    },
    [live, date, shift, q],
  );
  useEffect(() => {
    const t = setTimeout(() => load(), 0);
    return () => clearTimeout(t);
  }, [load]);
  useLive(["edp"], () => load(true), live ? 30_000 : 0); // ⚡ ทันทีจาก Server · สำรองทุก 30 วิ

  const can = meta?.can.planning ?? false;
  const val = <K extends keyof Row>(r: Row, k: K) =>
    (draft[r.id]?.[k] ?? r[k]) as Row[K];
  const dirty = (r: Row) =>
    draft[r.id] &&
    (["operator", "remark", "isDone"] as const).some(
      (k) => draft[r.id][k] !== undefined && draft[r.id][k] !== r[k],
    );

  const [savingId, setSavingId] = useState<number | null>(null);
  async function save(r: Row) {
    if (savingId !== null) return; // busy-lock: no double submit
    setSavingId(r.id);
    try {
      const res = await api<{ message: string }>(`/edp/monitor/${r.id}`, {
        method: "PUT",
        body: {
          operator: val(r, "operator"),
          remark: val(r, "remark"),
          // DONE เขียนเฉพาะตอนติ๊กเปลี่ยนจริง (ไม่งั้นค่ารวมของกลุ่มไปทับการ์ดใบแรก · CHK-05) · แถวรวม = ทุกการ์ดของชิ้นงานนี้
          isDone: draft[r.id]?.isDone !== undefined && draft[r.id].isDone !== r.isDone ? draft[r.id].isDone : null,
          group: shift !== "ALL",
        },
      });
      toast.show("SAVED", res.message, "ok");
      setDraft((d) => {
        const n = { ...d };
        delete n[r.id];
        return n;
      });
      load(true);
    } catch (e) {
      toast.show("ERROR", (e as Error).message, "error");
    } finally {
      setSavingId(null);
    }
  }

  const rows = useMemo(() => data?.rows ?? [], [data]);
  // จัดกลุ่มตามลูกค้า (แบบตาราง CIMS) · กดหัวกลุ่ม = พับ / กาง
  const [collapsed, toggleGroup] = useCollapsed();
  const groups = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) {
      const k = r.customer || "-";
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()];
  }, [rows]);
  const sum = (k: "plan" | "actual" | "qtyHg" | "hgAct") =>
    rows.reduce((a, r) => a + r[k], 0);

  if (!meta) return <Loading />;
  return (
    <PageBody className="md-gray md-color-actions">
      <PageHeader
        icon="/icons/ForecastOrder.png"
        title="EDP • EDP PLANNING"
        subtitle={`ติดตามแผนผลิต · ${live ? "LIVE (แผนล่าสุด อัพเดทเอง)" : "ย้อนดูวันที่ " + (date ? dmy(date) : "-")}`}
      />
      <EdpBar
        date={date}
        onDate={(d) => (setLive(false), setDate(d))}
        shift={shift}
        onShift={setShift}
      >
        <button
          type="button"
          className={`fill-btn ${live ? "is-on" : ""}`}
          onClick={() => setLive(true)}
        >
          ● LIVE
        </button>
        <SearchBox
          value={key}
          onChange={setKey}
          placeholder="ค้นหา PART CODE / PART NO / CUSTOMER"
          className="md-search w-[300px] max-w-full"
        />
        <button
          type="button"
          className="cta-btn is-green"
          disabled={!date}
          onClick={() =>
            download("/edp/export", { date }).catch((e) =>
              toast.show(
                "ERROR",
                "Export ไม่สำเร็จ\n" + (e as Error).message,
                "error",
              ),
            )
          }
        >
          ⬇ EXPORT EXCEL
        </button>
      </EdpBar>
      <Card>
        {!data ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty>
            ไม่มีแผนการผลิตของ {date ? dmy(date) : "-"} กะ {shift}
          </Empty>
        ) : (
          <div className="overflow-auto">
            <table className="data-table t-center w-full">
              <thead className="sticky top-0 z-10">
                <tr>
                  {shift === "ALL" && <th>SHIFT</th>}
                  <th>CUSTOMER</th>
                  <th>PART CODE</th>
                  <th>PART NO</th>
                  <th>PART NAME</th>
                  <th>QTY HG</th>
                  <th>HG ACT</th>
                  <th>PLAN</th>
                  <th>ACTUAL</th>
                  <th>CT</th>
                  <th>TOTAL TIME</th>
                  <th>OPERATOR</th>
                  <th>REMARK</th>
                  <th>DONE</th>
                  {can && <th>ACTION</th>}
                </tr>
              </thead>
              <tbody>
                {groups.map(([gk, list]) => (
                  <Fragment key={gk}>
                    <GroupRow
                      colSpan={(shift === "ALL" ? 14 : 13) + (can ? 1 : 0)}
                      label="CUSTOMER"
                      value={gk}
                      count={list.length}
                      collapsed={collapsed.has(gk)}
                      onToggle={() => toggleGroup(gk)}
                    />
                    {!collapsed.has(gk) &&
                      list.map((r) => (
                        <tr
                          key={r.id}
                          className={`${r.isProblem ? "edp-row-bad" : ""} ${r.isDone ? "edp-row-done" : ""}`}
                        >
                          {shift === "ALL" && <td>{r.shift}</td>}
                          <td>{r.customer}</td>
                          <td className="font-mono">{r.partCode}</td>
                          <td className="font-extrabold">{r.partNo}</td>
                          <td
                            className="max-w-[260px] truncate"
                            title={r.partName ?? ""}
                          >
                            {r.partName}
                            {r.isProblem && (
                              <span className="edp-badge is-bad ml-2">⛔</span>
                            )}
                          </td>
                          <td>{r.qtyHg.toLocaleString()}</td>
                          <td>{r.hgAct.toLocaleString()}</td>
                          <td>{r.plan.toLocaleString()}</td>
                          <td>{r.actual.toLocaleString()}</td>
                          <td>{r.cycleTime ?? "-"}</td>
                          <td className="font-mono">{hhmm(r.totalTimeMin)}</td>
                          <td>
                            {can ? (
                              <input
                                className="field !h-9 min-w-[120px]"
                                value={val(r, "operator") ?? ""}
                                maxLength={100}
                                onChange={(e) =>
                                  setDraft((d) => ({
                                    ...d,
                                    [r.id]: {
                                      ...d[r.id],
                                      operator: e.target.value,
                                    },
                                  }))
                                }
                              />
                            ) : (
                              (r.operator ?? "-")
                            )}
                          </td>
                          <td>
                            {can ? (
                              <input
                                className="field !h-9 min-w-[160px]"
                                value={val(r, "remark") ?? ""}
                                onChange={(e) =>
                                  setDraft((d) => ({
                                    ...d,
                                    [r.id]: {
                                      ...d[r.id],
                                      remark: e.target.value,
                                    },
                                  }))
                                }
                              />
                            ) : (
                              (r.remark ?? "-")
                            )}
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              disabled={!can}
                              checked={!!val(r, "isDone")}
                              onChange={(e) =>
                                setDraft((d) => ({
                                  ...d,
                                  [r.id]: {
                                    ...d[r.id],
                                    isDone: e.target.checked,
                                  },
                                }))
                              }
                            />
                          </td>
                          {can && (
                            <td>
                              <button
                                type="button"
                                className={`cta-btn is-sm ${dirty(r) ? "is-green" : "is-gray"}`}
                                disabled={!dirty(r) || savingId !== null}
                                onClick={() => save(r)}
                              >
                                SAVE
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                  </Fragment>
                ))}
                <tr className="edp-total">
                  <td colSpan={shift === "ALL" ? 5 : 4}>รวมทั้งหมด (TOTAL)</td>
                  <td>{sum("qtyHg").toLocaleString()}</td>
                  <td>{sum("hgAct").toLocaleString()}</td>
                  <td>{sum("plan").toLocaleString()}</td>
                  <td>{sum("actual").toLocaleString()}</td>
                  <td>-</td>
                  <td className="font-mono">
                    {hhmm(rows.reduce((a, r) => a + (r.totalTimeMin ?? 0), 0))}
                  </td>
                  <td colSpan={can ? 4 : 3} />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </PageBody>
  );
}
