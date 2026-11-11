# Plan: FreeCAD, verktøybibliotek, historikk og OpenSpindle-vert

Dato: 2026-11-11. Bestilt av Lukas Hill. Dette dokumentet er en implementeringsplan, ikke en beskrivelse av ferdige funksjoner.

## Mål og rekkefølge

| Trinn | Leveranse | Ferdig når |
|---|---|---|
| 1 | Referansemodell og materialer fra FreeCAD | Send jobb/operasjon leverer NC, arbeidskoordinater, ferdigmodell og materialdata. Modellen kan vises/skjules og plasseres manuelt. Prosjektlagring bevarer alt. |
| 2 | Felles verktøybibliotek | Samme stabile verktøy-ID og geometrirevisjon følger verktøy mellom FreeCAD og OpenSpindle, uten at T-nummer brukes som identitet. |
| 3 | Jobbhistorikk | Hver faktisk kjøring arkiverer hele jobbgrunnlaget, NC, tidslinje, utfall og eventuelle kamerabilder. Historikken kan åpnes uten å starte maskinen. |
| 4 | Alltid-på-vert ved CNC-en | Én maskineier beholder tilkobling og jobbtilstand; FreeCAD sender jobber over nettverket og nettlesere overvåker den samme tilstanden. |
| 5 | USB og driftsverifisering | Transporten fra ADR 0001 gjenbrukes, med fysiske verifikasjoner av tilkobling, overføring, stopp og frakobling før ordinær USB-kjøring. |

Implementeringen skjer på egne brancher og PR-er. Planen legges direkte på main etter uttrykkelig brukerbestilling. Trinn 1 bygger videre på normal-map-arbeidet i PR #14. Det eksisterende Electron-only-kravet erstattes for den uttrykkelig bestilte verts-/nettleserutgaven; den eksisterende skrivebordsutgaven beholdes.

## 1. Modell, arbeidskoordinater og materialer

FreeCAD-broen lager en selvstendig, versjonert jobbpakke med NC, kontrollsum, begrenset trekantnett og materialdata. En ren NC-fil beholdes ved siden av for manuell bruk. Geometrien kommer fra CAM-jobbens modellkloner i jobbens arbeidskoordinater: millimeter, Z opp, ingen automatisk sentrering. Referansemodellen er ferdigdelen, ikke et vilkårlig startemne.

OpenSpindle viser en gjennomsiktig ferdigmodell som eget lag. Manuell STEP/GLB-import og eksplisitte offset-/rotasjons-/skalafelt gjør plasseringen kontrollerbar. Transformasjonen er visuell og endrer ikke NC eller maskinoppsett. En toppflateanalyse mot heightmap kan vise restmateriale og for dype kutt; den skal beskrives som nominell 2.5D-sammenligning, ikke volumetrisk kollisjonskontroll eller fysisk måling.

Et felles, validert materialsystem styrer PBR-farge, metallandel, ruhet, opasitet, mønster, mønsterskala og styrke. Materialnavn og eksplisitte FreeCAD-egenskaper følger med. Tetthet og mekaniske egenskaper lagres med enheter/proveniens; de velger aldri automatisk feeds/speeds. Tekstur er illustrativ, mens geometriske normal maps følger simuleringens geometri. Uleselig eller for stor geometri skal forklares, ikke erstattes med en feilplassert modell.

## 2. Felles verktøybibliotek

OpenSpindle får en versjonert utvekslingsrepresentasjon med stabil UUID, navn, produsent/artikkelnummer, geometri, enheter, antall skjær og revisjons-/innholdshash. T-nummer tilhører maskin/oppspenning, og samme bibliotekverktøy kan derfor ha forskjellig T-nummer i forskjellige jobber.

Første leveranse er eksplisitt eksport/import på begge sider, også uten nettverk. FreeCAD konverterer til sine eksisterende ToolBit-/ToolController-formater. Verktøy som ikke lar seg representere, rapporteres feltvis. V-bits skiller mellom full spissvinkel og halvvinkel. Fysisk verktøylengde, måleresultater og maskinens slot beholdes lokalt.

Identisk ID og hash gir ingen endring. Endret hash gir en synlig konflikt med valg om å beholde lokalt, ta inn ny revisjon eller lage separat kopi. Geometri i en eksisterende CAM-jobb oppdateres ikke stille. En jobbpakke inkluderer verktøydefinisjonene den ble generert med; historiske jobber refererer aldri bare til dagens mutable bibliotek.

Vertsutgaven gjør det samme biblioteket tilgjengelig gjennom autentisert API. Synkronisering bruker revisjoner/ETag og forventet revisjon ved skriving, slik at samtidige endringer ikke overskriver hverandre.

## 3. Historikk for faktisk kjørte jobber

Historikken henger på den autoritative jobb-livssyklusen, ikke på om Job-fanen er åpen. Ved start fryses:
- original jobbpakke/prosjekt, faktisk klargjort NC og SHA-256;
- verktøy- og materialdefinisjoner, modell, oppspenning og arbeidsnull;
- maskinidentitet, firmware, transport og relevant regel-/probestatus.

