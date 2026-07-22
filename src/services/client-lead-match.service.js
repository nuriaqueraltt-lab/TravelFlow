function clean(value = "") { return String(value).trim(); }

function normalizeName(value = "") {
  return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function emailKeys(value = "") {
  return clean(value).toLowerCase().split(/[;,|·\s]+/).filter((item) => item.includes("@"));
}

function phoneKeys(value = "") {
  return clean(value).split(/[;|·/]+/).map((item) => {
    let digits = item.replace(/\D/g, "");
    if (digits.startsWith("00")) digits = digits.slice(2);
    if (digits.length === 11 && digits.startsWith("34")) digits = digits.slice(2);
    return digits;
  }).filter((digits) => digits.length >= 7);
}

function addToIndex(index, key, client) {
  if (!key) return;
  const matches = index.get(key) || [];
  matches.push(client);
  index.set(key, matches);
}

function sharedValues(left, right) {
  const rightSet = new Set(right);
  return [...new Set(left.filter((value) => rightSet.has(value)))];
}

export function findUnlinkedLeadClientMatches(leads = [], clients = []) {
  const emailIndex = new Map();
  const phoneIndex = new Map();
  const nameIndex = new Map();

  clients.filter((client) => client.active !== false).forEach((client) => {
    emailKeys(client.email).forEach((key) => addToIndex(emailIndex, key, client));
    phoneKeys(client.phone).forEach((key) => addToIndex(phoneIndex, key, client));
    addToIndex(nameIndex, normalizeName(client.fullName), client);
  });

  const matches = [];
  leads.filter((lead) => lead.active !== false && !clean(lead.clientId)).forEach((lead) => {
    const rejectedClientIds = new Set(Array.isArray(lead.rejectedClientMatchIds) ? lead.rejectedClientMatchIds : []);
    const leadEmails = emailKeys(lead.email);
    const leadPhones = phoneKeys(lead.phone);
    const leadName = normalizeName(lead.fullName || [lead.firstName, lead.lastName].filter(Boolean).join(" "));
    const candidates = new Map();

    leadEmails.forEach((key) => (emailIndex.get(key) || []).forEach((client) => candidates.set(client.id, client)));
    leadPhones.forEach((key) => (phoneIndex.get(key) || []).forEach((client) => candidates.set(client.id, client)));
    if (!candidates.size && leadName) (nameIndex.get(leadName) || []).forEach((client) => candidates.set(client.id, client));

    candidates.forEach((client) => {
      if (rejectedClientIds.has(client.id)) return;
      const emails = sharedValues(leadEmails, emailKeys(client.email));
      const phones = sharedValues(leadPhones, phoneKeys(client.phone));
      const sameName = Boolean(leadName && leadName === normalizeName(client.fullName));
      const reasons = [emails.length ? "correu" : "", phones.length ? "telèfon" : "", sameName ? "nom" : ""].filter(Boolean);
      const strong = emails.length > 0 || phones.length > 0;
      matches.push({
        lead,
        client,
        reasons,
        confidence: strong && candidates.size === 1 ? "HIGH" : "REVIEW",
        ambiguous: candidates.size > 1
      });
    });
  });

  return matches.sort((a, b) => {
    if (a.confidence !== b.confidence) return a.confidence === "HIGH" ? -1 : 1;
    return clean(a.lead.fullName).localeCompare(clean(b.lead.fullName), "ca");
  });
}
