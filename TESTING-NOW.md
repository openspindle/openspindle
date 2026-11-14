# Nå bør vi teste på ekte oppsett

Dato: 12. november 2026. Oppdater **både OpenSpindle og FreeCadMakeraBridge fra `main`** før du begynner. Denne filen er en manuell testliste, ikke en bekreftelse på at maskinvaretestene allerede er gjennomført.

Kodekontroller og bygg er kontrollert under utvikling. USB på Z1, ekte kamerakilder, FreeCAD-eksport i det installerte oppsettet og ytelse på Raspberry Pi må nå prøves av operatør. Start med visning og tilkobling, og bruk en liten jobb uten skjæring før ordinær fresing. Noter firmwareversjon, OS, FreeCAD-versjon, tilkoblingstype og commit-ID fra begge repoene.

## 1. Desktop og FreeCAD uten maskinbevegelse

- [ ] Oppdater/installér bridgen fra `main`, og start FreeCAD og OpenSpindle helt på nytt.
- [ ] Send en hel CAM-jobb og deretter én operasjon. Kontroller navn, riktig operasjonsutvalg, verktøynavn og at original G-kode følger med.
- [ ] Kontroller at ferdigmodellen kommer frem med riktig størrelse, orientering og plassering i forhold til stock og verktøybaner.
- [ ] Kontroller materialnavn og utseende fra FreeCAD: farge, metall/ruhet, tekstur og normal maps. Sammenlign kanter og V-spor i materialfjerningen med forventet geometri. Normal maps endrer lyssetting, ikke heightmap-oppløsning eller fysisk geometri.
- [ ] Skru lag og materialfjerning av/på, og lagre/åpne prosjektet igjen. Bekreft at materialer, referansemodell og oppsett blir med.
- [ ] Eksporter/importer felles verktøybibliotek begge veier. Kontroller diameter, vinkel, type, ID og at en endret definisjon ikke overskriver en annen uten gjennomgang.

## 2. USB og verktøyskift — liten jobb uten skjæring

- [ ] Lukk andre CNC-kontrollere. Skann USB, velg riktig FTDI-enhet og knytt den eksplisitt til riktig eksisterende maskinprofil dersom samme Z1 tidligere brukte Wi-Fi.
- [ ] Kontroller rapportert modell, maskintilstand, koordinater og profil/ankere før en kommando sendes.
- [ ] Bekreft at åpning/lukking av USB ikke resetter maskinen. Dette avhenger av faktisk firmware og driver; fravær av eksplisitt DTR/RTS-toggling i appen er ikke bevis alene.
- [ ] Prøv Stop i hvile, og deretter en kort, kontrollert luftjobb med upload og full readback. Kontroller pause, resume og Stop fra det eksisterende kontrolloppsettet.
- [ ] Ved verktøyskift: kontroller tilbaketrekking til maskinklarering, bevegelse mot senter og rekkefølgen på XY, probing, spindelstart og Z-senking. Ingen lav passering over toolsetter eller stock.
- [ ] Prøv kontrollert kabelbrudd først i hvile. Bekreft ukjent/frakoblet tilstand, ingen automatisk gjenoppkobling, failover eller repetisjon av kommandoer. Frakobling betyr ikke at et fysisk program har stoppet.
- [ ] Start appen igjen og velg USB på nytt. Bekreft at ingen jobb fortsetter automatisk. Kjør først maskinvaretester med klar tilgang til fysisk nødstoppsfunksjon.

Detaljer: [USB-oppsett](docs/usb-serial.md) og [ADR 0001](adr/0001-reliable-z1-connection-and-usb-transport.md).

## 3. Jobbhistorikk

- [ ] Fullfør én liten jobb, avbryt én og kontroller historikken: original fil, preparert program, prosjektkontekst, tid, fase og metadata.
- [ ] Åpne en tidligere jobb og last ned arkivet/registreringen. Kontroller at den fortsatt er den samme etter omstart.
- [ ] Prøv med kamera aktivt og avslått. Kamera av skal ikke hindre historikk eller lage oppdiktede bilder.
- [ ] Bekreft at et avbrutt eller ukjent fysisk utfall ikke presenteres som vellykket fullføring.

