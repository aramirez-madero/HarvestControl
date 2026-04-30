const STORAGE_KEY = "harvest-control-state-v1";
const KG_PER_BOX = 10;

const DEFAULT_PRICES = [
  { category: "CAT 1*", range: "C12-18", minimum: 2.32, target: 3.0, cost: 0, breakeven: 0 },
  { category: "CAT 1*", range: "C20-24", minimum: 2.18, target: 2.7, cost: 0, breakeven: 0 },
  { category: "CAT 1*", range: "C26-28", minimum: 1.9, target: 2.0, cost: 0, breakeven: 0 },
  { category: "CAT 1*", range: "C30-32", minimum: 1.69, target: 2.0, cost: 0, breakeven: 0 },
  { category: "CAT 1", range: "C12-18", minimum: 2.52, target: 3.3, cost: 0, breakeven: 0 },
  { category: "CAT 1", range: "C20-24", minimum: 2.38, target: 2.93, cost: 0, breakeven: 0 },
  { category: "CAT 1", range: "C26-28", minimum: 2.1, target: 2.1, cost: 0, breakeven: 0 },
  { category: "CAT 1", range: "C30-32", minimum: 1.89, target: 2.1, cost: 0, breakeven: 0 },
];

const state = { stock: [], sales: [], prices: DEFAULT_PRICES, batches: [] };
let supabaseClient = null;
let useSupabase = false;
let currentUser = null;
let currentView = "dashboard";
let currentTab = "containerSummary";
let replaceSalesBatchId = "";
let activePalletFilter = null;
let priceDrafts = {};

const el = (id) => document.getElementById(id);
const money = (value) => number(value).toLocaleString("en-US", { style: "currency", currency: "USD" });
const qty = (value) => number(value).toLocaleString("es-PE", { maximumFractionDigits: 2 });
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

function loadLocalState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    return { stock: [], sales: [], prices: DEFAULT_PRICES, batches: [] };
  }
  try {
    const parsed = JSON.parse(saved);
    return {
      stock: parsed.stock || [],
      sales: parsed.sales || [],
      prices: (parsed.prices || DEFAULT_PRICES).map((price) => ({ ...price, cost: number(price.cost), breakeven: number(price.breakeven) })),
      batches: parsed.batches || [],
    };
  } catch {
    return { stock: [], sales: [], prices: DEFAULT_PRICES, batches: [] };
  }
}

