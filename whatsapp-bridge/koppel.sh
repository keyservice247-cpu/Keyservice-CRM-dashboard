#!/bin/bash
# KOPPELEN MET EEN (NIEUW) WHATSAPP-NUMMER — één commando in plaats van zes.
#
# Waarom dit bestaat: opnieuw koppelen ging via een reeks losse commando's in de
# Hetzner-webconsole. Daar plakt de console regels aan elkaar, moet je handmatig in
# bridge.js het nummer aanpassen, en is de volgorde kritisch (cd vóór pm2 start,
# anders zoekt de bridge zijn sessiemap in de verkeerde map). Dat is drie keer
# misgegaan. Dit script doet het in de juiste volgorde, of het stopt met uitleg.
#
# Gebruik:
#   cd /root/ksbridge/whatsapp-bridge
#   bash koppel.sh 31612345678      <- nieuw nummer, internationaal, alleen cijfers
#   bash koppel.sh                  <- zelfde nummer als nu ingesteld
set -u

MAP="$(cd "$(dirname "$0")" && pwd)"
BRIDGE="$MAP/bridge.js"
NUMMER="${1:-}"

echo ""
echo "=== Keyservice WhatsApp-bridge koppelen ==="
echo ""

if [ ! -f "$BRIDGE" ]; then
  echo "FOUT: bridge.js niet gevonden in $MAP"
  echo "Ga eerst naar de juiste map:  cd /root/ksbridge/whatsapp-bridge"
  exit 1
fi

# 1. Nummer aanpassen (alleen als er één is meegegeven).
if [ -n "$NUMMER" ]; then
  SCHOON="$(echo "$NUMMER" | tr -cd '0-9')"
  if [ "${#SCHOON}" -lt 10 ] || [ "${#SCHOON}" -gt 15 ]; then
    echo "FOUT: '$NUMMER' ziet er niet uit als een internationaal nummer."
    echo "Voorbeeld: bash koppel.sh 31612345678   (dus 31 in plaats van de 0)"
    exit 1
  fi
  cp "$BRIDGE" "$BRIDGE.backup"
  sed -i "s/^const HARDCODED_PAIR_NUMBER = '[0-9]*';/const HARDCODED_PAIR_NUMBER = '$SCHOON';/" "$BRIDGE"
  GEZET="$(grep -m1 "^const HARDCODED_PAIR_NUMBER" "$BRIDGE" | grep -o "'[0-9]*'" | tr -d "'")"
  if [ "$GEZET" != "$SCHOON" ]; then
    echo "FOUT: het nummer kon niet worden aangepast. Origineel teruggezet."
    mv "$BRIDGE.backup" "$BRIDGE"
    exit 1
  fi
  echo "  [1/4] Nummer gezet op +$SCHOON  (back-up: bridge.js.backup)"
else
  HUIDIG="$(grep -m1 "^const HARDCODED_PAIR_NUMBER" "$BRIDGE" | grep -o "'[0-9]*'" | tr -d "'")"
  echo "  [1/4] Nummer ongewijzigd: +$HUIDIG"
fi

# 2. Bridge stoppen en de oude sessie wissen.
pm2 delete wa >/dev/null 2>&1
rm -rf "$MAP/wa-session"
echo "  [2/4] Oude sessie gewist, bridge gestopt"

# 3. Starten vanuit de JUISTE map (anders belandt wa-session verkeerd).
cd "$MAP" || exit 1
pm2 start bridge.js --name wa >/dev/null 2>&1
if ! pm2 list 2>/dev/null | grep -q "wa .*online"; then
  echo "  LET OP: de bridge lijkt niet online. Bekijk de log hieronder."
fi
echo "  [3/4] Bridge gestart"

echo ""
echo "  [4/4] Zet NU je telefoon klaar:"
echo "        WhatsApp -> Instellingen -> Gekoppelde apparaten"
echo "        -> Apparaat koppelen -> Koppelen met telefoonnummer"
echo ""
echo "        De KOPPELCODE verschijnt hieronder binnen ~30 seconden,"
echo "        en tegelijk in het CRM: Instellingen -> Koppelingen."
echo ""
echo "        Afsluiten van deze log: Ctrl+C  (de bridge blijft gewoon draaien)"
echo ""
sleep 2
pm2 logs wa
