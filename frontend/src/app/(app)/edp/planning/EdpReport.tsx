"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/modals/Modal";
import { Empty, Loading, SearchBox } from "@/components/layout/Page";
import { DateRange } from "@/components/forms/DateRange";
import { useToast } from "@/components/notifications/Toasts";
import { api } from "@/lib/api";
import { daysAgo, today } from "@/lib/format";
import { useDebounced } from "@/lib/useDebounced";
import { dmy } from "../edp";

// 📋 EDP REPORT: ประวัติแก้ไขการ์ดจากหน้า PLAN SUBMISSION (เพราะอะไร · เมื่อไร · ใคร) · งานที่ผลิตไม่ได้ · การ์ดที่จบกะแล้วยังไม่อัพเดท
type Row = { kind: "EDIT" | "PROBLEM" | "MISSED"; at: string | null; planDate: string; shift: string; round: number; part: string; oldText: string; newText: string; reason: string | null; by: string | null };
const KINDS = [
  ["ALL", "ทั้งหมด"],
  ["EDIT", "✏ แก้ไขงาน"],
  ["PROBLEM", "⛔ ผลิตไม่ได้"],
  ["MISSED", "⏰ ไม่ได้อัพเดท"],
] as const;
const LABEL = { EDIT: "แก้ไขงาน", PROBLEM: "ผลิตไม่ได้", MISSED: "ไม่ได้อัพเดท" };
const dt = (s: string | null) => (s ? new Date(s).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : "-");

export function EdpReport({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [key, setKey] = useState("");
  const q = useDebounced(key, 300);
  const [kind, setKind] = useState<(typeof KINDS)[number][0]>("ALL");
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let off = false;
    const t = setTimeout(() => {
      setRows(null);
      api<Row[]>("/edp/report", { query: { from, to, q } })
        .then((r) => !off && setRows(r))
        .catch((e) => {
          if (off) return;
          setRows([]);
          toast.show("ERROR", "โหลดรายงานไม่สำเร็จ\n" + (e as Error).message, "error");
        });
    }, 0);
    return () => {
      off = true;
      clearTimeout(t);
    };
  }, [from, to, q, toast]);

  const list = useMemo(() => (rows ?? []).filter((r) => kind === "ALL" || r.kind === kind), [rows, kind]);
  const count = (k: string) => (rows ?? []).filter((r) => k === "ALL" || r.kind === k).length;

  return (
    <Modal open size="xl" title="📋 EDP REPORT" onClose={onClose}>
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <DateRange from={from} to={to} onChange={(f, t) => (setFrom(f), setTo(t))} />
          <SearchBox value={key} onChange={setKey} placeholder="ค้นหา PART NO / CUSTOMER / เหตุผล / ผู้บันทึก" className="w-[300px] max-w-full" />
        </div>
        <div className="er-tabs" role="tablist" aria-label="ประเภท">
          {KINDS.map(([k, t]) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? "is-on" : ""} onClick={() => setKind(k)}>
              {t} ({count(k)})
            </button>
          ))}
        </div>
        {!rows ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty>ไม่มีรายการในช่วงวันที่นี้</Empty>
        ) : (
          <div className="overflow-auto">
            <table className="data-table w-full">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th>ประเภท</th>
                  <th>แผนวันที่</th>
                  <th>กะ / รอบ</th>
                  <th>ชิ้นงาน (เดิม)</th>
                  <th>เปลี่ยนเป็น</th>
                  <th>เหตุผล</th>
                  <th>ผู้บันทึก / OPERATOR</th>
                  <th>วันที่ เวลา</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r, i) => (
                  <tr key={i}>
                    <td data-l="ประเภท">
                      <span className={`er-kind is-${r.kind.toLowerCase()}`}>{LABEL[r.kind]}</span>
                    </td>
                    <td data-l="แผนวันที่">{dmy(r.planDate.slice(0, 10))}</td>
                    <td data-l="กะ / รอบ">
                      {r.shift} · รอบ {r.round || "-"}
                    </td>
                    <td data-l="ชิ้นงาน (เดิม)" className="text-left">
                      {r.oldText}
                    </td>
                    <td data-l="เปลี่ยนเป็น" className="text-left">
                      {r.newText}
                    </td>
                    <td data-l="เหตุผล" className="text-left">
                      {r.reason ?? "-"}
                    </td>
                    <td data-l="ผู้บันทึก">{r.by ?? "-"}</td>
                    <td data-l="วันที่ เวลา">{dt(r.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