function saveState() {
  if (useSupabase) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function setState(nextState) {
  state.stock = nextState.stock || [];
  state.sales = nextState.sales || [];
  state.prices = (nextState.prices || DEFAULT_PRICES).map((price) => ({ ...price, cost: number(price.cost), breakeven: number(price.breakeven) }));
  state.batches = nextState.batches || [];
}

function initSupabaseClient() {
  const config = window.HARVEST_SUPABASE;
  if (!config?.url || !config?.key || !window.supabase?.createClient) {
    useSupabase = false;
    setState(loadLocalState());
    return;
  }
  supabaseClient = window.supabase.createClient(config.url, config.key);
  useSupabase = true;
}

async function loadRemoteState() {
  const [prices, stock, sales, batches] = await Promise.all([
    supabaseClient.from("price_ranges").select("*").order("id", { ascending: true }),
    supabaseClient.from("stock_items").select("*").order("container", { ascending: true }),
    supabaseClient.from("sales").select("*").order("created_at", { ascending: false }),
    supabaseClient.from("upload_batches").select("*").order("created_at", { ascending: false }),
  ]);
  const firstError = prices.error || stock.error || sales.error || batches.error;
  if (firstError) throw firstError;

  setState({
    prices: prices.data.map((row) => ({
      id: row.id,
      category: row.category,
      range: row.caliber_range,
      minimum: number(row.minimum_price),
      target: number(row.target_price),
      breakeven: number(row.breakeven_price),
      cost: number(row.cost),
    })),
    stock: stock.data.map((row) => ({
      id: row.id,
      container: row.container,
      palletCode: row.pallet_code,
      caliber: row.caliber,
      category: row.category,
      range: row.caliber_range,
      boxes: number(row.boxes),
      kilos: number(row.kilos),
    })),
    sales: sales.data.map((row) => ({
      id: row.id,
      batchId: row.batch_id,
      date: row.sale_date,
      container: row.container,
      palletCode: row.pallet_code,
      caliber: row.caliber,
      boxes: number(row.boxes),
      kilos: number(row.kilos),
      price: number(row.sale_price),
      client: row.client || "",
    })),
    batches: batches.data.map((row) => ({
      id: row.id,
      relatedId: row.id,
      type: row.batch_type,
      fileName: row.file_name || "",
      rows: row.rows_count || 0,
      note: row.note || "",
      createdAt: row.created_at,
      userRole: "",
    })),
  });
}

async function refreshRemoteAndRender() {
  if (useSupabase) await loadRemoteState();
  renderAll();
}

async function getProfileRole(userId, email = "") {
  const { data, error } = await supabaseClient.from("profiles").select("role").eq("id", userId).single();
  if (error) {
    throw new Error(`El usuario no tiene rol en profiles o no se pudo leer su perfil.\nCorreo: ${email || "-"}\nUID: ${userId}\nDetalle: ${error.message}`);
  }
  return data.role;
}

async function showAuthenticatedApp(session) {
  const role = await getProfileRole(session.user.id, session.user.email);
  currentUser = { role, id: session.user.id, email: session.user.email };
  await loadRemoteState();
  el("loginView").classList.add("hidden");
  el("appView").classList.remove("hidden");
  el("roleBadge").textContent = role === "management" ? "Gerencia" : "Operador";
  document.querySelectorAll(".operator-only").forEach((node) => node.classList.toggle("hidden", role === "management"));
  setView("dashboard");
  renderAll();
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeHeader(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeCaliber(value) {
  return normalizeText(value).replace(/\s+/g, "").toUpperCase();
}

function stockKey(container, palletCode, caliber) {
  return `${normalizeText(container)}|${normalizeText(palletCode)}|${normalizeCaliber(caliber)}`;
}

function categoryFromCaliber(caliber) {
  return normalizeCaliber(caliber).endsWith("*") ? "CAT 1*" : "CAT 1";
}

function caliberNumber(caliber) {
  const match = normalizeCaliber(caliber).match(/\d+/);
  return match ? Number(match[0]) : NaN;
}

function rangeFromCaliber(caliber) {
  const value = caliberNumber(caliber);
  if ([12, 14, 16, 18].includes(value)) return "C12-18";
  if ([20, 22, 24].includes(value)) return "C20-24";
  if ([26, 28].includes(value)) return "C26-28";
  if ([30, 32].includes(value)) return "C30-32";
  return "";
}

function priceFor(category, range) {
  return state.prices.find((item) => item.category === category && item.range === range) || { minimum: 0, target: 0 };
}

function salesForKey(key, ignoreSaleId = "", ignoreBatchId = "") {
  return state.sales
    .filter((sale) => stockKey(sale.container, sale.palletCode, sale.caliber) === key && sale.id !== ignoreSaleId && sale.batchId !== ignoreBatchId)
    .reduce((sum, sale) => sum + number(sale.boxes), 0);
}

function readExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const workbook = XLSX.read(event.target.result, { type: "array", cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        resolve(rows.map(remapRow));
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function remapRow(row) {
  const mapped = {};
  Object.entries(row).forEach(([key, value]) => {
    mapped[normalizeHeader(key)] = value;
  });
  return mapped;
}

function pick(row, names) {
  for (const name of names) {
    const normalized = normalizeHeader(name);
    if (row[normalized] !== undefined && row[normalized] !== "") return row[normalized];
  }
  return "";
}

async function uploadStock() {
  const file = el("stockFile").files[0];
  if (!file) return showResult("stockUploadResult", "Seleccione un archivo de stock.");

  try {
    const rows = await readExcel(file);
    const errors = [];
    const seen = new Set();
    const parsed = rows.map((row, index) => {
      const container = normalizeText(pick(row, ["CONTENEDOR"]));
      const palletCode = normalizeText(pick(row, ["CODIGO_PALLET", "CODIGO PALLET", "PALLET"]));
      const caliber = normalizeCaliber(pick(row, ["CALIBRE", "CALIBRES"]));
      const boxes = number(pick(row, ["CAJAS", "CAJAS_INICIALES"]));
      const key = stockKey(container, palletCode, caliber);
      const category = categoryFromCaliber(caliber);
      const range = rangeFromCaliber(caliber);

      if (!container) errors.push(`Fila ${index + 2}: CONTENEDOR obligatorio.`);
      if (!palletCode) errors.push(`Fila ${index + 2}: CODIGO_PALLET obligatorio.`);
      if (!caliber) errors.push(`Fila ${index + 2}: CALIBRE obligatorio.`);
      if (!range) errors.push(`Fila ${index + 2}: calibre fuera de rango.`);
      if (boxes < 0) errors.push(`Fila ${index + 2}: CAJAS no puede ser negativo.`);
      if (seen.has(key)) errors.push(`Fila ${index + 2}: llave duplicada ${container} / ${palletCode} / ${caliber}.`);
      seen.add(key);

      return { key, container, palletCode, caliber, category, range, boxes };
    });

    parsed.forEach((item) => {
      const sold = salesForKey(item.key);
      if (item.boxes < sold) {
        errors.push(`${item.container} / ${item.palletCode} / ${item.caliber}: stock ${item.boxes} menor a ventas ${sold}.`);
      }
    });

    if (errors.length) return showResult("stockUploadResult", `No se cargo el stock:\n${errors.slice(0, 12).join("\n")}`);

    let created = 0;
    let updated = 0;
    if (useSupabase) {
      created = parsed.filter((item) => !state.stock.some((stock) => stockKey(stock.container, stock.palletCode, stock.caliber) === item.key)).length;
      updated = parsed.length - created;
      await saveStockUploadToSupabase(parsed, file.name, `creados ${created}, actualizados ${updated}`);
      await refreshRemoteAndRender();
      showResult("stockUploadResult", `Stock procesado correctamente.\nCreados: ${created}\nActualizados: ${updated}`);
      return;
    }

    parsed.forEach((item) => {
      const existing = state.stock.find((stock) => stockKey(stock.container, stock.palletCode, stock.caliber) === item.key);
      if (existing) {
        existing.boxes = item.boxes;
        existing.kilos = item.boxes * KG_PER_BOX;
        existing.category = item.category;
        existing.range = item.range;
        updated += 1;
      } else {
        state.stock.push({
          id: uid("stock"),
          container: item.container,
          palletCode: item.palletCode,
          caliber: item.caliber,
          category: item.category,
          range: item.range,
          boxes: item.boxes,
          kilos: item.boxes * KG_PER_BOX,
        });
        created += 1;
      }
    });

    addBatch("stock", file.name, parsed.length, `creados ${created}, actualizados ${updated}`);
    saveState();
    renderAll();
    showResult("stockUploadResult", `Stock procesado correctamente.\nCreados: ${created}\nActualizados: ${updated}`);
  } catch (error) {
    showResult("stockUploadResult", `Error leyendo Excel: ${error.message}`);
  }
}

async function saveStockUploadToSupabase(parsed, fileName, note) {
  const rows = parsed.map((item) => ({
    container: item.container,
    pallet_code: item.palletCode,
    caliber: item.caliber,
    category: item.category,
    caliber_range: item.range,
    boxes: item.boxes,
    kilos: item.boxes * KG_PER_BOX,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabaseClient.from("stock_items").upsert(rows, { onConflict: "container,pallet_code,caliber" });
  if (error) throw error;
  await insertRemoteBatch("stock", fileName, parsed.length, note);
}

async function uploadSales() {
  const file = el("salesFile").files[0];
  if (!file) return showResult("salesUploadResult", "Seleccione un archivo de ventas.");

  try {
    const rows = await readExcel(file);
    const errors = [];
    const batchId = replaceSalesBatchId || uid("batch");
    const draftTotals = {};
    const parsed = rows.map((row, index) => {
      const date = formatDate(pick(row, ["FECHA", "FECHA_VENTA"]));
      const container = normalizeText(pick(row, ["CONTENEDOR"]));
      const palletCode = normalizeText(pick(row, ["CODIGO_PALLET", "CODIGO PALLET", "PALLET"]));
      const caliber = normalizeCaliber(pick(row, ["CALIBRE", "CALIBRES"]));
      const boxes = number(pick(row, ["CAJAS_VENDIDAS", "CAJAS VENDIDAS", "CAJAS"]));
      const price = number(pick(row, ["PRECIO_VENTA_TOTAL", "PRECIO VENTA TOTAL", "PRECIO_VENTA", "PRECIO VENTA", "PRECIO"]));
      const client = normalizeText(pick(row, ["CLIENTE"]));
      const key = stockKey(container, palletCode, caliber);

      if (!date) errors.push(`Fila ${index + 2}: FECHA obligatoria.`);
      if (!container) errors.push(`Fila ${index + 2}: CONTENEDOR obligatorio.`);
      if (!palletCode) errors.push(`Fila ${index + 2}: CODIGO_PALLET obligatorio.`);
      if (!caliber) errors.push(`Fila ${index + 2}: CALIBRE obligatorio.`);
      if (boxes <= 0) errors.push(`Fila ${index + 2}: CAJAS_VENDIDAS debe ser mayor a 0.`);
      if (price <= 0) errors.push(`Fila ${index + 2}: PRECIO_VENTA_TOTAL debe ser mayor a 0.`);

      draftTotals[key] = (draftTotals[key] || 0) + boxes;
      return { key, date, container, palletCode, caliber, boxes, price, client, batchId };
    });

    Object.entries(draftTotals).forEach(([key, boxes]) => {
      const stock = state.stock.find((item) => stockKey(item.container, item.palletCode, item.caliber) === key);
      if (!stock) {
        errors.push(`No existe stock para ${key.replaceAll("|", " / ")}.`);
      } else {
        const available = number(stock.boxes) - salesForKey(key, "", replaceSalesBatchId);
        if (boxes > available) {
          errors.push(`${key.replaceAll("|", " / ")} tiene ${available} cajas disponibles. No puede vender ${boxes}.`);
        }
      }
    });

    if (errors.length) return showResult("salesUploadResult", `No se cargaron ventas:\n${errors.slice(0, 12).join("\n")}`);

    if (useSupabase) {
      const finalBatchId = await saveSalesUploadToSupabase(parsed, file.name, replaceSalesBatchId);
      replaceSalesBatchId = "";
      await refreshRemoteAndRender();
      showResult("salesUploadResult", `Ventas procesadas correctamente.\nLote: ${finalBatchId}\nFilas: ${parsed.length}`);
      return;
    }

    if (replaceSalesBatchId) {
      state.sales = state.sales.filter((sale) => sale.batchId !== replaceSalesBatchId);
    }

    parsed.forEach((item) => {
      state.sales.push({
        id: uid("sale"),
        batchId: item.batchId,
        date: item.date,
        container: item.container,
        palletCode: item.palletCode,
        caliber: item.caliber,
        boxes: item.boxes,
        kilos: item.boxes * KG_PER_BOX,
        price: item.price,
        client: item.client,
      });
    });

    addBatch("sales", file.name, parsed.length, replaceSalesBatchId ? "lote reemplazado" : "nuevo lote", batchId);
    replaceSalesBatchId = "";
    saveState();
    renderAll();
    showResult("salesUploadResult", `Ventas procesadas correctamente.\nLote: ${batchId}\nFilas: ${parsed.length}`);
  } catch (error) {
    showResult("salesUploadResult", `Error leyendo Excel: ${error.message}`);
  }
}

async function saveSalesUploadToSupabase(parsed, fileName, batchToReplace = "") {
  let batchId = batchToReplace;
  if (batchToReplace) {
    const { error: deleteError } = await supabaseClient.from("sales").delete().eq("batch_id", batchToReplace);
    if (deleteError) throw deleteError;
    const { error: updateError } = await supabaseClient
      .from("upload_batches")
      .update({ file_name: fileName, rows_count: parsed.length, note: "lote reemplazado" })
      .eq("id", batchToReplace);
    if (updateError) throw updateError;
  } else {
    batchId = await insertRemoteBatch("sales", fileName, parsed.length, "nuevo lote");
  }

  const rows = parsed.map((item) => ({
    batch_id: batchId,
    sale_date: item.date,
    container: item.container,
    pallet_code: item.palletCode,
    caliber: item.caliber,
    boxes: item.boxes,
    kilos: item.boxes * KG_PER_BOX,
        sale_price: item.price,
    client: item.client,
  }));
  const { error } = await supabaseClient.from("sales").insert(rows);
  if (error) throw error;
  return batchId;
}

async function insertRemoteBatch(type, fileName, rows, note) {
  const { data, error } = await supabaseClient
    .from("upload_batches")
    .insert({
      batch_type: type,
      file_name: fileName,
      rows_count: rows,
      note,
      created_by: currentUser?.id || null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

function formatDate(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  return normalizeText(value);
}

function addBatch(type, fileName, rows, note, relatedId = "") {
  state.batches.push({
    id: uid("batchlog"),
    relatedId,
    type,
    fileName,
    rows,
    note,
    createdAt: new Date().toISOString(),
    userRole: currentUser?.role || "operator",
  });
}

function showResult(id, message) {
  el(id).textContent = message;
}

function metricsForStock(item) {
  const key = stockKey(item.container, item.palletCode, item.caliber);
  const sales = state.sales.filter((sale) => stockKey(sale.container, sale.palletCode, sale.caliber) === key);
  const soldBoxes = sales.reduce((sum, sale) => sum + number(sale.boxes), 0);
  const soldKilos = soldBoxes * KG_PER_BOX;
  const revenue = sales.reduce((sum, sale) => sum + number(sale.price), 0);
  const prices = priceFor(item.category, item.range);
  const realProfit = sales.reduce((sum, sale) => sum + number(sale.price) - number(sale.kilos) * number(prices.cost), 0);
  const minimumProfit = soldKilos * (number(prices.minimum) - number(prices.cost));
  const targetProfit = soldKilos * (number(prices.target) - number(prices.cost));
  const overMinimumProfit = realProfit - minimumProfit;
  const againstTargetProfit = realProfit - targetProfit;
  return {
    container: item.container,
    palletCode: item.palletCode,
    caliber: item.caliber,
    category: item.category,
    range: item.range,
    initialBoxes: number(item.boxes),
    soldBoxes,
    remainingBoxes: number(item.boxes) - soldBoxes,
    soldKilos,
    revenue,
    averagePrice: soldKilos ? revenue / soldKilos : 0,
    realProfit,
    minimumProfit,
    targetProfit,
    overMinimumProfit,
    againstTargetProfit,
  };
}

function allMetrics() {
  return state.stock.map(metricsForStock);
}

function aggregate(rows, keys) {
  const grouped = new Map();
  rows.forEach((row) => {
    const id = keys.map((key) => row[key]).join("|");
    if (!grouped.has(id)) {
      grouped.set(id, Object.fromEntries(keys.map((key) => [key, row[key]])));
    }
    const target = grouped.get(id);
    target.initialBoxes = number(target.initialBoxes) + row.initialBoxes;
    target.soldBoxes = number(target.soldBoxes) + row.soldBoxes;
    target.remainingBoxes = number(target.remainingBoxes) + row.remainingBoxes;
    target.soldKilos = number(target.soldKilos) + row.soldKilos;
    target.revenue = number(target.revenue) + row.revenue;
    target.realProfit = number(target.realProfit) + row.realProfit;
    target.minimumProfit = number(target.minimumProfit) + row.minimumProfit;
    target.targetProfit = number(target.targetProfit) + row.targetProfit;
    target.overMinimumProfit = number(target.overMinimumProfit) + row.overMinimumProfit;
    target.againstTargetProfit = number(target.againstTargetProfit) + row.againstTargetProfit;
  });
  return Array.from(grouped.values()).map((row) => ({
    ...row,
    averagePrice: row.soldKilos ? row.revenue / row.soldKilos : 0,
  }));
}

function searchRows(rows) {
  const query = normalizeText(el("globalSearch").value).toLowerCase();
  if (!query) return rows;
  return rows.filter((row) => Object.values(row).join(" ").toLowerCase().includes(query));
}

function renderDashboard() {
  const allRows = allMetrics();
  const rows = applyPalletFilter(allRows);
  const totals = aggregate(rows, [])[0] || {};
  const totalPallets = new Set(rows.map((item) => `${item.container}|${item.palletCode}`)).size;
  const totalContainers = new Set(rows.map((item) => item.container)).size;

  el("kpiGrid").innerHTML = [
    kpi("Cajas iniciales", qty(totals.initialBoxes)),
    kpi("Cajas vendidas", qty(totals.soldBoxes), true),
    kpi("Cajas restantes", qty(totals.remainingBoxes)),
    kpi("Venta total", money(totals.revenue), true),
    kpi("Precio promedio", money(totals.averagePrice)),
    kpi("Utilidad real", money(totals.realProfit), true),
    kpi("Utilidad sobre minimo", money(totals.overMinimumProfit), true),
    kpi("Utilidad contra objetivo", money(totals.againstTargetProfit)),
    kpi("Contenedores / pallets", `${totalContainers} / ${totalPallets}`),
  ].join("");

  renderActiveFilter();
  const tableRows = dashboardRows(rows);
  el("dashboardTable").innerHTML = buildMetricsTable(searchRows(tableRows), dashboardColumns(), currentTab === "palletSummary");
  bindDashboardRows();
}

function applyPalletFilter(rows) {
  if (!activePalletFilter) return rows;
  return rows.filter((row) => row.container === activePalletFilter.container && row.palletCode === activePalletFilter.palletCode);
}

function renderActiveFilter() {
  if (!activePalletFilter) {
    el("activeFilterBar").classList.add("hidden");
    el("activeFilterBar").innerHTML = "";
    return;
  }
  el("activeFilterBar").classList.remove("hidden");
  el("activeFilterBar").innerHTML = `<span>Filtro activo: ${activePalletFilter.container} / pallet ${activePalletFilter.palletCode}</span><button class="icon-button" id="clearPalletFilterButton">Quitar filtro</button>`;
  el("clearPalletFilterButton").addEventListener("click", () => {
    activePalletFilter = null;
    renderDashboard();
  });
}

function dashboardRows(rows) {
  if (currentTab === "containerSummary") return aggregate(rows, ["container"]);
  if (currentTab === "containerDetail") return rows;
  if (currentTab === "palletSummary") return aggregate(rows, ["container", "palletCode"]);
  if (currentTab === "categorySummary") return aggregate(rows, ["category"]);
  if (currentTab === "caliberSummary") return aggregate(rows, ["caliber", "category"]);
  return rows;
}

function dashboardColumns() {
  const metricCols = [
    ["initialBoxes", "Cajas iniciales", qty],
    ["soldBoxes", "Cajas vendidas", qty],
    ["remainingBoxes", "Cajas restantes", qty],
    ["revenue", "Venta total", money],
    ["averagePrice", "Precio prom.", money],
    ["realProfit", "Utilidad real", money],
    ["overMinimumProfit", "Utilidad sobre minimo", money],
    ["againstTargetProfit", "Utilidad contra objetivo", money],
  ];
  if (currentTab === "containerSummary") return [["container", "Contenedor"], ...metricCols];
  if (currentTab === "containerDetail") return [["container", "Contenedor"], ["palletCode", "Codigo pallet"], ["caliber", "Calibre"], ["category", "Categoria"], ...metricCols];
  if (currentTab === "palletSummary") return [["container", "Contenedor"], ["palletCode", "Codigo pallet"], ...metricCols];
  if (currentTab === "categorySummary") return [["category", "Categoria"], ...metricCols];
  return [["caliber", "Calibre"], ["category", "Categoria"], ...metricCols];
}

function kpi(label, value, accent = false) {
  return `<article class="kpi-card ${accent ? "accent" : ""}"><span>${label}</span><strong>${value}</strong></article>`;
}

function buildMetricsTable(rows, columns, clickablePalletRows = false) {
  if (!rows.length) return emptyTable("Sin informacion para mostrar.");
  return `${buildMobileCards(rows, columns)}<div class="mobile-hint">Deslice la tabla para ver mas columnas.</div><table><thead><tr>${columns.map(([, label]) => `<th>${label}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr ${clickablePalletRows ? `class="clickable-row" data-container="${encodeAttr(row.container)}" data-pallet="${encodeAttr(row.palletCode)}"` : ""}>${columns.map(([key, , formatter]) => `<td class="${formatter ? "numeric" : ""}">${formatter ? formatter(row[key]) : row[key] || ""}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

function encodeAttr(value) {
  return String(value || "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function bindDashboardRows() {
  document.querySelectorAll("#dashboardTable .clickable-row").forEach((row) => {
    row.addEventListener("click", () => {
      activePalletFilter = {
        container: row.dataset.container,
        palletCode: row.dataset.pallet,
      };
      setDashboardTab("caliberSummary");
    });
  });
}

function buildMobileCards(rows, columns) {
  const limited = rows.slice(0, 60);
  return `<div class="mobile-card-list">${limited
    .map((row) => {
      const titleParts = [];
      ["container", "palletCode", "caliber", "category"].forEach((key) => {
        if (row[key] && titleParts.length < 2) titleParts.push(row[key]);
      });
      const title = titleParts.join(" / ") || "Resumen";
      const subtitle = columns
        .filter(([key]) => ["category", "caliber", "palletCode"].includes(key) && !titleParts.includes(row[key]))
        .map(([key, label]) => `${label}: ${row[key]}`)
        .join(" · ");
      const pill = row.remainingBoxes <= 0 ? "Vendido" : `${qty(row.remainingBoxes)} cajas`;
      const metricKeys = ["initialBoxes", "soldBoxes", "revenue", "averagePrice", "realProfit", "overMinimumProfit", "againstTargetProfit"];
      const metrics = columns.filter(([key]) => metricKeys.includes(key));
      const clickable = currentTab === "palletSummary" && row.container && row.palletCode;
      return `<article class="mobile-data-card ${clickable ? "clickable-row" : ""}" ${clickable ? `data-container="${encodeAttr(row.container)}" data-pallet="${encodeAttr(row.palletCode)}"` : ""}>
        <div class="mobile-card-head">
          <div><div class="mobile-card-title">${title}</div>${subtitle ? `<div class="mobile-card-subtitle">${subtitle}</div>` : ""}</div>
          <div class="mobile-card-pill">${pill}</div>
        </div>
        <div class="mobile-card-grid">${metrics
          .map(([key, label, formatter]) => `<div><span>${label}</span><strong>${formatter ? formatter(row[key]) : row[key] || ""}</strong></div>`)
          .join("")}</div>
      </article>`;
    })
    .join("")}</div>`;
}

function emptyTable(message) {
  return `<div class="panel"><p>${message}</p></div>`;
}

function renderStock() {
  const query = normalizeText(el("stockSearch").value).toLowerCase();
  const rows = state.stock.filter((row) => Object.values(row).join(" ").toLowerCase().includes(query));
  if (!rows.length) {
    el("stockTable").innerHTML = emptyTable("No hay stock cargado.");
    return;
  }
  el("stockTable").innerHTML = `<table><thead><tr>
    <th>Contenedor</th><th>Codigo pallet</th><th>Calibre</th><th>Categoria</th><th>Rango</th>
    <th class="numeric">Cajas</th><th class="numeric">Kilos</th><th>Acciones</th>
  </tr></thead><tbody>${rows
    .map((row) => `<tr>
      <td>${row.container}</td><td>${row.palletCode}</td><td>${row.caliber}</td><td>${row.category}</td><td>${row.range}</td>
      <td class="numeric">${qty(row.boxes)}</td><td class="numeric">${qty(row.kilos)}</td>
      <td><div class="row-actions"><button class="icon-button" onclick="editStock('${row.id}')">Editar</button><button class="icon-button danger" onclick="deleteStock('${row.id}')">Eliminar</button></div></td>
    </tr>`)
    .join("")}</tbody></table>`;
}

function renderSales() {
  const query = normalizeText(el("salesSearch").value).toLowerCase();
  const rows = state.sales.filter((row) => Object.values(row).join(" ").toLowerCase().includes(query));
  if (!rows.length) {
    el("salesTable").innerHTML = emptyTable("No hay ventas cargadas.");
    return;
  }
  el("salesTable").innerHTML = `<table><thead><tr>
    <th>Fecha</th><th>Contenedor</th><th>Codigo pallet</th><th>Calibre</th><th>Cliente</th>
    <th class="numeric">Cajas</th><th class="numeric">Precio caja</th><th class="numeric">Precio kg</th><th class="numeric">Venta total</th><th>Acciones</th>
  </tr></thead><tbody>${rows
    .map((row) => `<tr>
      <td>${row.date}</td><td>${row.container}</td><td>${row.palletCode}</td><td>${row.caliber}</td><td>${row.client || ""}</td>
      <td class="numeric">${qty(row.boxes)}</td><td class="numeric">${money(row.boxes ? row.price / row.boxes : 0)}</td><td class="numeric">${money(row.kilos ? row.price / row.kilos : 0)}</td><td class="numeric">${money(row.price)}</td>
      <td><div class="row-actions"><button class="icon-button" onclick="editSale('${row.id}')">Editar</button><button class="icon-button danger" onclick="deleteSale('${row.id}')">Eliminar</button></div></td>
    </tr>`)
    .join("")}</tbody></table>`;
}

function renderPrices() {
  const isOperator = currentUser?.role === "operator";
  if (isOperator) {
    const status = el("priceDraftStatus");
    if (status) status.textContent = Object.keys(priceDrafts).length ? "Cambios pendientes" : "Sin cambios pendientes";
    el("pricesTable").innerHTML = `${buildPriceCards(true)}<table><thead><tr><th>Categoria</th><th>Rango</th><th class="numeric">Minimo</th><th class="numeric">Objetivo</th><th class="numeric">Punto equilibrio</th><th class="numeric">Costo</th></tr></thead><tbody>${state.prices
      .map((row, index) => `<tr>
        <td>${row.category}</td>
        <td>${row.range}</td>
        <td class="numeric"><input class="price-input" type="number" step="0.01" value="${draftPriceValue(index, "minimum")}" oninput="setPriceDraft(${index}, 'minimum', this.value)" /></td>
        <td class="numeric"><input class="price-input" type="number" step="0.01" value="${draftPriceValue(index, "target")}" oninput="setPriceDraft(${index}, 'target', this.value)" /></td>
        <td class="numeric"><input class="price-input" type="number" step="0.01" value="${draftPriceValue(index, "breakeven")}" oninput="setPriceDraft(${index}, 'breakeven', this.value)" /></td>
        <td class="numeric"><input class="price-input" type="number" step="0.01" value="${draftPriceValue(index, "cost")}" oninput="setPriceDraft(${index}, 'cost', this.value)" /></td>
      </tr>`)
      .join("")}</tbody></table>`;
    return;
  }

  el("pricesTable").innerHTML = `${buildPriceCards(false)}<table><thead><tr><th>Categoria</th><th>Rango</th><th class="numeric">Minimo</th><th class="numeric">Objetivo</th><th class="numeric">Punto equilibrio</th></tr></thead><tbody>${state.prices
    .map((row) => `<tr>
      <td>${row.category}</td>
      <td>${row.range}</td>
      <td class="numeric">${money(row.minimum)}</td>
      <td class="numeric">${money(row.target)}</td>
      <td class="numeric">${money(row.breakeven || 0)}</td>
    </tr>`)
    .join("")}</tbody></table>`;
}

function buildPriceCards(isOperator) {
  return `<div class="price-card-list">${state.prices
    .map((row, index) => `<article class="price-card">
      <div class="price-card-head">
        <div>
          <div class="price-card-title">${row.category}</div>
          <div class="price-card-subtitle">${row.range}</div>
        </div>
        <span class="mobile-card-pill">Precios</span>
      </div>
      <div class="price-field-grid">
        ${priceField("Minimo", draftPriceValue(index, "minimum"), isOperator ? `oninput="setPriceDraft(${index}, 'minimum', this.value)"` : "")}
        ${priceField("Objetivo", draftPriceValue(index, "target"), isOperator ? `oninput="setPriceDraft(${index}, 'target', this.value)"` : "")}
        ${priceField("Punto equilibrio", draftPriceValue(index, "breakeven"), isOperator ? `oninput="setPriceDraft(${index}, 'breakeven', this.value)"` : "")}
        ${isOperator ? priceField("Costo", draftPriceValue(index, "cost"), `oninput="setPriceDraft(${index}, 'cost', this.value)"`) : ""}
      </div>
    </article>`)
    .join("")}</div>`;
}

function priceField(label, value, handler) {
  if (handler) {
    return `<label class="price-field"><span>${label}</span><input type="number" step="0.01" value="${value}" ${handler} /></label>`;
  }
  return `<div class="price-field readonly"><span>${label}</span><strong>${money(value)}</strong></div>`;
}

function renderHistory() {
  const rows = [...state.batches].reverse();
  if (!rows.length) {
    el("historyTable").innerHTML = emptyTable("No hay cargas registradas.");
    return;
  }
  el("historyTable").innerHTML = `<table><thead><tr>
    <th>Fecha</th><th>Tipo</th><th>Archivo</th><th class="numeric">Filas</th><th>Nota</th><th>Acciones</th>
  </tr></thead><tbody>${rows
    .map((row) => `<tr>
      <td>${new Date(row.createdAt).toLocaleString("es-PE")}</td><td>${row.type}</td><td>${row.fileName}</td><td class="numeric">${row.rows}</td><td>${row.note}</td>
      <td>${row.type === "sales" ? `<div class="row-actions"><button class="icon-button" onclick="prepareReplaceSalesBatch('${row.relatedId}')">Reemplazar</button><button class="icon-button danger" onclick="deleteSalesBatch('${row.id}')">Eliminar lote</button></div>` : ""}</td>
    </tr>`)
    .join("")}</tbody></table>`;
}

function draftPriceValue(index, field) {
  return priceDrafts[index]?.[field] ?? state.prices[index]?.[field] ?? 0;
}

function setPriceDraft(index, field, value) {
  priceDrafts[index] = { ...(priceDrafts[index] || {}), [field]: number(value) };
  const status = el("priceDraftStatus");
  if (status) status.textContent = "Cambios pendientes";
}

async function savePriceDrafts() {
  const entries = Object.entries(priceDrafts);
  if (!entries.length) return alert("No hay cambios pendientes.");
  try {
    for (const [indexText, changes] of entries) {
      const index = Number(indexText);
      for (const [field, value] of Object.entries(changes)) {
        await updatePrice(index, field, value, false);
      }
    }
    priceDrafts = {};
    await refreshRemoteAndRender();
    alert("Precios guardados correctamente.");
  } catch (error) {
    alert(error.message);
  }
}

async function updatePrice(index, field, value, shouldRefresh = true) {
  state.prices[index][field] = number(value);
  if (useSupabase) {
    const row = state.prices[index];
    const dbField = {
      minimum: "minimum_price",
      target: "target_price",
      breakeven: "breakeven_price",
      cost: "cost",
    }[field];
    const { error } = await supabaseClient.from("price_ranges").update({ [dbField]: number(value), updated_at: new Date().toISOString() }).eq("id", row.id);
    if (error) throw error;
    if (shouldRefresh) await refreshRemoteAndRender();
    return;
  }
  saveState();
  if (shouldRefresh) renderAll();
}

async function editStock(id) {
  const item = state.stock.find((row) => row.id === id);
  if (!item) return;
  const sold = salesForKey(stockKey(item.container, item.palletCode, item.caliber));
  const next = prompt(`Cajas iniciales para ${item.container} / ${item.palletCode} / ${item.caliber}`, item.boxes);
  if (next === null) return;
  const boxes = number(next);
  if (boxes < sold) return alert(`No puede ser menor a las cajas ya vendidas (${sold}).`);
  item.boxes = boxes;
  item.kilos = boxes * KG_PER_BOX;
  if (useSupabase) {
    const { error } = await supabaseClient.from("stock_items").update({ boxes, kilos: boxes * KG_PER_BOX, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return alert(error.message);
    await refreshRemoteAndRender();
    return;
  }
  saveState();
  renderAll();
}

async function deleteStock(id) {
  const item = state.stock.find((row) => row.id === id);
  if (!item) return;
  const sold = salesForKey(stockKey(item.container, item.palletCode, item.caliber));
  if (sold > 0) return alert("No se puede eliminar stock con ventas asociadas.");
  if (!confirm("Eliminar esta linea de stock?")) return;
  if (useSupabase) {
    const { error } = await supabaseClient.from("stock_items").delete().eq("id", id);
    if (error) return alert(error.message);
    await refreshRemoteAndRender();
    return;
  }
  state.stock = state.stock.filter((row) => row.id !== id);
  saveState();
  renderAll();
}

async function editSale(id) {
  const sale = state.sales.find((row) => row.id === id);
  if (!sale) return;
  const stock = state.stock.find((row) => stockKey(row.container, row.palletCode, row.caliber) === stockKey(sale.container, sale.palletCode, sale.caliber));
  const otherSold = salesForKey(stockKey(sale.container, sale.palletCode, sale.caliber), sale.id);
  const maxBoxes = number(stock?.boxes) - otherSold;
  const nextBoxes = prompt("Cajas vendidas", sale.boxes);
  if (nextBoxes === null) return;
  const boxes = number(nextBoxes);
  if (boxes <= 0 || boxes > maxBoxes) return alert(`Cantidad invalida. Maximo disponible para esta venta: ${maxBoxes}.`);
  const nextPrice = prompt("Precio venta total", sale.price);
  if (nextPrice === null) return;
  const price = number(nextPrice);
  if (price <= 0) return alert("Precio invalido.");
  const nextClient = prompt("Cliente", sale.client || "");
  if (nextClient === null) return;
  sale.boxes = boxes;
  sale.kilos = boxes * KG_PER_BOX;
  sale.price = price;
  sale.client = nextClient;
  if (useSupabase) {
    const { error } = await supabaseClient
      .from("sales")
      .update({ boxes, kilos: boxes * KG_PER_BOX, sale_price: price, client: nextClient, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return alert(error.message);
    await refreshRemoteAndRender();
    return;
  }
  saveState();
  renderAll();
}

async function deleteSale(id) {
  if (!confirm("Eliminar esta venta?")) return;
  if (useSupabase) {
    const { error } = await supabaseClient.from("sales").delete().eq("id", id);
    if (error) return alert(error.message);
    await refreshRemoteAndRender();
    return;
  }
  state.sales = state.sales.filter((row) => row.id !== id);
  saveState();
  renderAll();
}

async function deleteSalesBatch(batchLogId) {
  const batch = state.batches.find((row) => row.id === batchLogId);
  if (!batch || !confirm("Eliminar todas las ventas de este lote?")) return;
  const targetBatchId = batch.relatedId || "";
  if (targetBatchId) {
    if (useSupabase) {
      const { error } = await supabaseClient.from("upload_batches").delete().eq("id", targetBatchId);
      if (error) return alert(error.message);
      await refreshRemoteAndRender();
      return;
    }
    state.sales = state.sales.filter((sale) => sale.batchId !== targetBatchId);
  } else {
    alert("Este lote fue creado antes de guardar el ID interno. Use eliminacion individual.");
    return;
  }
  state.batches = state.batches.filter((row) => row.id !== batchLogId);
  saveState();
  renderAll();
}

function prepareReplaceSalesBatch(batchId) {
  if (!batchId) return alert("Este lote no tiene ID interno para reemplazo.");
  replaceSalesBatchId = batchId;
  setView("sales");
  el("salesUploadResult").textContent = `Reemplazo activo para lote ${batchId}.\nSeleccione el Excel corregido y pulse Procesar ventas.`;
}

function setView(view) {
  currentView = view;
  document.querySelectorAll(".view-section").forEach((node) => node.classList.add("hidden"));
  el(`${view}View`).classList.remove("hidden");
  document.querySelectorAll(".nav-link").forEach((node) => node.classList.toggle("active", node.dataset.view === view));
  el("viewTitle").textContent = document.querySelector(`[data-view="${view}"]`)?.textContent || "Dashboard";
}

function renderAll() {
  renderDashboard();
  renderStock();
  renderSales();
  renderPrices();
  renderHistory();
}

async function login() {
  if (useSupabase) {
    const email = normalizeText(el("loginEmail").value);
    const password = el("loginPassword").value;
    if (!email || !password) return alert("Ingrese correo y contrasena.");
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) return alert(error.message);
    try {
      await showAuthenticatedApp(data.session);
    } catch (profileError) {
      await supabaseClient.auth.signOut();
      alert(profileError.message);
    }
    return;
  }

  currentUser = { role: "operator" };
  el("loginView").classList.add("hidden");
  el("appView").classList.remove("hidden");
  el("roleBadge").textContent = "Operador local";
  document.querySelectorAll(".operator-only").forEach((node) => node.classList.remove("hidden"));
  setView("dashboard");
  renderAll();
}

function seedDemo() {
  if (useSupabase) {
    alert("La carga de ejemplo esta desactivada en modo Supabase.");
    return;
  }
  state.stock = [
    stockRow("CONT-001", "380", "12*", 65),
    stockRow("CONT-001", "380", "14", 18),
    stockRow("CONT-001", "380", "18", 5),
    stockRow("CONT-001", "380", "20*", 8),
    stockRow("CONT-001", "386", "12*", 96),
    stockRow("CONT-002", "380", "22", 80),
  ];
  state.sales = [
    saleRow("CONT-001", "380", "12*", 20, 560, "Cliente A"),
    saleRow("CONT-001", "380", "14", 18, 468, "Cliente B"),
    saleRow("CONT-002", "380", "22", 10, 275, "Cliente C"),
  ];
  state.batches = [];
  saveState();
  renderAll();
}

function stockRow(container, palletCode, caliber, boxes) {
  return {
    id: uid("stock"),
    container,
    palletCode,
    caliber,
    category: categoryFromCaliber(caliber),
    range: rangeFromCaliber(caliber),
    boxes,
    kilos: boxes * KG_PER_BOX,
  };
}

function saleRow(container, palletCode, caliber, boxes, price, client) {
  return {
    id: uid("sale"),
    batchId: "demo",
    date: new Date().toISOString().slice(0, 10),
    container,
    palletCode,
    caliber,
    boxes,
    kilos: boxes * KG_PER_BOX,
    price,
    client,
  };
}

document.addEventListener("DOMContentLoaded", async () => {
  initSupabaseClient();
  el("loginModeNotice").textContent = useSupabase ? "Modo produccion conectado a Supabase." : "Modo local de prueba. No comparte datos entre dispositivos.";
  el("loginButton").addEventListener("click", login);
  el("logoutButton").addEventListener("click", logout);
  el("mobileLogoutButton").addEventListener("click", logout);
  el("savePricesButton").addEventListener("click", savePriceDrafts);
  el("uploadStockButton").addEventListener("click", uploadStock);
  el("uploadSalesButton").addEventListener("click", uploadSales);
  el("seedButton").addEventListener("click", seedDemo);
  el("clearButton").addEventListener("click", () => {
    clearAllData();
  });
  ["globalSearch", "stockSearch", "salesSearch"].forEach((id) => el(id).addEventListener("input", renderAll));
  document.querySelectorAll(".nav-link").forEach((node) => node.addEventListener("click", () => setView(node.dataset.view)));
  document.querySelectorAll(".tab").forEach((node) => {
    node.addEventListener("click", () => {
      setDashboardTab(node.dataset.tab);
    });
  });

  if (useSupabase) {
    const { data } = await supabaseClient.auth.getSession();
    if (data.session) {
      try {
        await showAuthenticatedApp(data.session);
      } catch (error) {
        await supabaseClient.auth.signOut();
        alert(error.message);
      }
    }
  } else {
    renderAll();
  }
});

async function logout() {
  if (useSupabase) await supabaseClient.auth.signOut();
  location.reload();
}

async function clearAllData() {
  if (useSupabase) {
    if (!confirm("Eliminar todo el stock, ventas e historial de Supabase? Esta accion no elimina precios.")) return;
    const salesDelete = await supabaseClient.from("sales").delete().gt("id", 0);
    if (salesDelete.error) return alert(salesDelete.error.message);
    const stockDelete = await supabaseClient.from("stock_items").delete().gt("id", 0);
    if (stockDelete.error) return alert(stockDelete.error.message);
    const batchDelete = await supabaseClient.from("upload_batches").delete().not("id", "is", null);
    if (batchDelete.error) return alert(batchDelete.error.message);
    await refreshRemoteAndRender();
    return;
  }

  if (!confirm("Eliminar todos los datos locales?")) return;
    state.stock = [];
    state.sales = [];
    state.batches = [];
    saveState();
    renderAll();
}

function setDashboardTab(tabName) {
  currentTab = tabName;
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === tabName));
  renderDashboard();
}
