// Bilingual copy. English is the source voice; German is REWRITTEN comedy, not
// translated — a calque of an English joke is not a joke.
//
// House style, binding for every new string:
// - The company narrates and never apologises. Consequences are procedures.
// - Understate the disaster, overstate the paperwork. A potion detonation is
//   a "consignment incident".
// - Money is always concrete: never "a penalty", always -300 in a labelled field.
// - Second person for blame, passive voice for the company's own failures.
// - Max 9 words per toast line, 4 per field label, 3 per stamp.
// - No exclamation marks and no emoji in company chrome. Those belong to
//   gameplay toasts — that is the mountain shouting, not the firm.
// - German: the company uses "Sie". A firm that addresses you formally WHILE
//   docking your pay is funnier than one that gets chummy about it.

const EN = {
  'brand.name': 'VPS',
  'brand.full': 'Vertical Parcel Service',
  'brand.tagline': 'UPHILL. ON TIME. MOSTLY.',
  'brand.legal': 'VPS is a subsidiary of nothing and liable for less.',

  'zone.meadow': 'Sunny Meadows',
  'zone.forest': 'Pinewood Ledges',
  'zone.cliffs': 'Windy Cliffs',
  'zone.frozen': 'The Frozen Face',
  'zone.summit': 'Storm Summit',

  'spot.hermit': 'Hermit Hut',
  'spot.lumber': 'Lumber Post',
  'spot.owl': 'Owl Watchtower',
  'spot.cottage': 'Cliffside Cottage',
  'spot.shrine': 'Wind Shrine',
  'spot.icefisher': 'Ice Fisher Camp',
  'spot.yeti': 'Yeti Outpost',
  'spot.stormgate': 'Stormgate',
  'spot.court': 'The Summit Court',
  'spot.unknown': 'ADDRESS WITHHELD',

  'pkg.crate.name': 'Plain Crate',
  'pkg.crate.note': 'Contents: unremarkable. Suspiciously unremarkable.',
  'pkg.crate.warning': 'Handle however.',
  'pkg.porcelain.name': "Grandma's Porcelain",
  'pkg.porcelain.note': '1× tea set, 74 years old. Grandma knows where you live.',
  'pkg.porcelain.warning': 'EXTREMELY FRAGILE',
  'pkg.balloon.name': 'Balloon Bundle',
  'pkg.balloon.note': 'Party supplies. The wind has already signed for it once.',
  'pkg.balloon.warning': 'LIGHTER THAN AIR-ISH',
  'pkg.egg.name': 'Dragon Egg',
  'pkg.egg.note': 'Keep warm. Do NOT let it roll downhill. It remembers.',
  'pkg.egg.warning': 'JUMPY WHEN STARTLED',
  'pkg.sheep.name': 'Sheep in a Crate',
  'pkg.sheep.note': '1× Angry Sheep. She did not agree to this.',
  'pkg.sheep.warning': 'DO NOT SHAKE. Good luck.',
  'pkg.anvil.name': 'Cursed Anvil',
  'pkg.anvil.note': 'Whispers Latin at night. Indestructible. Unfortunately.',
  'pkg.anvil.warning': 'HEAVY. TAKE THE CABLE CAR.',
  'pkg.potion.name': 'Unstable Potion',
  'pkg.potion.note': 'Alchemist-grade Essence of Regret, 1 flask.',
  'pkg.potion.warning': 'DO NOT SHAKE — SERIOUSLY. IT EXPLODES.',
  'pkg.ghost.name': 'Ghost Package',
  'pkg.ghost.note': 'Addressee deceased. Deliver anyway.',
  'pkg.ghost.warning': 'OCCASIONALLY FORGETS WHICH WAY IS DOWN',
  'pkg.golden.name': 'Golden {name}',
  'pkg.golden.note': '{note} Insured for a fortune.',
  'pkg.golden.warning': 'GOLDEN — ×3 PAY. DESTRUCTION COSTS 300.',

  'hud.consignment': 'CONSIGNMENT',
  'hud.nopackage': 'NO CONSIGNMENT',
  'hud.nopackage.note': 'Collect at the depot chute.',
  'hud.condition': 'CONDITION',
  'hud.instability': 'INSTABILITY',
  'hud.deliveries_one': '{n} delivery',
  'hud.deliveries_other': '{n} deliveries',
  'hud.revenue': 'REVENUE',
  'hud.altitude': 'ALT',
  'hud.deliverto': 'DELIVER TO',
  'hud.bonus': 'BONUS {n}s',
  'hud.bonus.expired': 'BONUS EXPIRED',
  'hud.chain': '×{mult} ON A ROLL',
  'hud.waybill': 'WAYBILL',
  'hud.tracking': 'TRACKING',
  'hud.consignee': 'CONSIGNEE',
  'hud.manifest': 'MANIFEST',
  'hud.shift': 'SHIFT {n}',
  'hud.quota': 'QUOTA',
  'hud.lockhint': 'Click to resume mouse look',
  'hud.quality': 'QUALITY: {tier}',
  'hud.paused': 'PAUSED',

  'stamp.delivered': 'DELIVERED',
  'stamp.damaged': 'DAMAGED IN TRANSIT',
  'stamp.refused': 'REFUSED BY RECIPIENT',
  'stamp.hazard': 'HAZARD PAY APPROVED',
  'stamp.golden': 'GOLDEN CONSIGNMENT',
  'stamp.lost': 'LOST IN TRANSIT',
  'stamp.closed': 'SHIFT CLOSED',

  'rank.pip': 'PERFORMANCE PLAN',
  'rank.review': 'UNDER REVIEW',
  'rank.satisfactory': 'SATISFACTORY',
  'rank.commendable': 'COMMENDABLE',
  'rank.exemplary': 'EXEMPLARY',

  'toast.firstpickup': '📦 Grab your first package at the glowing ring!',
  'toast.music.on': '🎵 Music on',
  'toast.music.off': '🔇 Music off',
  'toast.checkpoint': '🚩 Checkpoint: {name}',
  'toast.recovered': '📦 Recovered!',
  'toast.scenicroute': 'The package took the scenic route back.',
  'toast.destroyed': '📦 PACKAGE DESTROYED',
  'toast.potionwentoff': '💥 THE POTION WENT OFF',
  'toast.replacement': 'A replacement is at the depot. It comes out of your pay.',
  'toast.sheeploose': '🐑 THE SHEEP IS LOOSE! Catch her!',
  'toast.sheepcaught': '🐑 RECAPTURED! She is not happy about it.',
  'toast.sheepresigned': '🐑 The sheep has formally resigned.',
  'toast.delivered': '✅ DELIVERED! +{n}',
  'toast.deliveredrough': '…in {pct}% condition. They noticed.',
  'toast.nextpickup': 'Next pickup at the depot. It gets worse.',
  'toast.deliverto': 'Deliver to: {name} (ALT {alt} m)',
  'toast.insurance': '💸 The insurance claim: -300.',
  'toast.chainbroken': '💔 Chain broken ({reason}).',
  'toast.rolled': '🌀 ROLLED IT!',
  'toast.hardlanding': '🦴 That landing had consequences.',
  'toast.boulder': '🪨 BOULDER!',
  'toast.lightning': '⚡ DIRECT-ISH HIT',
  'toast.noticed': '🌬️ The mountain has noticed you.',
  'toast.premiums': '🪨 Insurance premiums rising…',
  'toast.stormknows': '⛈️ The summit storm knows your name.',

  'reason.lost': 'package lost',
  'reason.respawn': 'respawn',

  'bonus.boing': '🍄 BOING ×{n}',
  'bonus.closeone': '😅 CLOSE ONE',
  'bonus.hazardpay': '☂ HAZARD PAY',
  'bonus.plank': '🪵 BEAT THE BOARD',

  'score.base': 'BASE',
  'score.speed': '⚡ SPEED',
  'score.airmail': '🪂 AIRMAIL',
  'score.condition': 'CONDITION {pct}%',
  'score.chain': '🔥 CHAIN ×{mult}',
  'score.golden': '✨ GOLDEN ×3',
  'score.total': '=',

  'event.gale': '🌬️ GALE',
  'event.boulderRain': '🪨 BOULDER RAIN',
  'event.avalanche': '🏔️ AVALANCHE',
  'event.thunder': '⛈️ THUNDERSTORM',
  'event.incoming': '⚠ {name} INCOMING',
  'event.live': '{name}! · ☂ HAZARD PAY +{n}',

  'quip.0': '☠️ Gravity: 1 — You: 0. Back to the checkpoint.',
  'quip.1': '📋 That fall has been noted in your performance review.',
  'quip.2': '🏔️ The mountain thanks you for your donation.',
  'quip.3': '📦 Package status: emotionally damaged. So are you.',
  'quip.4': '🧾 Respawn fee waived (this time).',

  'title.loading': 'Loading the mountain…',
  'title.start': 'CLICK TO START YOUR SHIFT',
  'title.blurb': 'Collect consignments at the depot, haul them up the mountain, ride the cable car. Do not shake the potion.',
  'title.controls': '<b>WASD</b> move · <b>Shift</b> sprint · <b>Space</b> jump (hold in air = parachute, tap before landing = roll) · <b>F</b> throw / kick · <b>G</b> set down · <b>C</b> belly slide',
  'hint.controls': '<b>WASD</b> move · <b>Shift</b> sprint · <b>Space</b> jump / hold: parachute / tap before landing: roll · <b>F</b> throw · <b>G</b> set down · <b>C</b> slide · <b>M</b> music · <b>P</b> photo · <b>Esc</b> pause',
  'fault.title': 'SERVICE INTERRUPTION',
  'fault.body': 'The depot could not be reached. Details below, for the file.',

  'menu.resume': 'RESUME SHIFT',
  'menu.abandon': 'ABANDON SHIFT',
  'menu.lang': 'LANGUAGE',
  'menu.motion': 'REDUCE MOTION',
  'menu.quality': 'QUALITY',
  'menu.accept': 'ACCEPT MANIFEST',
  'menu.next': 'NEXT SHIFT',
  'menu.meta': 'REQUISITIONS',
  'menu.requisition': 'REQUISITION',
  'menu.pausenote': 'The mountain has been asked to wait. It has agreed, provisionally.',

  'brief.title': 'ROUTE ASSIGNMENT',
  'brief.memo.first': 'Welcome to the Vertical Parcel Service. Your route is below. The mountain has been informed of your arrival and has raised no objection in writing.',
  'brief.memo.normal': 'Shift {n}. Your quota reflects your growing experience and our growing expectations. These are the same number.',
  'brief.memo.pip': 'Shift {n}. You remain on a performance plan. Nothing about the route has been made easier; the paperwork has been made shorter.',
  'brief.memo.newtype': 'Shift {n}. A new class of consignment has been added to your route. It was added by someone else. They are not available for questions.',

  'status.pending': 'PENDING',
  'status.transit': 'IN TRANSIT',
  'status.delivered': 'DELIVERED',
  'status.writtenOff': 'WRITTEN OFF',
  'status.refused': 'REFUSED',

  'results.title': 'SHIFT {n} - STATEMENT',
  'results.revenue': 'TOTAL REVENUE',
  'results.met': 'Quota met. No further action is required from you at this time.',
  'results.missed': 'Revenue of {revenue} against a quota of {quota}. A performance plan has been opened on your behalf.',
  'results.terminated': 'Three consecutive plans. Your route has been reassigned to shift one. Your merit points are, of course, retained.',
  'results.delivered': 'Consignments delivered',
  'results.writtenoff': 'Written off',
  'results.refused': 'Refused by recipient',
  'results.clean': 'Clean deliveries',
  'results.bestchain': 'Longest run',
  'results.falls': 'Unscheduled descents',
  'results.hazard': 'Hazard pay',
  'results.speed': 'Speed bonuses',
  'results.airmail': 'Airmail deliveries',
  'results.golden': 'Golden consignments',
  'results.distance': 'Distance carried',
  'results.peak': 'Highest point reached',
  'results.mp': 'Merit points earned',

  'meta.title': 'REQUISITIONS',
  'meta.mp': 'MERIT POINTS',
  'meta.legal': 'Merit Points are not currency and have no cash value.',
  'meta.locked': 'Available from shift {n}.',
  'meta.group.equipment': 'EQUIPMENT REQUISITION',
  'meta.group.certification': 'CERTIFICATIONS',
  'meta.group.insurance': 'INSURANCE & LIABILITY',
  'meta.group.union': 'UNION BENEFITS',

  'unlock.harness': 'ERGONOMIC LOAD HARNESS',
  'unlock.harness.eff': 'Heavy cargo slows you down less.',
  'unlock.boots': 'STEEL-TOED BOOTS',
  'unlock.boots.eff': 'Survive harder landings before the knockdown.',
  'unlock.packaging': 'REINFORCED PACKAGING',
  'unlock.packaging.eff': 'Impacts do less damage to cargo.',
  'unlock.insurance': 'CARGO INSURANCE',
  'unlock.insurance.eff': 'A write-off costs you less.',
  'unlock.seniority': 'SENIORITY BONUS',
  'unlock.seniority.eff': 'The on-a-roll multiplier caps higher.',
  'unlock.chute': 'PARACHUTE, COMPANY ISSUE',
  'unlock.chute.eff': 'More steering authority under the glider.',
  'unlock.hazardGrade': 'HAZARD PAY GRADE',
  'unlock.hazardGrade.eff': 'Hazard pay accrues faster during events.',
  'unlock.cablePass': 'CABLE CAR ANNUAL PASS',
  'unlock.cablePass.eff': 'Gondolas run faster and dawdle less at stations.',
  'unlock.restBreak': 'UNION REST BREAK',
  'unlock.restBreak.eff': 'Once per shift, a write-off is reissued instead.',
  'unlock.waiver': 'THIRD-PARTY LIABILITY WAIVER',
  'unlock.waiver.eff': 'Respawning no longer breaks your run.',
  'boot.physics': 'Waking the physics engine…',
  'boot.terrain': 'Surveying the mountain…',
  'boot.props': 'Installing hazards…',
  'boot.courier': 'Briefing the courier…',
  'boot.shaders': 'Compiling the weather…',
  'boot.ready': 'Depot open.',
  'spot.depot': 'THE DEPOT',
  'toast.refused': 'REFUSED BY RECIPIENT',
  'toast.returntosender': 'Return it to the depot. Downhill, for once.',
  'toast.returned': 'Returned to sender. Filed.',
  'toast.oversized': 'OVERSIZED — SINGLE ITEM DISPATCH',
  'toast.depotmid': 'DISPATCH MOVED TO MID-STATION COUNTER',
  'toast.depotvalley': 'DISPATCH RETURNED TO VALLEY COUNTER',
  'reason.refused': 'refusal',
  'score.refused': 'RETURN HANDLING',
  'hud.stack': 'STACK {n}/{max}',
  'lang.name': 'ENGLISH',
};

