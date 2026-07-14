# TravelFlow · Arquitectura funcional i Firestore

## Objectiu de la versió 1

TravelFlow 1.0 se centra en la gestió de leads de Dones i Viatgeres. La base ha de permetre afegir més endavant clients, reserves, pagaments, documents, automatitzacions i assistència amb IA sense haver de redissenyar les dades principals.

## Principis de modelatge

- Un lead representa una persona interessada, no una conversa concreta.
- Els canals i interessos poden canviar sense perdre l'historial.
- Les notes, missatges, trucades i canvis d'estat es guarden com activitats separades.
- Cada lead actiu ha de poder tenir una pròxima acció clara.
- Els documents sensibles no es guarden dins del document principal del lead.
- Les dades necessàries per al Dashboard es consulten a partir de camps indexables.
- Els camps de sistema utilitzen timestamps de Firestore.

---

## Col·leccions de la versió 1

### `users`

Document ID: UID de Firebase Authentication.

```js
{
  displayName: "Núria Queralt",
  email: "...",
  role: "ADMIN",
  active: true,
  avatarUrl: "",
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

Rols inicials:

- `ADMIN`: accés total.
- `MANAGER`: gestió de leads, tasques i viatges.
- `AGENT`: gestió dels leads assignats i consulta general.

### `leads`

Document principal de cada futura viatgera.

```js
{
  firstName: "Maria",
  lastName: "Garcia",
  fullNameNormalized: "maria garcia",

  phone: "600000000",
  phoneNormalized: "34600000000",
  email: "maria@example.com",
  emailNormalized: "maria@example.com",

  status: "INFO_SENT",
  channel: "WHATSAPP",
  source: "INSTAGRAM_ORGANIC",

  tripId: "",
  tripNameSnapshot: "Irlanda 2027",
  interestText: "Irlanda 2027",

  ownerId: "firebase-uid",
  ownerNameSnapshot: "Núria Queralt",

  firstContactAt: Timestamp,
  lastContactAt: Timestamp,
  nextActionAt: Timestamp,
  nextActionType: "WHATSAPP_FOLLOW_UP",
  nextActionNote: "Preguntar si ha revisat l'itinerari",

  priority: "NORMAL",
  temperature: "WARM",

  lostReason: null,
  lostNote: "",

  tags: ["comparteix-habitacio"],
  notesSummary: "Prefereix sortida des de Barcelona",

  isArchived: false,
  createdBy: "firebase-uid",
  updatedBy: "firebase-uid",
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

No guardarem totes les notes o converses dins del document del lead. El document només conté l'estat actual i dades útils per filtrar.

### `activities`

Historial immutable de cada lead.

```js
{
  leadId: "lead-id",
  type: "NOTE",
  channel: "WHATSAPP",
  title: "Informació enviada",
  body: "S'ha enviat l'itinerari d'Irlanda.",

  fromStatus: null,
  toStatus: null,

  occurredAt: Timestamp,
  createdBy: "firebase-uid",
  createdByNameSnapshot: "Núria Queralt",
  createdAt: Timestamp
}
```

Tipus inicials:

- `LEAD_CREATED`
- `NOTE`
- `EMAIL_SENT`
- `WHATSAPP_SENT`
- `PHONE_CALL`
- `STATUS_CHANGED`
- `NEXT_ACTION_SET`
- `OWNER_CHANGED`
- `TRIP_CHANGED`
- `LEAD_LOST`
- `LEAD_REOPENED`

### `tasks`

Accions operatives amb estat propi.

```js
{
  leadId: "lead-id",
  title: "Fer seguiment per WhatsApp",
  type: "WHATSAPP_FOLLOW_UP",
  dueAt: Timestamp,
  status: "PENDING",
  priority: "HIGH",
  assignedTo: "firebase-uid",
  completedAt: null,
  completedBy: null,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

En la primera versió, la pròxima acció principal també es replica al lead per poder construir el Dashboard amb consultes simples.

### `trips`

Catàleg mínim de viatges per relacionar interessos.

```js
{
  name: "Irlanda Màgica",
  slug: "irlanda-magica-2027",
  destination: "Irlanda",
  startDate: Timestamp,
  endDate: Timestamp,
  year: 2027,
  status: "PUBLISHED",
  websiteUrl: "",
  imageUrl: "",
  capacity: 12,
  availablePlaces: null,
  active: true,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

### `notifications`

Avisos interns generats per regles de negoci o, més endavant, per automatitzacions.

```js
{
  userId: "firebase-uid",
  type: "OVERDUE_FOLLOW_UP",
  title: "Seguiment vençut",
  body: "Maria Garcia esperava seguiment ahir.",
  leadId: "lead-id",
  read: false,
  createdAt: Timestamp,
  readAt: null
}
```

### `ai_suggestions`

No s'utilitzarà en la primera implementació, però queda reservada.

```js
{
  userId: "firebase-uid",
  leadId: "lead-id",
  type: "MESSAGE_DRAFT",
  inputVersion: 1,
  suggestion: "Hola Maria...",
  reason: "Informació enviada fa 3 dies sense resposta",
  status: "PENDING_REVIEW",
  model: "",
  createdAt: Timestamp,
  reviewedAt: null
}
```

La IA mai enviarà missatges automàticament en la primera fase.

---

## Estats del lead

Ordre comercial inicial:

1. `NEW`
2. `CONTACTED`
3. `INFO_SENT`
4. `FOLLOW_UP`
5. `BOOKING_STARTED`
6. `CUSTOMER`
7. `LOST`

Regles:

- `LOST` requereix `lostReason`.
- `CUSTOMER` tanca les tasques comercials pendents.
- Un lead perdut es pot reobrir i torna a `FOLLOW_UP` o `CONTACTED`.
- L'estat no substitueix la pròxima acció.

## Canals

- `WEB`
- `WHATSAPP`
- `INSTAGRAM`
- `FACEBOOK`
- `EMAIL`
- `PHONE`
- `OTHER`

## Orígens

- `WEBSITE_FORM`
- `GOOGLE_ADS`
- `INSTAGRAM_ORGANIC`
- `FACEBOOK_ORGANIC`
- `MANYCHAT`
- `REFERRAL`
- `RETURNING_CUSTOMER`
- `MANUAL`
- `OTHER`

## Prioritats

- `LOW`
- `NORMAL`
- `HIGH`
- `URGENT`

## Temperatura comercial

- `COLD`
- `WARM`
- `HOT`

La temperatura és orientativa i editable. No substitueix l'estat.

## Motius de pèrdua

- `PRICE`
- `DATES`
- `NO_RESPONSE`
- `DESTINATION`
- `HEALTH`
- `BOOKED_ELSEWHERE`
- `NOT_INTERESTED`
- `OTHER`

---

## Detecció de duplicats

Abans de crear un lead, l'aplicació buscarà:

1. coincidència exacta de `phoneNormalized`;
2. coincidència exacta de `emailNormalized`;
3. possible coincidència de nom, només com a avís.

No es fusionaran leads automàticament.

## Índexs previstos

Consultes principals:

- leads actius per `status` i `updatedAt`;
- leads per `ownerId` i `nextActionAt`;
- seguiments vençuts per `isArchived`, `nextActionAt` i `status`;
- leads per `tripId` i `status`;
- activitats per `leadId` i `occurredAt` descendent;
- tasques per `assignedTo`, `status` i `dueAt`.

Els índexs compostos es crearan quan Firestore indiqui les consultes exactes necessàries.

## Seguretat prevista

- Tot accés requereix autenticació.
- Els usuaris inactius no poden llegir ni escriure.
- `ADMIN` pot gestionar-ho tot.
- `MANAGER` pot gestionar leads, activitats, tasques i viatges.
- `AGENT` pot editar leads assignats i crear activitats pròpies.
- Les activitats no s'eliminen des de la interfície normal.
- `createdBy`, `createdAt` i camps d'auditoria no es poden manipular lliurement des del client.

## Ordre d'implementació

1. Firebase SDK i configuració.
2. Authentication amb email i contrasenya.
3. Col·lecció `users` i comprovació d'usuari actiu.
4. Regles inicials segures.
5. Servei de leads.
6. Creació i llistat de leads.
7. Activitats i historial.
8. Pròxima acció i Dashboard real.
9. Tasques.
10. Viatges.
11. Suggeriments d'IA.
