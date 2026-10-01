(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const state = { rgFile: null, acFile: null, result: null };

  const monthNames = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

  function setStatus(text, kind = "idle") {
    const el = $("status");
    el.textContent = text;
    el.className = `status ${kind}`;
  }

  function normalizeText(buffer) {
    // Los padrones de DGR Tucumán vienen históricamente en ANSI/Latin-1.
    // TextDecoder windows-1252 conserva correctamente acentos y caracteres latinos.
    try { return new TextDecoder("windows-1252").decode(buffer); }
    catch { return new TextDecoder("iso-8859-1").decode(buffer); }
  }

  async function fileToText(file) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".zip")) {
      if (typeof JSZip === "undefined") {
        throw new Error("No se pudo cargar el lector ZIP. Revisá la conexión a Internet o cargá los TXT descomprimidos.");
      }
      const zip = await JSZip.loadAsync(file);
      const entries = Object.values(zip.files).filter(x => !x.dir && x.name.toLowerCase().endsWith(".txt"));
      if (entries.length !== 1) throw new Error(`El ZIP ${file.name} debe contener exactamente un TXT.`);
      const bytes = await entries[0].async("uint8array");
      return normalizeText(bytes);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    return normalizeText(bytes);
  }

  function parseRG116(text) {
    const records = [];
    const errors = [];
    let detectedPeriod = null;

    text.split(/\r?\n/).forEach((raw, idx) => {
      const line = raw.trim();
      if (!/^\d{11}\b/.test(line)) return;
      const t = line.split(/\s+/);
      const cuit = t[0];
      try {
        const exempt = t[1] === "E";
        let coef, period, pct;
        if (exempt) {
          coef = 0;
          period = t[3];
          pct = null;
        } else {
          coef = Number(t[1]);
          period = t[2];
          pct = Number(t[t.length - 1]);
          if (!Number.isFinite(coef) || !Number.isFinite(pct)) throw new Error("coeficiente o alícuota inválidos");
        }
        if (!/^\d{6}$/.test(period)) throw new Error("período inválido");
        if (!detectedPeriod) detectedPeriod = period;
        if (detectedPeriod !== period) throw new Error(`período ${period} distinto de ${detectedPeriod}`);
        records.push({ cuit, exempt, coef, pct, period });
      } catch (e) {
        errors.push(`RG116 línea ${idx + 1}: ${e.message}`);
      }
    });

    if (!records.length) errors.push("No se encontraron registros válidos de RG116.");
    return { records, errors, period: detectedPeriod };
  }

  function parseAcreditan(text) {
    const records = [];
    const errors = [];
    let detectedPeriod = null;

    text.split(/\r?\n/).forEach((raw, idx) => {
      const line = raw.trim();
      if (!/^\d{11}\b/.test(line)) return;
      const t = line.split(/\s+/);
      const cuit = t[0];
      try {
        const exempt = t[1] === "E";
        const status = exempt ? t[2] : t[1];
        const from = exempt ? t[3] : t[2];
        const to = exempt ? t[4] : t[3];
        const pctToken = t[t.length - 1];
        const pct = pctToken === "-----" ? null : Number(pctToken);
        if (!/^(CM|CL)$/.test(status)) throw new Error(`condición ${status} inválida`);
        if (!/^\d{8}$/.test(from) || !/^\d{8}$/.test(to)) throw new Error("fecha DESDE/HASTA inválida");
        if (!exempt && !Number.isFinite(pct)) throw new Error("alícuota inválida");
        const period = from.slice(0, 6);
        if (!detectedPeriod) detectedPeriod = period;
        if (detectedPeriod !== period) throw new Error(`período ${period} distinto de ${detectedPeriod}`);
        records.push({ cuit, exempt, status, from, to, pct, period });
      } catch (e) {
        errors.push(`ACREDITAN línea ${idx + 1}: ${e.message}`);
      }
    });

    if (!records.length) errors.push("No se encontraron registros válidos de ACREDITAN.");
    return { records, errors, period: detectedPeriod };
  }

  function detectPublicationFromName(name) {
    // Ej.: padroncontribuyente_2610_280920261654(2).zip
    const m = name.match(/_(\d{8})(?:\d{4})?(?:\(\d+\))?\.(?:zip|txt)$/i);
    if (!m) return null;
    const s = m[1];
    const dd = Number(s.slice(0,2)), mm = Number(s.slice(2,4)), yyyy = Number(s.slice(4,8));
    if (yyyy < 2000 || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    return `${String(dd).padStart(2,"0")}/${String(mm).padStart(2,"0")}/${yyyy}`;
  }

  function periodMeta(period) {
    if (!/^\d{6}$/.test(period || "")) return null;
    const yyyy = Number(period.slice(0,4));
    const mm = Number(period.slice(4,6));
    const last = new Date(yyyy, mm, 0).getDate();
    return {
      label: `${yyyy}-${String(mm).padStart(2,"0")}`,
      pretty: `${monthNames[mm - 1]} ${yyyy}`,
      fromDisplay: `01/${String(mm).padStart(2,"0")}/${yyyy}`,
      toDisplay: `${String(last).padStart(2,"0")}/${String(mm).padStart(2,"0")}/${yyyy}`,
      fromCompact: `01${String(mm).padStart(2,"0")}${yyyy}`,
      toCompact: `${String(last).padStart(2,"0")}${String(mm).padStart(2,"0")}${yyyy}`,
      yyyymm: period
    };
  }

  function publicationCompact(display) {
    const m = String(display || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    return `${m[1]}${m[2]}${m[3]}`;
  }

  function round2HalfUp(n) {
    // Valores positivos. Se suma EPSILON para evitar el clásico 2.375 -> 2.37 binario.
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function formatRate(n) {
    const r = round2HalfUp(n);
    let s = r.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    return s.replace(".", ",");
  }

  function formatCoef(n) {
    if (Math.abs(n) < 1e-12) return "0,0000";
    if (Math.abs(n - 1) < 1e-12) return "1,0000";
    return Number(n).toFixed(4); // para el resto, separador decimal punto
  }

  function buildResult(rgParsed, acParsed, publication) {
    const errors = [...rgParsed.errors, ...acParsed.errors];
    if (rgParsed.period && acParsed.period && rgParsed.period !== acParsed.period) {
      errors.push(`Los padrones corresponden a períodos distintos: RG116 ${rgParsed.period} / ACREDITAN ${acParsed.period}.`);
    }
    const period = rgParsed.period || acParsed.period;
    const meta = periodMeta(period);
    if (!meta) errors.push("No se pudo determinar el período del padrón.");
    const pub = publicationCompact(publication);
    if (!pub) errors.push("La fecha de publicación debe tener formato DD/MM/AAAA.");

    const rgMap = new Map();
    for (const r of rgParsed.records) {
      if (rgMap.has(r.cuit)) errors.push(`CUIT duplicado en RG116: ${r.cuit}.`);
      rgMap.set(r.cuit, r);
    }
    const acMap = new Map();
    for (const a of acParsed.records) {
      if (acMap.has(a.cuit)) errors.push(`CUIT duplicado en ACREDITAN: ${a.cuit}.`);
      acMap.set(a.cuit, a);
    }

    // Orden de salida validado con octubre 2026:
    // 1) todos los RG116 en el orden publicado; 2) ACREDITAN que no estaban en RG116.
    const order = [];
    const seen = new Set();
    rgParsed.records.forEach(r => { if (!seen.has(r.cuit)) { order.push(r.cuit); seen.add(r.cuit); } });
    acParsed.records.forEach(a => { if (!seen.has(a.cuit)) { order.push(a.cuit); seen.add(a.cuit); } });

    const rows = [];
    let exentos = 0, coefCero = 0, cmSinRg = 0;

    for (const cuit of order) {
      const r = rgMap.get(cuit);
      const a = acMap.get(cuit);
      let coef, rate;

      // COEFICIENTE acordado:
      // - si figura exento en RG116: 0
      // - si está en RG116: coeficiente RG116
      // - si no está en RG116: 1
      if (r) coef = r.exempt ? 0 : r.coef;
      else coef = 1;

      // ALÍCUOTA acordada y validada contra los 125.176 CUIT de octubre 2026:
      // - RG116 exento: 0
      // - RG116 coef = 0: porcentaje RG116 completo
      // - RG116 coef > 0: porcentaje RG116 / 2
      // - sin RG116, ACREDITAN exento: 0
      // - sin RG116, ACREDITAN CM: porcentaje / 2
      // - sin RG116, ACREDITAN CL: porcentaje completo
      if (r) {
        if (r.exempt) rate = 0;
        else if (r.coef <= 0) rate = r.pct;
        else rate = round2HalfUp(r.pct / 2);
      } else if (a) {
        if (a.exempt) rate = 0;
        else if (a.status === "CM") rate = round2HalfUp(a.pct / 2);
        else rate = a.pct;
      } else {
        errors.push(`CUIT ${cuit}: no tiene fuente RG116 ni ACREDITAN.`);
        continue;
      }

      if ((r && r.exempt) || (!r && a && a.exempt)) exentos++;
      if (r && !r.exempt && r.coef <= 0) coefCero++;
      if (!r && a && !a.exempt && a.status === "CM") cmSinRg++;

      if (!Number.isFinite(coef) || !Number.isFinite(rate)) {
        errors.push(`CUIT ${cuit}: resultado numérico inválido.`);
        continue;
      }
      rows.push({ cuit, coef, rate });
    }

    const aliLines = rows.map(x => `${pub};${meta.fromCompact};${meta.toCompact};${x.cuit};D;S;N;${formatRate(x.rate)};${formatRate(x.rate)};00;00;nombre`);
    const coefLines = rows.map(x => `${x.cuit}     ${formatCoef(x.coef)}`);

    return {
      errors, rows, aliText: aliLines.join("\r\n") + "\r\n", coefText: coefLines.join("\r\n") + "\r\n",
      meta,
      stats: { rg: rgParsed.records.length, ac: acParsed.records.length, union: rows.length, exentos, coefCero, cmSinRg }
    };
  }

  function downloadText(filename, text) {
    const blob = new Blob([text], { type: "text/plain;charset=windows-1252" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function updateFile(which, file) {
    state[`${which}File`] = file || null;
    $(`${which}File`).textContent = file ? file.name : "Ningún archivo seleccionado";
    state.result = null;
    $("downloadCard").classList.add("hidden");
    $("stats").classList.add("hidden");
    $("issuesBox").classList.add("hidden");
    setStatus(state.rgFile && state.acFile ? "Archivos cargados. Listo para verificar." : "Esperando archivos.", "idle");

    if (file) {
      const pub = detectPublicationFromName(file.name);
      if (pub && !$("publicacion").value) $("publicacion").value = pub;
    }
  }

  function setupInput(which) {
    const input = $(`${which}Input`), zone = $(`${which}Zone`);
    input.addEventListener("change", () => updateFile(which, input.files?.[0]));
    ["dragenter","dragover"].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add("drag"); }));
    ["dragleave","drop"].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove("drag"); }));
    zone.addEventListener("drop", e => {
      const file = e.dataTransfer.files?.[0];
      if (file) updateFile(which, file);
    });
  }

  async function verify() {
    if (!state.rgFile || !state.acFile) {
      setStatus("Cargá los dos padrones antes de verificar.", "warn");
      return;
    }
    const btn = $("verifyBtn");
    btn.disabled = true;
    setStatus("Leyendo y cruzando padrones…", "idle");
    try {
      const [rgText, acText] = await Promise.all([fileToText(state.rgFile), fileToText(state.acFile)]);
      const rgParsed = parseRG116(rgText);
      const acParsed = parseAcreditan(acText);
      const period = rgParsed.period || acParsed.period;
      const meta = periodMeta(period);
      if (meta) {
        $("periodo").value = `${meta.pretty} (${meta.label})`;
        $("desde").value = meta.fromDisplay;
        $("hasta").value = meta.toDisplay;
      }
      if (!$("publicacion").value) {
        $("publicacion").value = detectPublicationFromName(state.acFile.name) || detectPublicationFromName(state.rgFile.name) || "";
      }

      const result = buildResult(rgParsed, acParsed, $("publicacion").value);
      state.result = result;

      $("statRg").textContent = result.stats.rg.toLocaleString("es-AR");
      $("statAc").textContent = result.stats.ac.toLocaleString("es-AR");
      $("statUnion").textContent = result.stats.union.toLocaleString("es-AR");
      $("statExentos").textContent = result.stats.exentos.toLocaleString("es-AR");
      $("statCoefCero").textContent = result.stats.coefCero.toLocaleString("es-AR");
      $("statCmSinRg").textContent = result.stats.cmSinRg.toLocaleString("es-AR");
      $("stats").classList.remove("hidden");

      const box = $("issuesBox");
      if (result.errors.length) {
        box.innerHTML = `<strong>Se encontraron ${result.errors.length} observación/es:</strong><ul>${result.errors.slice(0,20).map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>${result.errors.length > 20 ? "<p>Se muestran sólo las primeras 20.</p>" : ""}`;
        box.classList.remove("hidden");
        $("downloadCard").classList.add("hidden");
        setStatus("Hay observaciones. No se habilita la generación hasta corregirlas.", "bad");
      } else {
        box.classList.add("hidden");
        $("previewAli").textContent = result.aliText.split(/\r?\n/).slice(0,5).join("\n");
        $("previewCoef").textContent = result.coefText.split(/\r?\n/).slice(0,5).join("\n");
        $("downloadCard").classList.remove("hidden");
        setStatus(`Validación OK. ${result.stats.union.toLocaleString("es-AR")} CUIT listos para generar.`, "ok");
      }
    } catch (e) {
      console.error(e);
      setStatus(e.message || "Error inesperado al procesar los archivos.", "bad");
      $("downloadCard").classList.add("hidden");
    } finally {
      btn.disabled = false;
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));
  }

  setupInput("rg");
  setupInput("ac");
  $("verifyBtn").addEventListener("click", verify);
  $("publicacion").addEventListener("change", () => { state.result = null; $("downloadCard").classList.add("hidden"); setStatus("Fecha modificada. Volvé a verificar antes de descargar.", "warn"); });
  $("downloadAli").addEventListener("click", () => {
    if (!state.result) return;
    downloadText(`Tucuman_Alicuotas_${state.result.meta.yyyymm}.txt`, state.result.aliText);
  });
  $("downloadCoef").addEventListener("click", () => {
    if (!state.result) return;
    downloadText(`Tucuman_Coeficientes_${state.result.meta.yyyymm}.txt`, state.result.coefText);
  });
})();