const DE = {
  'brand.name': 'VPS',
  'brand.full': 'Vertikaler Paketdienst',
  'brand.tagline': 'BERGAUF. PÜNKTLICH. MEISTENS.',
  'brand.legal': 'Die VPS ist Tochter von nichts und haftet für weniger.',

  'zone.meadow': 'Sonnenwiesen',
  'zone.forest': 'Kiefernsimse',
  'zone.cliffs': 'Windklippen',
  'zone.frozen': 'Die Frostwand',
  'zone.summit': 'Sturmgipfel',

  'spot.hermit': 'Einsiedlerhütte',
  'spot.lumber': 'Holzfällerposten',
  'spot.owl': 'Eulenwarte',
  'spot.cottage': 'Klippenkate',
  'spot.shrine': 'Windschrein',
  'spot.icefisher': 'Eisfischerlager',
  'spot.yeti': 'Yeti-Außenstelle',
  'spot.stormgate': 'Sturmtor',
  'spot.court': 'Der Gipfelhof',
  'spot.unknown': 'ANSCHRIFT ZURÜCKGEHALTEN',

  'pkg.crate.name': 'Schlichte Kiste',
  'pkg.crate.note': 'Inhalt: unauffällig. Verdächtig unauffällig.',
  'pkg.crate.warning': 'Beliebig behandeln.',
  'pkg.porcelain.name': 'Omas Porzellan',
  'pkg.porcelain.note': '1× Teeservice, 74 Jahre alt. Oma kennt Ihre Adresse.',
  'pkg.porcelain.warning': 'ÄUSSERST ZERBRECHLICH',
  'pkg.balloon.name': 'Luftballonbündel',
  'pkg.balloon.note': 'Partybedarf. Der Wind hat es schon einmal quittiert.',
  'pkg.balloon.warning': 'LEICHTER ALS LUFT-ISCH',
  'pkg.egg.name': 'Drachenei',
  'pkg.egg.note': 'Warm halten. NICHT bergab rollen lassen. Es merkt sich das.',
  'pkg.egg.warning': 'SCHRECKHAFT',
  'pkg.sheep.name': 'Schaf in Kiste',
  'pkg.sheep.note': '1× wütendes Schaf. Sie hat dem nicht zugestimmt.',
  'pkg.sheep.warning': 'NICHT SCHÜTTELN. Viel Glück.',
  'pkg.anvil.name': 'Verfluchter Amboss',
  'pkg.anvil.note': 'Flüstert nachts Latein. Unzerstörbar. Leider.',
  'pkg.anvil.warning': 'SCHWER. NEHMEN SIE DIE GONDEL.',
  'pkg.potion.name': 'Instabiler Trank',
  'pkg.potion.note': 'Reueessenz in Alchemistenqualität, 1 Flakon.',
  'pkg.potion.warning': 'NICHT SCHÜTTELN — ERNSTHAFT. ER GEHT HOCH.',
  'pkg.ghost.name': 'Geisterpaket',
  'pkg.ghost.note': 'Empfänger verstorben. Trotzdem zustellen.',
  'pkg.ghost.warning': 'VERGISST GELEGENTLICH, WO UNTEN IST',
  'pkg.golden.name': 'Goldene(r) {name}',
  'pkg.golden.note': '{note} Versichert auf ein Vermögen.',
  'pkg.golden.warning': 'GOLDEN — ×3 LOHN. ZERSTÖRUNG KOSTET 300.',

  'hud.consignment': 'SENDUNG',
  'hud.nopackage': 'KEINE SENDUNG',
  'hud.nopackage.note': 'Abholung an der Depotrutsche.',
  'hud.condition': 'ZUSTAND',
  'hud.instability': 'INSTABILITÄT',
  'hud.deliveries_one': '{n} Zustellung',
  'hud.deliveries_other': '{n} Zustellungen',
  'hud.revenue': 'UMSATZ',
  'hud.altitude': 'HÖHE',
  'hud.deliverto': 'ZUSTELLEN AN',
  'hud.bonus': 'BONUS {n}s',
  'hud.bonus.expired': 'BONUS VERFALLEN',
  'hud.chain': '×{mult} IM LAUF',
  'hud.waybill': 'FRACHTBRIEF',
  'hud.tracking': 'SENDUNGSNR',
  'hud.consignee': 'EMPFÄNGER',
  'hud.manifest': 'TAGESAUFTRAG',
  'hud.shift': 'SCHICHT {n}',
  'hud.quota': 'SOLL',
  'hud.lockhint': 'Klicken, um die Mausblickführung fortzusetzen',
  'hud.quality': 'QUALITÄT: {tier}',
  'hud.paused': 'PAUSIERT',

  'stamp.delivered': 'ZUGESTELLT',
  'stamp.damaged': 'TRANSPORTSCHADEN',
  'stamp.refused': 'ANNAHME VERWEIGERT',
  'stamp.hazard': 'GEFAHRENZULAGE BEWILLIGT',
  'stamp.golden': 'GOLDSENDUNG',
  'stamp.lost': 'AUF DEM TRANSPORT VERLOREN',
  'stamp.closed': 'SCHICHT GESCHLOSSEN',

  'rank.pip': 'LEISTUNGSGESPRÄCH',
  'rank.review': 'IN PRÜFUNG',
  'rank.satisfactory': 'ZUFRIEDENSTELLEND',
  'rank.commendable': 'LOBENSWERT',
  'rank.exemplary': 'VORBILDLICH',

  'toast.firstpickup': '📦 Erste Sendung im leuchtenden Ring abholen!',
  'toast.music.on': '🎵 Musik an',
  'toast.music.off': '🔇 Musik aus',
  'toast.checkpoint': '🚩 Kontrollpunkt: {name}',
  'toast.recovered': '📦 Wieder in der Hand!',
  'toast.scenicroute': 'Die Sendung nahm den landschaftlich schönen Rückweg.',
  'toast.destroyed': '📦 SENDUNG ZERSTÖRT',
  'toast.potionwentoff': '💥 DER TRANK IST HOCHGEGANGEN',
  'toast.replacement': 'Ersatz liegt im Depot bereit. Geht von Ihrem Lohn ab.',
  'toast.sheeploose': '🐑 DAS SCHAF IST WEG! Einfangen!',
  'toast.sheepcaught': '🐑 WIEDER EINGEKISTET! Sie ist not amused.',
  'toast.sheepresigned': '🐑 Das Schaf hat förmlich gekündigt.',
  'toast.delivered': '✅ ZUGESTELLT! +{n}',
  'toast.deliveredrough': '…in {pct}% Zustand. Das ist aufgefallen.',
  'toast.nextpickup': 'Nächste Abholung im Depot. Es wird schlimmer.',
  'toast.deliverto': 'Zustellen an: {name} (Höhe {alt} m)',
  'toast.insurance': '💸 Die Schadensmeldung: -300.',
  'toast.chainbroken': '💔 Lauf gerissen ({reason}).',
  'toast.rolled': '🌀 ABGEROLLT!',
  'toast.hardlanding': '🦴 Diese Landung hatte Folgen.',
  'toast.boulder': '🪨 FELSBROCKEN!',
  'toast.lightning': '⚡ FAST-TREFFER',
  'toast.noticed': '🌬️ Der Berg hat Sie bemerkt.',
  'toast.premiums': '🪨 Die Versicherungsprämien steigen…',
  'toast.stormknows': '⛈️ Der Gipfelsturm kennt Ihren Namen.',

  'reason.lost': 'Sendung verloren',
  'reason.respawn': 'Wiedereinstieg',

  'bonus.boing': '🍄 BOING ×{n}',
  'bonus.closeone': '😅 KNAPP',
  'bonus.hazardpay': '☂ GEFAHRENZULAGE',
  'bonus.plank': '🪵 BRETT GESCHLAGEN',

  'score.base': 'GRUNDLOHN',
  'score.speed': '⚡ TEMPO',
  'score.airmail': '🪂 LUFTPOST',
  'score.condition': 'ZUSTAND {pct}%',
  'score.chain': '🔥 LAUF ×{mult}',
  'score.golden': '✨ GOLD ×3',
  'score.total': '=',

  'event.gale': '🌬️ STURMBÖ',
  'event.boulderRain': '🪨 STEINSCHLAG',
  'event.avalanche': '🏔️ LAWINE',
  'event.thunder': '⛈️ GEWITTER',
  'event.incoming': '⚠ {name} ZIEHT AUF',
  'event.live': '{name}! · ☂ GEFAHRENZULAGE +{n}',

  'quip.0': '☠️ Schwerkraft 1 : 0 Sie. Zurück zum Kontrollpunkt.',
  'quip.1': '📋 Dieser Sturz wurde in Ihrer Beurteilung vermerkt.',
  'quip.2': '🏔️ Der Berg dankt für Ihre Spende.',
  'quip.3': '📦 Sendungsstatus: seelisch beschädigt. Sie auch.',
  'quip.4': '🧾 Wiedereinstiegsgebühr erlassen (diesmal).',

  'title.loading': 'Der Berg wird geladen…',
  'title.start': 'KLICKEN, UM DIE SCHICHT ZU BEGINNEN',
  'title.blurb': 'Sendungen im Depot abholen, den Berg hochschleppen, Gondel fahren. Den Trank nicht schütteln.',
  'title.controls': '<b>WASD</b> laufen · <b>Shift</b> sprinten · <b>Leertaste</b> springen (in der Luft halten = Fallschirm, kurz vor der Landung tippen = abrollen) · <b>F</b> werfen / treten · <b>G</b> ablegen · <b>C</b> Bauchrutsche',
  'hint.controls': '<b>WASD</b> laufen · <b>Shift</b> sprinten · <b>Leertaste</b> springen / halten: Fallschirm / kurz vor Landung tippen: abrollen · <b>F</b> werfen · <b>G</b> ablegen · <b>C</b> rutschen · <b>M</b> Musik · <b>P</b> Foto · <b>Esc</b> Pause',
  'fault.title': 'BETRIEBSSTÖRUNG',
  'fault.body': 'Das Depot war nicht erreichbar. Einzelheiten unten, für die Akte.',

  'menu.resume': 'SCHICHT FORTSETZEN',
  'menu.abandon': 'SCHICHT ABBRECHEN',
  'menu.lang': 'SPRACHE',
  'menu.motion': 'BEWEGUNG REDUZIEREN',
  'menu.quality': 'QUALITÄT',
  'menu.accept': 'AUFTRAG ANNEHMEN',
  'menu.next': 'NÄCHSTE SCHICHT',
  'menu.meta': 'ANFORDERUNGEN',
  'menu.requisition': 'ANFORDERN',
  'menu.pausenote': 'Der Berg wurde gebeten zu warten. Er hat vorläufig zugestimmt.',

  'brief.title': 'TOURENZUTEILUNG',
  'brief.memo.first': 'Willkommen beim Vertikalen Paketdienst. Ihre Tour finden Sie unten. Der Berg wurde über Ihr Eintreffen unterrichtet und hat schriftlich keinen Einspruch erhoben.',
  'brief.memo.normal': 'Schicht {n}. Ihr Soll spiegelt Ihre wachsende Erfahrung und unsere wachsenden Erwartungen. Das ist dieselbe Zahl.',
  'brief.memo.pip': 'Schicht {n}. Sie befinden sich weiterhin im Leistungsgespräch. An der Tour wurde nichts erleichtert; der Schriftverkehr wurde gekürzt.',
  'brief.memo.newtype': 'Schicht {n}. Ihrer Tour wurde eine neue Sendungsklasse hinzugefügt. Das hat jemand anderes veranlasst. Für Rückfragen steht diese Person nicht zur Verfügung.',

  'status.pending': 'OFFEN',
  'status.transit': 'UNTERWEGS',
  'status.delivered': 'ZUGESTELLT',
  'status.writtenOff': 'ABGESCHRIEBEN',
  'status.refused': 'VERWEIGERT',

  'results.title': 'SCHICHT {n} - ABRECHNUNG',
  'results.revenue': 'GESAMTUMSATZ',
  'results.met': 'Soll erfüllt. Weitere Schritte sind derzeit nicht erforderlich.',
  'results.missed': 'Umsatz {revenue} bei einem Soll von {quota}. Zu Ihren Gunsten wurde ein Leistungsgespräch eröffnet.',
  'results.terminated': 'Drei Gespräche in Folge. Ihre Tour wurde auf Schicht eins zurückgestuft. Ihre Verdienstpunkte bleiben selbstverständlich erhalten.',
  'results.delivered': 'Zugestellte Sendungen',
  'results.writtenoff': 'Abgeschrieben',
  'results.refused': 'Annahme verweigert',
  'results.clean': 'Unversehrte Zustellungen',
  'results.bestchain': 'Längster Lauf',
  'results.falls': 'Außerplanmäßige Abstiege',
  'results.hazard': 'Gefahrenzulage',
  'results.speed': 'Tempoprämien',
  'results.airmail': 'Luftpostzustellungen',
  'results.golden': 'Goldsendungen',
  'results.distance': 'Getragene Strecke',
  'results.peak': 'Höchster Punkt',
  'results.mp': 'Verdienstpunkte',

  'meta.title': 'ANFORDERUNGEN',
  'meta.mp': 'VERDIENSTPUNKTE',
  'meta.legal': 'Verdienstpunkte sind keine Währung und haben keinen Barwert.',
  'meta.locked': 'Verfügbar ab Schicht {n}.',
  'meta.group.equipment': 'AUSRÜSTUNGSANFORDERUNG',
  'meta.group.certification': 'BEFÄHIGUNGSNACHWEISE',
  'meta.group.insurance': 'VERSICHERUNG & HAFTUNG',
  'meta.group.union': 'BETRIEBSLEISTUNGEN',

  'unlock.harness': 'ERGONOMISCHES TRAGEGESCHIRR',
  'unlock.harness.eff': 'Schwere Fracht bremst Sie weniger.',
  'unlock.boots': 'SICHERHEITSSCHUHE',
  'unlock.boots.eff': 'Härtere Landungen ohne Sturz überstehen.',
  'unlock.packaging': 'VERSTÄRKTE VERPACKUNG',
  'unlock.packaging.eff': 'Stöße beschädigen die Fracht weniger.',
  'unlock.insurance': 'FRACHTVERSICHERUNG',
  'unlock.insurance.eff': 'Eine Abschreibung kostet Sie weniger.',
  'unlock.seniority': 'DIENSTALTERSZULAGE',
  'unlock.seniority.eff': 'Der Lauf-Multiplikator reicht höher.',
  'unlock.chute': 'FALLSCHIRM, DIENSTAUSGABE',
  'unlock.chute.eff': 'Mehr Steuerung unter dem Gleiter.',
  'unlock.hazardGrade': 'GEFAHRENZULAGENSTUFE',
  'unlock.hazardGrade.eff': 'Die Zulage läuft während Ereignissen schneller auf.',
  'unlock.cablePass': 'GONDEL-JAHRESKARTE',
  'unlock.cablePass.eff': 'Gondeln fahren schneller und trödeln weniger an Stationen.',
  'unlock.restBreak': 'TARIFLICHE RUHEPAUSE',
  'unlock.restBreak.eff': 'Einmal pro Schicht wird eine Abschreibung neu ausgegeben.',
  'unlock.waiver': 'HAFTUNGSVERZICHT DRITTER',
  'unlock.waiver.eff': 'Wiedereinstieg reißt Ihren Lauf nicht mehr.',
  'boot.physics': 'Die Physik wird geweckt…',
  'boot.terrain': 'Der Berg wird vermessen…',
  'boot.props': 'Gefahren werden montiert…',
  'boot.courier': 'Der Kurier wird eingewiesen…',
  'boot.shaders': 'Das Wetter wird kompiliert…',
  'boot.ready': 'Depot geöffnet.',
  'spot.depot': 'DAS DEPOT',
  'toast.refused': 'ANNAHME VERWEIGERT',
  'toast.returntosender': 'Zurück ins Depot. Ausnahmsweise bergab.',
  'toast.returned': 'An Absender zurück. Abgelegt.',
  'toast.oversized': 'ÜBERGRÖSSE — EINZELVERSAND',
  'toast.depotmid': 'AUSGABE JETZT AM SCHALTER MITTELSTATION',
  'toast.depotvalley': 'AUSGABE WIEDER AM SCHALTER TALSTATION',
  'reason.refused': 'Annahmeverweigerung',
  'score.refused': 'RÜCKLAUFGEBÜHR',
  'hud.stack': 'STAPEL {n}/{max}',
  'lang.name': 'DEUTSCH',
};

