function clean(value) { return String(value ?? "").trim().replace(/\s+/g, " "); }
function textKey(value) { return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function documentKey(value) { return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function emailKey(value) { return clean(value).toLowerCase(); }
function phoneKey(value) { return clean(value).replace(/\D/g, "").replace(/^0034/, "34").replace(/^34(?=\d{9}$)/, ""); }
function phoneKeys(value) { return clean(value).split(/\s*(?:·|\/|\||;)\s*/).map(phoneKey).filter(Boolean); }

export async function readClientImportFile(file) {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

const FIELD_ALIASES = {
  firstName: ["nom", "nombre"],
  lastName: ["cognoms", "apellidos", "cognom", "apellido", "apellido1", "primercognom", "primerapellido"],
  lastName2: ["apellido2", "segoncognom", "segundoapellido"],
  fullName: ["nomcognoms", "nombreapellidos", "client", "cliente", "clienta", "nomclient", "nombrecliente"],
  dni: ["dni", "nif", "nifcod", "document", "documentidentitat", "documento", "documentonif"],
  passport: ["passaport", "pasaporte"],
  phone: ["telefon", "telefono", "telefonowhatsapp", "tlf", "telf", "tlf1", "telf1", "telefon1", "telefono1", "mobil", "movil", "whatsapp"],
  email: ["email", "correu", "correuelectronic", "correoelectronico", "mail"],
  address: ["adreca", "adreca1", "direccion", "direccion1", "domicili", "domicilio"],
  postalCode: ["codipostal", "codigopostal", "postal", "cp"],
  city: ["poblacio", "poblacion", "pob", "ciutat", "ciudad", "localitat", "localidad"],
  province: ["provincia"],
  country: ["pais", "country"],
  superTraveler: ["superviatgera", "superviajera", "categoria", "categoria1", "category"]
};

function delimiterFor(firstLine) {
  const candidates = [";", "\t", ","];
  return candidates.sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
}

function parseRows(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const delimiter = delimiterFor(source.split(/\r?\n/, 1)[0] || "");
  const rows = []; let row = []; let value = ""; let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]; const next = source[index + 1];
    if (char === '"' && quoted && next === '"') { value += '"'; index += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === delimiter && !quoted) { row.push(value); value = ""; continue; }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value); value = "";
      if (row.some((cell) => clean(cell))) rows.push(row);
      row = []; continue;
    }
    value += char;
  }
  row.push(value); if (row.some((cell) => clean(cell))) rows.push(row);
  return rows;
}

function columnMap(headers) {
  const normalized = headers.map(textKey); const result = {};
  Object.entries(FIELD_ALIASES).forEach(([field, aliases]) => {
    const indexes = normalized.reduce((matches, header, index) => {
      const exact = aliases.includes(header);
      const numberedPhone = field === "phone" && /^(?:telefon|telefono|tlf|telf|mobil|movil|whatsapp)\d+$/.test(header);
      const labelledAddress = ["address", "postalCode", "city", "province", "country"].includes(field)
        && aliases.some((alias) => header === `${alias}client` || header === `${alias}cliente` || header === `${alias}1`);
      if (exact || numberedPhone || labelledAddress) matches.push(index);
      return matches;
    }, []);
    if (indexes.length) result[field] = field === "phone" ? indexes : indexes[0];
  });
  return result;
}

function cell(row, columns, field) {
  if (columns[field] === undefined) return "";
  const indexes = Array.isArray(columns[field]) ? columns[field] : [columns[field]];
  return [...new Set(indexes.map((index) => clean(row[index])).filter(Boolean))].join(" · ");
}
function isSuperTraveler(value) { return /^(1|si|sí|true|x|superviatgera|superviajera)$/i.test(clean(value)) || /super/i.test(clean(value)); }

function normalizeRow(row, columns, line) {
  const firstName = cell(row, columns, "firstName"); const lastName = cell(row, columns, "lastName"); const lastName2 = cell(row, columns, "lastName2");
  const fullName = cell(row, columns, "fullName") || clean(`${firstName} ${lastName} ${lastName2}`);
  return {
    line, fullName, dni: cell(row, columns, "dni"), passport: cell(row, columns, "passport"),
    phone: cell(row, columns, "phone"), email: emailKey(cell(row, columns, "email")),
    address: cell(row, columns, "address"), postalCode: cell(row, columns, "postalCode"),
    city: cell(row, columns, "city"), province: cell(row, columns, "province"), country: cell(row, columns, "country"),
    superTraveler: isSuperTraveler(cell(row, columns, "superTraveler"))
  };
}

function indexExisting(clients) {
  const indexes = { dni: new Map(), passport: new Map(), email: new Map(), phone: new Map() };
  clients.forEach((client) => {
    [["dni", [documentKey(client.dni)]], ["passport", [documentKey(client.passport)]], ["email", [emailKey(client.email)]], ["phone", phoneKeys(client.phone)]].forEach(([field, keys]) => keys.forEach((key) => {
      if (!key) return; const values = indexes[field].get(key) || []; values.push(client); indexes[field].set(key, values);
    }));
  });
  return indexes;
}

function matchesFor(item, indexes) {
  const found = new Map();
  [["dni", [documentKey(item.dni)]], ["passport", [documentKey(item.passport)]], ["email", [emailKey(item.email)]], ["phone", phoneKeys(item.phone)]].forEach(([field, keys]) => keys.forEach((key) => {
    (key ? indexes[field].get(key) || [] : []).forEach((client) => found.set(client.id, client));
  }));
  return [...found.values()];
}

export function previewClientImport(text, existingClients = []) {
  const parsed = parseRows(text);
  if (parsed.length < 2) throw new Error("IMPORT_EMPTY");
  const columns = columnMap(parsed[0]);
  if (columns.fullName === undefined && columns.firstName === undefined) throw new Error("IMPORT_NAME_COLUMN_REQUIRED");
  const indexes = indexExisting(existingClients); const seen = { dni: new Map(), passport: new Map(), email: new Map(), phone: new Map() };
  const items = parsed.slice(1).map((row, index) => normalizeRow(row, columns, index + 2)).map((item) => {
    if (!item.fullName) return { ...item, status: "INVALID", reason: "Falta el nom" };
    const matches = matchesFor(item, indexes);
    const repeated = [];
    [["dni", [documentKey(item.dni)]], ["passport", [documentKey(item.passport)]], ["email", [emailKey(item.email)]], ["phone", phoneKeys(item.phone)]].forEach(([field, keys]) => keys.forEach((key) => {
      if (!key) return; if (seen[field].has(key)) repeated.push(seen[field].get(key)); else seen[field].set(key, item.line);
    }));
    if (matches.length > 1) return { ...item, status: "REVIEW", reviewType: "MULTIPLE_EXISTING", reason: "Les dades coincideixen amb més d’una clienta existent" };
    if (repeated.length) return { ...item, status: "REVIEW", reviewType: "DUPLICATE_IN_FILE", reason: `Possible duplicat dins del fitxer (línia ${repeated[0]})` };
    if (matches.length === 1) return { ...item, status: "EXISTING", reason: `Ja existeix: ${matches[0].fullName || "clienta sense nom"}`, existingClientId: matches[0].id };
    return { ...item, status: "NEW", reason: "Preparada per importar" };
  });
  const totals = items.reduce((result, item) => ({ ...result, [item.status]: (result[item.status] || 0) + 1 }), { NEW: 0, EXISTING: 0, REVIEW: 0, INVALID: 0 });
  return { items, totals, columns: Object.keys(columns) };
}
