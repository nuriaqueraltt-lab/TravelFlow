const SHEETJS_MODULE_URL = "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";
const DEPOSIT_ACCOUNT_LAST4 = "0692";
const REQUIRED_HEADERS = ["Fecha", "Fecha valor", "Movimiento", "Más datos", "Importe", "Saldo"];

let sheetJsPromise;

function clean(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeKey(value) {
  return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function cents(value) {
  return Math.round(Number(value) * 100);
}

function isoDate(value, XLSX) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const match = clean(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  throw new Error("TREASURY_DATE_INVALID");
}

function classifyMovement(movement, moreData, amount) {
  const text = normalizeKey(`${movement} ${moreData}`);
  if (text.includes("traspaso")) return "INTERNAL_TRANSFER";
  if (text.includes("interes") || text.includes("comision")) return "BANK_EXPENSE";
  if (text.includes("comercia global payments") || /^web\d+/i.test(clean(movement))) {
    return amount < 0 ? "PAYMENT_GATEWAY_REFUND" : "PAYMENT_GATEWAY";
  }
  if (text.includes("renfe") || text.includes("fecha de operacion") || text.includes("t.plana")) {
    return "DEPOSIT_CARD_PURCHASE";
  }
  return amount > 0 ? "POSSIBLE_CLIENT_PAYMENT" : "POSSIBLE_SUPPLIER_PAYMENT";
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function loadSheetJs() {
  sheetJsPromise ??= import(SHEETJS_MODULE_URL);
  try {
    return await sheetJsPromise;
  } catch (error) {
    sheetJsPromise = null;
    throw new Error("TREASURY_PARSER_UNAVAILABLE", { cause: error });
  }
}

function findHeaderRow(rows) {
  const expected = REQUIRED_HEADERS.map(normalizeKey);
  return rows.findIndex((row) => {
    const values = row.map(normalizeKey);
    return expected.every((header) => values.includes(header));
  });
}

function validateBalances(movements) {
  for (let index = 0; index < movements.length - 1; index += 1) {
    const current = movements[index];
    const older = movements[index + 1];
    if (Math.abs(cents(older.balance) + cents(current.amount) - cents(current.balance)) > 1) {
      throw new Error("TREASURY_BALANCE_MISMATCH");
    }
  }
}

export async function parseTreasuryStatement(file) {
  if (!file) throw new Error("TREASURY_FILE_REQUIRED");
  if (!/\.(xls|xlsx)$/i.test(file.name)) throw new Error("TREASURY_FILE_TYPE_INVALID");

  const XLSX = await loadSheetJs();
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) throw new Error("TREASURY_SHEET_EMPTY");

  const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "", raw: true });
  const headingText = rows.slice(0, 3).flat().map(clean).join(" ");
  const accountMatch = headingText.match(/\bES\d{2}(?:\s*\d{4}){5}\b/i);
  const accountDigits = accountMatch?.[0]?.replace(/\s/g, "") || "";
  if (!accountDigits.endsWith(DEPOSIT_ACCOUNT_LAST4)) throw new Error("TREASURY_ACCOUNT_INVALID");

  const headerIndex = findHeaderRow(rows);
  if (headerIndex < 0) throw new Error("TREASURY_HEADERS_INVALID");
  const headerMap = Object.fromEntries(rows[headerIndex].map((header, index) => [normalizeKey(header), index]));

  const movements = [];
  for (const [sourcePosition, row] of rows.slice(headerIndex + 1).entries()) {
    if (!row.some((value) => clean(value))) continue;
    const movementDate = isoDate(row[headerMap.fecha], XLSX);
    const valueDate = isoDate(row[headerMap["fecha valor"]], XLSX);
    const bankMovement = clean(row[headerMap.movimiento]);
    const moreData = clean(row[headerMap["mas datos"]]);
    const amount = Number(row[headerMap.importe]);
    const balance = Number(row[headerMap.saldo]);
    if (!bankMovement || !Number.isFinite(amount) || !Number.isFinite(balance)) {
      throw new Error("TREASURY_ROW_INVALID");
    }
    const fingerprintSource = [
      "DEPOSIT", movementDate, valueDate, normalizeKey(bankMovement), normalizeKey(moreData),
      cents(amount), cents(balance)
    ].join("|");
    movements.push({
      id: await sha256(fingerprintSource),
      account: "DEPOSIT",
      accountLast4: DEPOSIT_ACCOUNT_LAST4,
      movementDate,
      valueDate,
      bankMovement,
      moreData,
      amount: cents(amount) / 100,
      balance: cents(balance) / 100,
      direction: amount >= 0 ? "ENTRY" : "EXIT",
      category: classifyMovement(bankMovement, moreData, amount),
      reconciliationStatus: "PENDING",
      fingerprintVersion: 1,
      sourcePosition
    });
  }

  if (!movements.length) throw new Error("TREASURY_NO_MOVEMENTS");
  validateBalances(movements);
  return {
    account: "DEPOSIT",
    accountLast4: DEPOSIT_ACCOUNT_LAST4,
    fileName: file.name,
    movements,
    firstDate: movements[movements.length - 1].movementDate,
    lastDate: movements[0].movementDate,
    finalBalance: movements[0].balance
  };
}

export function getTreasuryImportErrorMessage(error) {
  const messages = {
    TREASURY_FILE_REQUIRED: "Selecciona l’extracte bancari.",
    TREASURY_FILE_TYPE_INVALID: "El fitxer ha de ser un Excel .xls o .xlsx.",
    TREASURY_PARSER_UNAVAILABLE: "No s’ha pogut carregar el lector d’Excel. Comprova la connexió i torna-ho a provar.",
    TREASURY_SHEET_EMPTY: "L’Excel no conté cap pestanya amb moviments.",
    TREASURY_ACCOUNT_INVALID: "Aquest extracte no correspon al compte de dipòsits acabat en 0692.",
    TREASURY_HEADERS_INVALID: "No s’han trobat les columnes esperades de l’extracte bancari.",
    TREASURY_DATE_INVALID: "Hi ha una data que no es pot interpretar.",
    TREASURY_ROW_INVALID: "Hi ha una fila amb el moviment, l’import o el saldo incomplet.",
    TREASURY_BALANCE_MISMATCH: "La seqüència de saldos no quadra. No s’ha importat cap moviment.",
    TREASURY_NO_MOVEMENTS: "L’extracte no conté moviments.",
    "permission-denied": "No tens permís per importar moviments de Tresoreria."
  };
  return messages[error?.message] ?? messages[error?.code] ?? "No s’ha pogut importar l’extracte.";
}