## 4. Hosten på mini-PC / Raspberry Pi

- [ ] Følg [host-oppsettet](docs/always-on-host.md), bruk en vedvarende datamappe og konfigurer tilgangsnøkkel og eventuell TLS-proxy/tunnel.
- [ ] Send jobb og enkeltoperasjon fra FreeCAD til hosten. Kontroller korrekt mottak/filhash og at mottak alene aldri starter noe.
- [ ] Last siden på nytt, lukk alle nettlesere og åpne den igjen. Valgt jobb, maskineier og fremdrift skal fortsatt komme fra hosten.
- [ ] Prøv felles verktøybibliotek via hosten, inkludert konflikt ved samtidige endringer.
- [ ] Bekreft at en nettleser uten nøkkel ikke får jobbdata eller kamerabilder.
- [ ] Nettgrensesnittet er foreløpig en monitor. Run/pause/resume/Stop går gjennom den eksisterende, eksplisitte lokale kontrollflyten. Ikke forvent jogg eller Run-knapp i nettleseren.
- [ ] Ved kontrollert omstart: kontroller at historikk bevares og åpne opptak markeres avbrutt. Ingen automatisk jobb-resume. En eksplisitt konfigurert USB-ID kan gi ett tilkoblingsforsøk ved hostoppstart.

## 5. Begge kameraer og timelapse

- [ ] Installér ffmpeg på Linux-hosten, velg riktig USB-webkamera via `OPENSPINDLE_WEBCAM_DEVICE` og kontroller videotilgang for servicebrukeren.
- [ ] Aktivér Makera-kameraet og webkameraet separat. Bytt mellom ett kamera og begge samtidig i nettleseren.
- [ ] Sett eget timelapse-intervall per kamera, lagre, og kjør en kort jobb med begge kameraer aktivert. Opptak krever både aktivt kamera og aktivert jobb-timelapse.
- [ ] Lukk nettleseren under opptak og åpne igjen. Begge bildeseriene skal fortsatt vokse mens jobben er aktiv.
- [ ] Finn jobben i historikken, bygg og spill av MP4 fra hvert kamera, og last ned begge. Kontroller riktig utsnitt, sekvens og metadata.
- [ ] Deaktivér ett kamera eller koble fra webkameraet. Den andre kilden og maskinstyringen skal fortsette; feil skal vises uten at hosten faller ned.
- [ ] Kontroller CPU, minne, ledig disk og stabilitet på Pi-en under samtidig USB-jobb, to kamerakilder og MP4-eksport. Ikke belast et ukjent oppsett første gang under skjæring.
- [ ] Etter hostomstart: kamerakildene starter avslått, intervallene beholdes og eldre opptak er tilgjengelige. Aktiver kildene igjen for nye opptak.

Detaljer og lagringsgrenser: [kameraer og timelapse](docs/host-cameras.md). Linux V4L2 er implementert; Windows/macOS-kamerakilder og libcamera-only CSI-kamera er ikke implementert.

## Første testnotater

| Område | Resultat / observasjon |
| --- | --- |
| OS, maskin, firmware og FreeCAD-versjon | Ikke testet ennå |
| OpenSpindle- og bridge-commit | Ikke fylt inn |
| Modell, materialer og normal maps | Ikke testet ennå |
| Felles verktøybibliotek | Ikke testet ennå |
| USB, Stop og verktøyskift | Ikke testet ennå |
| Jobbhistorikk og omstart | Ikke testet ennå |
| Host og FreeCAD-overføring | Ikke testet ennå |
| To kameraer og timelapse / MP4 | Ikke testet ennå |
| Pi-ytelse og lagringsbruk | Ikke testet ennå |

Ved feil: noter hva du gjorde, forventet og faktisk resultat, og ta vare på relevant protokolltrace/logg. Fjern tilgangsnøkler og andre hemmeligheter før deling.