const TABLES = { en: EN, de: DE };
export const LANGS = Object.keys(TABLES);
const STORE_KEY = 'vps.lang';

class I18n {
  constructor() {
    this.lang = this._initial();
    this._listeners = new Set();
  }

  _initial() {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (saved && TABLES[saved]) return saved;
    } catch { /* private browsing: fall through to the browser's preference */ }
    return (navigator.language || 'en').toLowerCase().startsWith('de') ? 'de' : 'en';
  }

  setLang(code) {
    if (!TABLES[code] || code === this.lang) return;
    this.lang = code;
    try { localStorage.setItem(STORE_KEY, code); } catch { /* not worth a crash */ }
    document.documentElement.lang = code;
    for (const fn of this._listeners) fn(code);
  }

  toggle() {
    this.setLang(LANGS[(LANGS.indexOf(this.lang) + 1) % LANGS.length]);
    return this.lang;
  }

  onChange(fn) { this._listeners.add(fn); }

  // Missing keys return the key itself. That is deliberate: a raw key on screen
  // is loud and gets fixed, whereas an empty string or a silent English
  // fallback hides the gap until someone plays the whole game in German.
  t(key, params) {
    const table = TABLES[this.lang];
    let s = table[key];
    if (s === undefined) s = EN[key];
    if (s === undefined) return key;
    if (!params) return s;
    return s.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? params[k] : m));
  }

  // Pluralisation lives here, not in the Hud. Both languages happen to split
  // one/other the same way; a third language would extend this function only.
  plural(baseKey, n, params) {
    return this.t(`${baseKey}_${n === 1 ? 'one' : 'other'}`, { n, ...params });
  }


  // Keys present in one table and missing from the other. Deliberately not a
  // build step: the tables are hand-edited comedy, and the failure mode is a
  // raw key on screen that nobody sees until they play far enough in German.
  audit() {
    const keys = new Set([...Object.keys(EN), ...Object.keys(DE)]);
    const missing = { en: [], de: [] };
    for (const k of keys) {
      if (EN[k] === undefined) missing.en.push(k);
      if (DE[k] === undefined) missing.de.push(k);
    }
    return missing;
  }

  // Static markup: <span data-i18n="key"> for text, data-i18n-html for the few
  // strings that carry <b> in them.
  apply(root = document) {
    for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = this.t(el.dataset.i18n);
    for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = this.t(el.dataset.i18nHtml);
  }
}

export const i18n = new I18n();
export const t = (key, params) => i18n.t(key, params);
