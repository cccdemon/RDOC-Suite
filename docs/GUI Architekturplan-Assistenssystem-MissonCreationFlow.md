## Event erstellen: Was sind die Anforderungen an ein Star Citizen Event:
Missionstemplates + Compositionstemplates -> siehe Compositionstemplates

Eventname
Treffpunkt -> Ort -> Zeit
Wo verorten? 
Briefing (Freitext - am liebsten Markdown):
- Beipspieltext:
  ## Missionsziel
     Der Mauler muss fallen
     SAR Intersec Pilot
  ## RoE
     lorum 
  ## Vorrate.... <--- nee

Discord Event Voice Channel.
Wo soll das Event automagisch auf dem Discord gepostet werden (ankündigung)

Composition:
Welche Schiff(e) (brauchen wir überhaupt Schiffe in einigen Missionen? Mindestens mal Transport zum Zielort)
Wie viele SG Teams brauchen wir (FPS)
Spezielle Ausrüstung: Karten/Sicherungen/Repairtools/Mininglaser

## Wie soll eine Composition erstellt werden?
Beispiel: 
Mission braucht: 2 Fireteams (FPS) a 5 Spieler 
Mission braucht: 2 Großkampfschiffe (was ist ein Großkampfschiff?)
Missionsleiter muss Schiffe erlauben.
- Idris: ja
- Polaris: nein
- Perseues: ja
- Anyship bigger Size L: yes

Mission braucht: 6 Jäger oder 3 Staffeln ah 2 Jäger
Mehrfachrollen Möglich! Multiseatclaim. Ein Pilot/Captain kann ebenfalls in einem Fireteam platz finden
Ist die Mission "Sequenziell oder Parallel?"
Was ist mit "EchtweltEvents?" - da braucht man weder Schiffe noch Fireteams - Social Event Echtwelt/Virtuell




Compositionsphasen wählbar:

## Compositionstemplates
Tactical Strike Groups
Hator
Rockbreaker
Stormbreaker



Minimale Anzahl an Teilnehmern.
Maximale Anzahl an Teilnehmern(optional)
-----------------------------------------------------------------------------------------------------

## Event ist erstellt, Spieler können sich anmelden

Anmeldefunktion ohne Zuweisung (FleetOperator weißt den Platz zu)
Direktwahl(SeatClaim) eines Sitzes in einem Schiff
Spieler stellt ein Schiff zu Verfügung - sofern gefordert. (Nur als Schiff - Verleihmodus / Captain/Pilot Modus)
Auf Basis der Composition bekommt der Spieler bei "schiff zu verfügung stellen nur die Auswahl an "erlaubten Schiffen" die in der composition vorgegeben ist.
- Dem Spieler die Möglichkleit geben einen Alternativvorschlag zu erzeugen, den der FleetOperator abnicken muss.
ODER:
Spieler stellt schiff und bekommt eine Auswahl an Rollen die sein Schiff übernehmen soll/kann


Fleetoperator oder Stellvertreter müssen Schiffe akzeptieren. (Können Seats vorher schon geclaimed werden? JA!)

## Ablauf der Anmeldung eines Mitspielers - Asistenzsystem:
spieler klickt "will teinnehmen"
Spieler bekommt darauf die Wahl: Schiff Stellen, an Flotte teilnehmen oder sich vom operator zuweisen lasse
An Flotte Teilnehmen = Er bekommt eine Auswahl an freien Seats
Schiff Stellen, er kann sein Schiff der Mission hinzufügen



## Missionsstatus

"Draft" -> niemald kann sich anmelden Mission wird gerade erzeugt
"Open" -> Anmeldung möglich
"Locked" -> Anmeldungen nicht mehr möglich
"Starting" -> Das Event startet gleich, aber es finden noch abstimmungen im Discord statt (Vorgespräche etc). Anmeldung nicht mehr möglich, aber Fleetoperator kann Spieler/Schiffe hinzufügen -> Spieler bekommen ihre Voice / SquadLink Links

"In Progress" -> Das Event läuft. Anmeldung nicht mehr möglich, aber Fleetoperator kann Spieler/Schiffe hinzufügen
"Finished" -> Das Event ist beendet. Anmeldung nicht mehr möglich, aber Fleetoperator kann Spieler/Schiffe nachträglich hinzufügen
"Cancelled" -> Das Event ist abgesagt, keine Anmeldung mehr möglich, keine nachträglich Änderung möglich (Missionsstatur kann vom FleetOperator/Eventersteller jederzeit geändert werden -> Auditlog!!!!)


## Ask the Fleetoperator
- eine Nachrichtenqueue, die es ermöglicht Rückfragen direkt aus dem WebUI zu stellen.

## Admin / FleetOperator
Audit log muss ersichtlich sein. Wer hat was geändert, wer hat sich angemeldet/abgemeldet etc. - alles auf Missions/operation Basis

## was gleich bleibt:
Commander zuweiseung - Ein Captain / Squadleader bekommt IMMER Commander Net Rechte (revokebar vor missionsstart)


## Additional info:
FR-P1-eventcreation-simplification.md