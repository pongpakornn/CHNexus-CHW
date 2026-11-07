// 🚀 สคริปต์ Splash (ต้นแบบ chr-splash.html) - ฝังเป็น <script> ต่อท้าย markup ใน Splash.tsx
//   ทำงานทันทีตอนเบราว์เซอร์อ่าน HTML (ก่อน React เริ่ม) จึงไม่กระพริบ
//   · เคยเห็นแล้วใน session นี้ = ซ่อนทันที (sessionStorage "chr-splash-seen")
//   · รอ: หน้าเว็บโหลดเสร็จ + ทุก Promise ที่ส่งเข้า window.CHRSplash.wait(...) (เช่น /auth/me)
//     ระบบยังไม่เรียก wait = ถือว่ายังไม่พร้อม (กันปิดก่อน React โหลดข้อมูลทัน) · กันค้าง maxWait 10 วินาที
//   · ออก: วงแหวน/ชื่อ/แถบ จาง -> โลโก้ซูมทะลุ + ปล่อย data-reveal เล่นแอนิเมชัน -> ซ่อน splash
export const SPLASH_SCRIPT = `(function () {
  var CFG = { minShow: 1300, maxWait: 10000, key: "chr-splash-seen" };
  var el = document.getElementById("chr-splash");
  if (!el) return;
  var seen = false;
  try { seen = sessionStorage.getItem(CFG.key) === "1"; } catch (e) {}
  if (seen) { el.className += " cs-gone"; return; }

  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) CFG.minShow = 500;
  el.className += " cs-hold";

  var pending = 1, booted = false, loaded = document.readyState === "complete";
  var done = function () { pending--; };
  window.CHRSplash = {
    wait: function (p) {
      pending++;
      if (!booted) { booted = true; pending--; }
      Promise.resolve(p).then(done, done);
      return p;
    }
  };
  window.addEventListener("load", function () { loaded = true; });

  var fill = document.getElementById("cs-fill");
  var t0 = performance.now(), val = 0, exiting = false;

  function tick(now) {
    if (exiting) return;
    var elapsed = now - t0;
    var ready = loaded && pending === 0;
    val += ((ready ? 100 : 88) - val) * (ready ? 0.12 : 0.04);
    var bar = Math.min(val, Math.min(elapsed / CFG.minShow, 1) * 100);
    fill.style.transform = "scaleX(" + bar / 100 + ")";
    if ((ready && elapsed >= CFG.minShow && bar >= 99.5) || elapsed >= CFG.maxWait) return exit();
    requestAnimationFrame(tick);
  }

  function exit() {
    exiting = true;
    fill.style.transform = "scaleX(1)";
    try { sessionStorage.setItem(CFG.key, "1"); } catch (e) {}
    el.classList.add("cs-out");
    setTimeout(function () {
      el.classList.add("cs-zoom");
      el.classList.remove("cs-hold");
      setTimeout(function () { el.classList.add("cs-gone"); }, 1900);
    }, reduce ? 0 : 350);
  }

  requestAnimationFrame(tick);
})();`;