Registrer startet, ferdig, stoppet, feilet og avbrutt/ukjent ved programkrasj eller vertsomstart. Bevar tidsstempler, aktiv tid, pauser og relevante hendelser. Skill beregnet kjøretid fra observert maskintid. Mistet forbindelse betyr ukjent maskinstatus, aldri antatt stopp.

Når kameraet allerede er aktivert, lagres tidsstemplede bilder ved start/slutt og med begrenset intervall og totalbudsjett under kjøring. Arkivering aktiverer ikke kameraet i skjul. USB-kontroll og nettverkskamera kan sameksistere som separate kanaler. Manglende kamera skal ikke hindre historikk. Diskgrense og eksplisitt sletting beskytter mot ubegrenset vekst.

Historikkvisningen viser liste, metadata, originalfiler og bildegalleri. Åpne en kopi for gjenbruk er en egen handling; ingenting i historikken gjenbruker tidligere kjøretillatelse eller starter maskinen. Lagrede filer oppdateres atomisk, og et krasj etterlater en lesbar, ufullstendig historikkpost.

## 4. Mini-PC-vert og nettleser

Skill ut plattformuavhengige tjenester fra Electron: lagring, modeller, historikk, innboks, kamera og maskin-RPC. Gjenbruk eksisterende maskinekjerne og firmwareadapter. Verten eier én tilkobling til hver maskin og kjører uavhengig av nettlesernes levetid. WebGL/WebGPU-visualiseringen er en klient av lagret jobb og autoritativ avspillings-/kjøreposisjon; en åpen 3D-scene på serveren er ikke nødvendig.

Verten serverer nettleserappen og versjonert API fra samme origin. Første nettleserleveranse gir innboks, jobb-/kameramonitorering, historikk og prosjektvisning. FreeCAD får vertsadresse og en lokalt lagret tilgangsnøkkel, og sender den samme jobbpakken som ved lokal åpning. Mottatt jobb er ikke startet jobb. Klienten får en konkret mottakskvittering med jobb-ID og hash.

Autentisering er påkrevd for nettverkstilgang. Tilgangsnøkler skal ikke ligge i prosjektfiler, logger eller URL-er. Bruk TLS gjennom konfigurerbar reverse proxy eller direkte TLS før sending over ubeskyttet nettverk. Begrens opplastingsstørrelse, filnavn og meldingsrate; ikke åpne vilkårlige serverfiler eller kjøre shell fra API.

Flere nettlesere kan observere. Maskinskriving krever én tydelig kontrolløkt/lease og følger de eksisterende sjekkene. Første versjon kan være monitor-only i nettleser med lokal kjøring, men skal ikke markedsføres som full fjernstyring. Utløpt lease eller lukket nettleser skal ikke sende nye bevegelser eller anta at en pågående jobb er stoppet. Stopp skal forbli tilgjengelig gjennom eksisterende maskineier.

Drift: egen datamappe, konfigurerbar port/bind-adresse, helsesjekk, tjenestefil/systemd og dokumentert sikkerhetskopi. Omstart gjenoppretter innboks/historikk/prosjekter og kobler observert maskinstatus mot lagret kjøring, uten automatisk fortsettelse eller nye maskinkommandoer.

## 5. USB

Følg [ADR 0001](../adr/0001-reliable-z1-connection-and-usb-transport.md). USB er en egen transport, ikke TCP med en annen adresse. Avklar konkret Z1-enhet, portidentifikasjon, kontrollinjer, 128-byte overføringsrammer og verifisering. Kameraet trenger fortsatt nettverk dersom Z1 ikke tilbyr det over USB.

Kodegjennomgang og simulator kan bekrefte deler av kontrakten. Fysisk verifikasjon av identitet, full filoverføring/readback, stopp, unplug/replug og vertsrestart kreves før USB omtales som klar til produksjonsbruk.

## Validering og milepæler

Hvert repo følger egne påkrevde bygg-, type- og formateringskontroller. OpenSpindles AGENTS.md sier at automatiske tester ikke legges til eller kjøres uten brukerbestilling; det endres ikke av denne planen. Manuell interoperabilitetsmatrise skal dekke mm/inch-NC med mm-modell, forskjøvet/rotert CAM-modell, V-bit, manglende materialkort, flere verktøy, korrupte og store pakker, save/reopen og Undo.

Historikk og vert må i tillegg gjennomgå avbrutt jobb, kamerafeil, full disk, to nettlesere, samtidig opplasting, ugyldig nøkkel, nettbrudd og restart. Ingen sjekkliste eller forhåndsvisning erstatter verifisert fysisk arbeidsnull og oppspenning.

Trinn 1 ferdigstilles før verktøysynkronisering kobles på. Historikk lagres som tjeneste før vertsutgaven tar den i bruk. Vertsutgaven kommer først opp mot simulator/TCP; USB følger den separate verifikasjonsporten over.
